/**
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
**/
'use strict';

const seleniumAssistant = require('selenium-assistant');
const del = require('del');

const logHelper = require('./helper/log-helper.js');
const APIServer = require('./server/api-server.js');
const TestSuite = require('./model/test-suite.js');

// This may be needed: https://github.com/angular/protractor/issues/2419#issuecomment-213112857

class WPTS {
  constructor(port, browsers, browserVersions) {
    port = port ? port : 8090;

    this._availableTestSuiteId = 0;
    this._testSuites = {};
    this._supportedBrowsers = browsers || [
      'chrome',
      'firefox',
    ];
    this._supportedBrowserVersions = browserVersions || [
      'stable',
      'beta',
      'unstable',
    ];

    this._apiServer = new APIServer(port);
    this._apiServer.on('start-test-suite', this.startTestSuite.bind(this));
    this._apiServer.on('end-test-suite', this.endTestSuite.bind(this));
    this._apiServer.on('get-subscription', this.getSubscription.bind(this));
    this._apiServer.on('get-notification-status',
      this.getNotificationStatus.bind(this));

    logHelper.setLogFile('./module.log');
  }

  setLogFile(logFile) {
    logHelper.setLogFile(logFile);
  }

  downloadBrowsers() {
    const browserDownloads = [];
    this._supportedBrowsers.forEach((browser) => {
      this._supportedBrowserVersions.forEach((version) => {
        // Chrome version unstable is no longer supported
        if (browser === 'chrome' && version === 'unstable') {
          return;
        }
        browserDownloads.push(
          seleniumAssistant.downloadLocalBrowser(browser, version, 48)
        );
      });
    });
    return Promise.all(browserDownloads);
  }

  startService() {
    return this.downloadBrowsers()
    .then(() => {
      return this._apiServer.startListening();
    });
  }

  endService() {
    const testSuiteIds = Object.keys(this._testSuites);
    const promises = testSuiteIds.map((testSuiteId) => {
      const testSuite = this._testSuites[testSuiteId];
      return testSuite.end()
      .then(() => {
        delete this._testSuites[testSuiteId];
      });
    });

    return this._apiServer.kill()
    .then(() => {
      return Promise.all(promises);
    })
    .then(() => {
      this._availableTestSuiteId = 0;
    });
  }

  startTestSuite(res) {
    logHelper.info('Received start-test-suite call.');
    const newTestSuite = new TestSuite(this._availableTestSuiteId);
    this._availableTestSuiteId++;
    this._testSuites[newTestSuite.id] = newTestSuite;
    logHelper.info('    Created new test suite. ' + this._availableTestSuiteId);
    APIServer.sendValidResponse(res, {testSuiteId: newTestSuite.id});
    logHelper.info('    Response was sent');
  }

  endTestSuite(res, args) {
    const requiredFields = ['testSuiteId'];
    if (this.missingRequiredArgs(res, args, requiredFields)) {
      return;
    }

    if (!this.validTestSuiteId(res, args.testSuiteId)) {
      return;
    }

    return this._testSuites[args.testSuiteId].end()
    .then(() => {
      delete this._testSuites[args.testSuiteId];
      APIServer.sendValidResponse(res);
    })
    .catch((err) => {
      APIServer.sendErrorResponse(res, 'webdriver_issue', 'An issue ' +
        'occured while attempting to get the subscription: ' + err.message);
    });
  }

