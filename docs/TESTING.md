# How to run tests

## Python unit tests

    pytest --cov=planner_lib --cov-report=term-missing --cov-report=html:coverage/htmlcov --cov-report=term --cov-report=lcov -q

coverage report dropped in `coverage/htmlcov`

## JavaScript unit tests

    npm test --coverage

coverage report dropped on `coverage/lcov-report`

## JavaScript UI tests

Start the server:

    uvicorn planner:make_app --factory --reload 2>&1 |tee logfile.log

Run tests:
    npx playwright test --config=tests/playwright.config.js --project=firefox

    To run with open browwser and pause execution:
    PWDEBUG=1 npx playwright test tests/e2e/featureboard-hierarchy.spec.mjs --headed