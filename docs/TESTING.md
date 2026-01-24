# How to run tests

## Python unit tests

    pytest --cov=planner_lib --cov-report=term-missing --cov-report=html:coverage/htmlcov -q

coverage report dropped in `coverage/htmlcov`

## JavaScript unit tests

    npm test --coverage

coverage report dropped on `coverage/lcov-report`

## JavaScript UI tests

    npx test