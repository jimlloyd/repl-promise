'use strict';

// This module configures the test environment by initializing
// the chai assertion modules. Also loads Q and lodash into global
// vairables.

global._ = require('lodash');
global.Q = require('q');


var chai = require('chai'),
    chaiAsPromised = require('chai-as-promised');

// Add .should method to all JavaScript Objects. Global should() makes
// it easier to talk about possibly undefined things like: should.not.exist(x)
global.should = chai.should();

// Enable .should.eventually promise-checking syntax
chai.use(chaiAsPromised);
global.chaiAsPromised = chaiAsPromised;

// The expect(...) API is especially useful when asserting undefined objects
global.expect = chai.expect;

// Also enable C-like assert(foo == 'bar') api
global.assert = chai.assert;

global.AssertionError = chai.AssertionError;
global.Assertion = chai.Assertion;
