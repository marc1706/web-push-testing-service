
<h1 align="center">Web Push Testing Service</h1>
<p align="center">
  <a href="https://github.com/marc1706/web-push-testing-service/actions/workflows/tests.yml">
    <img src="https://github.com/marc1706/web-push-testing-service/actions/workflows/tests.yml/badge.svg" alt="GitHub Actions Build Status" />
  </a>
</p>

## Why

Testing web push is hard and with difference between browsers being an issue
as standards are created and implemented, the best approach to ensure
a library is up to date is to have integration tests. Sadly this involves
knowledge and implementation of selenium web driver and implementing the logic
to manage those browsers for push testing.

This library handles the selenium and browser orchestrating and makes them
available via a JSON API, simplifying the whole process.

## Install

    npm install @marc1706/web-push-testing-service -g

## Usage

To start the push testing service run:

    web-push-testing-service start <Service Name>

This will start the service and run it in the background on port 8090. If
you need to run it on a different port, you can use the port flag:

    web-push-testing-service start <Service Name> -p 9000

Once you've finished using the service you just need run the `stop` command.

    web-push-testing-service start <Service Name>

With the service started you can make POST requests in the following
flow to write integration tests for your push library.

Regardless of the API you call, you'll receive JSON and the top level parameter
will be either 'data' or 'error'. Data will change depending on the API called
and error with have an 'id' and 'message' parameter.

1. Start Test Suite
    This assigns a test suite ID to the current run that all future tests are
    tied to.

    http://localhost:8090/api/start-test-suite/

    **Input**: *Nothing*

    **Output**
    ```
    {
      data: {
        testSuiteId: <New ID>
      }
    }
    ```

1. Get a Subscription
    This method expected a testSuiteId, a browser name and the release version
    and it will return a subscription.

    http://localhost:8090/api/get-subscription/

    **Input**
    ```
    {
        testSuiteId: <Test Suite ID Number>,
        browserName: <'chrome' | 'firefox'>,
        browserVersion: <'stable' | 'beta' | 'unstable' >,
        vapidPublicKey: <Base64 URL Encode Vapid Public Key>
    }
    ```

    **Output**
    ```
    {
        data: {
            testId: <ID for this test instance>,
            subscription: <A Subscription Object, will have endpoint and keys>
        }
    }
    ```

1. Wait for notification to arrive
    Once your library has sent a message you can retrieve what details the
    browser received.

    http://localhost:8090/api/get-notification-status/

    **Input**
    ```
    {
        testSuiteId: <Test Suite ID Number>
        testId: <Test ID Number>
    }
    ```

    **Output**
    ```
    {
        data: {
            messages: [
                <Payload String>,
                ...
            ]
        }
    }
    ```

1. End the Test Suite
    This will end and close any currently open tests.

    http://localhost:8090/api/end-test-suite/

    **Input**
    ```
    {
      testSuiteId: <Your Test Suite ID>
    }
    ```

    **Output**
    ```
    {
      data: {
        success: true
      }
    }
    ```
