// repl-promise/lib/LineReader.js

// The LineReader must deliver all lines. Each line is delivered as a promise.
// Input is buffered, so many of the of promises will be delivered as
// already-resolved promises.
//
// There is some trickiess in handling end of input correctly.
// The contract we operate under is as follow:
// The caller must first call LineReader.isDone() to see if
// end of input has been reached. If isDone() returns true,
// then the caller must NOT call readLine again.
// If isDone returns false, the caller must call readline,
// which will return a promise for the line.
// The caller must resolve that promise, process the line,
// and then repeat with the call to isDone().

var _ = require('lodash');
var fs = require('fs');
var stream = require('stream');
var Q = require('q');

var llog = require('debug')('line-reader');

function LineReader(input) {
  if (!(this instanceof LineReader)) {
    return new LineReader(input);
  }

  var self = this;

  llog('Creating LineReader(%j)', input);
  var isStream = input instanceof stream.Readable;
  var isPath = _.isString(input);

  if (!isStream && !isPath)
    throw new Error('Input must be a ReadableStream or a string with path to a file.');

  self.remaining = '';
  self.lines = [];
  self.pendingDeferred = null;
  self.done = false;

  if (isPath) {
    llog('Reading from file %s', input);
    self.lines = fs.readFileSync(input, { encoding: 'utf8'}).split('\n');
    if (_.last(self.lines) === '')
      self.lines.pop();
    self.remaining = '';
    self.done = true;
    llog('Read %d lines from file %s', self.lines.length, input);
  }
  else {
    // For a readable stream we have to do more work.
    llog('Reading from readable stream');
    var inputStream = input;

    inputStream.on('data', function(chunk) {
      self.remaining = self.remaining + chunk.toString();
      var newLines = self.remaining.split('\n');
      self.lines = self.lines.concat(_.initial(newLines));
      self.remaining = _.last(newLines);
      if (self.pendingDeferred!==null && self.lines.length>0) {
        self.fullfillPending();
      }
    });

    inputStream.once('end', function() {
      llog('lineReader input stream end event seen with remaining(%s), pending=%j', self.remaining, self.pendingDeferred!==null);
      self.done = true;
      if (self.remaining.length > 0) {
        self.lines.push(self.remaining);
        self.remaining = '';
      }
      if (self.pendingDeferred !== null) {
        self.fullfillPending();
      }
    });
  }

  self.isDone = function() {
    return self.done && self.lines.length===0;
  };

  self.fullfillPending = function() {
    if (self.pendingDeferred === null) {
      throw new Error('LineReader.fullfillPending called with no pendingDeferred.');
    }
    if (self.lines.length === 0 && self.done) {
      self.pendingDeferred.resolve(null);
      return;
    }
    if (self.lines.length === 0) {
      throw new Error('LineReader.fullfillPending called with no buffered lines.');
    }
    var line = self.lines.shift() + '\n';
    self.pendingDeferred.resolve(line);
    self.pendingDeferred = null;
    llog('Readline fulfilled, %d remaining', self.lines.length);
  };

  self.readLine = function() {
    if (self.pendingDeferred !== null) {
      throw new Error('LineReader.readLine called before pendingDeferred fulfilled');
    }
    if (self.isDone()) {
      throw new Error('LineReader.readLine called after isDone returned true!');
    }

    if (self.lines.length > 0) {
      var line = self.lines.shift() + '\n';
      llog('Readline returning buffered line, %d remaining', self.lines.length);
      return new Q(line);
    }
    else if (self.tty) {
      return null;
    }
    else {
      llog('Readline pending');
      self.pendingDeferred = Q.defer();
      return self.pendingDeferred.promise;
    }
  };

}

module.exports = LineReader;