  getSubscription(res, args) {
    const requiredFields = ['testSuiteId', 'browserName', 'browserVersion'];
    if (this.missingRequiredArgs(res, args, requiredFields)) {
      return;
    }

    if (!this.validTestSuiteId(res, args.testSuiteId)) {
      return;
    }

    if (!args.browserName ||
      this._supportedBrowsers.indexOf(args.browserName) === -1) {
      APIServer.sendErrorResponse(res, 'invalid_browser_name', `browserName ` +
        `should be one of the following values: ` +
        `${this._supportedBrowsers.join(', ')}. ` +
        `Found ${(typeof args.browserName)}.`);
      return;
    }

    if (!args.browserVersion ||
      this._supportedBrowserVersions.indexOf(args.browserVersion) === -1) {
      APIServer.sendErrorResponse(res, 'invalid_browser_version',
        `browserVersion should be one of the following values: ` +
        `${this._supportedBrowserVersions.join(', ')}. ` +
        `Found ${(typeof args.browserVersion)}.`);
      return;
    }

    const webDriverInstance =
      seleniumAssistant.getLocalBrowser(args.browserName, args.browserVersion);
    if (!webDriverInstance) {
      APIServer.sendErrorResponse(res, 'browser_not_found',
        `Unable to find the requested browser. This is likely an issue` +
        `the push testing service.`);
      return;
    }

    if (webDriverInstance.getId() === 'firefox' &&
      webDriverInstance.getVersionNumber() <= 48) {
      APIServer.sendErrorResponse(res, 'bad_browser_support',
        `Unforuntately Firefox version 49 and below has poor selenium ` +
        `support or doesn't allow notifications automatically and isn't ` +
        `supported as a result.`);
      return;
    }

    const optionalArgs = {};
    if (args.vapidPublicKey) {
      if (typeof args.vapidPublicKey !== 'string') {
        APIServer.sendErrorResponse(res, 'invalid_vapid_key',
          `Your vapid public key must be a string.`);
        return;
      }

      optionalArgs.vapidPublicKey = args.vapidPublicKey;
    }

    return this.initiateTestInstance(args.testSuiteId, optionalArgs,
      webDriverInstance)
    .then((testDetails) => {
      APIServer.sendValidResponse(res, testDetails);
    })
    .catch((err) => {
      if (err.code && err.message) {
        APIServer.sendErrorResponse(res, err.code, 'An issue ' +
          'occured while attempting to get the subscription: ' + err.message);
        return;
      }

      APIServer.sendErrorResponse(res, 'webdriver_issue', 'An issue ' +
        'occured while attempting to get the subscription: ' + err.message);
    });
  }

  getNotificationStatus(res, args) {
    const requiredFields = ['testSuiteId', 'testId'];
    if (this.missingRequiredArgs(res, args, requiredFields)) {
      return;
    }

    if (!this.validTestId(res, args.testSuiteId, args.testId)) {
      return;
    }
    // Get the available test
    const testInstance = this._testSuites[args.testSuiteId]
      .getTestInstance(args.testId);

    // get the available notification status
    return testInstance.wait(() => {
      return testInstance.executeScript(() => {
        return window.PUSH_TESTING_SERVICE.receivedMessages.length > 0;
      })
      .then((isValid) => {
        if (isValid) {
          return true;
        }

        return new Promise((resolve) => {
          setTimeout(() => resolve(false), 500);
        });
      });
    }, 60000)
    .then(() => {
      return testInstance.executeScript(() => {
        const messages = window.PUSH_TESTING_SERVICE.receivedMessages;
        window.PUSH_TESTING_SERVICE.receivedMessages = [];
        return messages;
      });
    })
    .then((receivedMessages) => {
      APIServer.sendValidResponse(res, {messages: receivedMessages});
    })
    .catch((err) => {
      APIServer.sendErrorResponse(res, 'web_driver_error', 'An error ' +
        'occured while attempting to check the notification status. ' +
        err.message);
    });
  }

