// # Transcript-test.js

'use strict';

require('./support/config');

var repl = require('../lib/index.js');
var fs = require('fs');
var concat = require('concat-stream');

function transcriptTest(name, done) {
    var expected = fs.readFileSync('test/data/'+name+'.expected', { encoding: 'utf8' });
    var expectedLines = expected.split('\n');

    var output = concat({encoding: 'string'}, function(data) {
        var dataLines = data.split('\n');
        expect(dataLines).to.deep.equal(expectedLines);
        done();
    });

    var options = {
        prompt: 'node > ',
        input: fs.createReadStream('test/data/'+name+'.txt'),
        output: output,
    };

    var replServer = repl.start(options, {});
    replServer.context.timers = require('timers');
}

describe('Transcript', function() {

    it('should produce the expected transcript given delay-promise.txt', function(done) {
        this.timeout(5000);
        transcriptTest('delay-promise', done);
    });

    it('should produce the expected transcript given context-test.txt', function(done) {
        this.timeout(5000);
        transcriptTest('context-test', done);
    });
});
