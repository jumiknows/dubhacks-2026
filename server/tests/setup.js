// Loaded before every test file (see the "test" script). Points the Python
// service at a closed port so results don't depend on whether the developer
// has the API running. Set TEST_PYTHON_API_URL to test against a live one.
process.env.PYTHON_API_URL = process.env.TEST_PYTHON_API_URL || "http://127.0.0.1:9";
process.env.MOCK_ORDER_SANDBOX ??= "off";
process.env.STORES_LIVE ??= "false";