  initiateTestInstance(testSuiteId, optionalArgs, seleniumAssistantBrowser) {
    return del('./temp')
    .then(() => {
      if (seleniumAssistantBrowser.getId() === 'chrome' ||
        seleniumAssistantBrowser.getId() === 'opera') {
        /* eslint-disable camelcase */
        const blinkPreferences = {
          profile: {
            content_settings: {
              exceptions: {
                notifications: {},
              },
            },
          },
        };
        blinkPreferences.profile.content_settings.exceptions
          .notifications[this._apiServer.getUrl() + ',*'] = {
            setting: 1,
          };

        const options = seleniumAssistantBrowser.getSeleniumOptions();
        options.setUserPreferences(blinkPreferences);
      } else if (seleniumAssistantBrowser.getId() ===
        'firefox') {
        const options = seleniumAssistantBrowser.getSeleniumOptions();
        options.setPreference('dom.push.testing.ignorePermission', true);
        options.setPreference('notification.prompt.testing', true);
        options.setPreference('notification.prompt.testing.allow', true);
      }

      return seleniumAssistantBrowser.getSeleniumDriver();
    })
    .then((driver) => {
      const testSuite = this._testSuites[testSuiteId];
      const testInstanceId = testSuite.addTestInstance(driver);

      let urlGETArgs = '';
      const optionalArgKeys = Object.keys(optionalArgs);
      if (optionalArgKeys.length > 0) {
        const urlArgs = optionalArgKeys.map((argKey) => {
          return `${argKey}=${optionalArgs[argKey]}`;
        });
        urlGETArgs = '?' + urlArgs.join('&');
      }

      return driver.get(this._apiServer.getUrl() + '/' + urlGETArgs)
      .then(() => {
        return driver.wait(() => {
          return driver.executeScript(() => {
            /* eslint-env browser */
            return window.PUSH_TESTING_SERVICE &&
              window.PUSH_TESTING_SERVICE.loaded;
          });
        });
      })
      .then(() => {
        return driver.executeScript(() => {
          window.PUSH_TESTING_SERVICE.start();
        });
      })
      .then(() => {
        return driver.wait(() => {
          return driver.executeScript(() => {
            return (typeof window.PUSH_TESTING_SERVICE.swRegistered) !==
              'undefined';
          });
        });
      })
      .then(() => {
        return driver.executeScript(() => {
          return window.PUSH_TESTING_SERVICE.swRegistered;
        });
      })
      .then((swRegistered) => {
        if (swRegistered.error) {
          const errorDetails = {
            code: 'unable_to_reg_service_worker',
            message: `There was an error when registering the service worker.` +
            ` "${swRegistered.error}".`,
          };
          throw errorDetails;
        }
      })
      .then(() => {
        return driver.wait(() => {
          return driver.executeScript(() => {
            /* eslint-env browser */
            return (typeof window.PUSH_TESTING_SERVICE.subscription) !==
              'undefined';
          });
        });
      })
      .then(() => {
        return driver.executeScript(() => {
          /* eslint-env browser */
          return window.PUSH_TESTING_SERVICE.subscription;
        });
      })
      .then((subscription) => {
        if (subscription.error) {
          const errorDetails = {
            code: 'unable_to_get_subscription',
            message: subscription.error,
          };
          throw errorDetails;
        }

        return {
          testId: testInstanceId,
          subscription: subscription,
        };
      });
    });
  }

  missingRequiredArgs(res, args, requiredFields) {
    // Clone the required fields array
    const requiredFieldsClone = requiredFields.slice(0);
    Object.keys(args).forEach((key) => {
      const fieldIndex = requiredFieldsClone.indexOf(key);
      if (fieldIndex >= 0) {
        if (typeof args[key] !== 'undefined' && args[key] !== null) {
          requiredFieldsClone.splice(fieldIndex, 1);
        }
      }
    });

    if (requiredFieldsClone.length > 0) {
      APIServer.sendErrorResponse(res, 'missing_required_args', `Required ` +
        `arguments are missing. Required fields: ` +
        `${requiredFields.join(', ')}. Received: ` +
        `${Object.keys(args).join(', ')}`);
    }

    return requiredFieldsClone.length > 0;
  }

  validTestSuiteId(res, testSuiteId) {
    if (typeof testSuiteId !== 'number') {
      APIServer.sendErrorResponse(res, 'invalid_variable_type', `testSuiteId ` +
        `should be a number, found ${(typeof testSuiteId)}.`);
      return false;
    }

    if (!this._testSuites[testSuiteId]) {
      APIServer.sendErrorResponse(res, 'invalid_test_suite_id', `testSuiteId ` +
        `passed in doesn't exist: ${testSuiteId}.`);
      return false;
    }

    return true;
  }

  validTestId(res, testSuiteId, testId) {
    if (!this.validTestSuiteId(res, testSuiteId)) {
      return false;
    }

    if (typeof testId !== 'number') {
      APIServer.sendErrorResponse(res, 'invalid_variable_type', `testId ` +
        `should be a number, found ${(typeof testId)}.`);
      return false;
    }

    const testSuite = this._testSuites[testSuiteId];
    const testInstance = testSuite.getTestInstance(testId);
    if (!testInstance) {
      APIServer.sendErrorResponse(res, 'invalid_test_id', `testId ` +
        `was not found as a valid test, received testId: ${testId}.`);
      return false;
    }
    return true;
  }
}

module.exports = WPTS;
