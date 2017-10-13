const chai = require('chai');

chai.config.includeStack = true; // turn on stack trace

// REST tests
require('./routes/auth-middleware-test');
require('./routes/posts-router-test');
