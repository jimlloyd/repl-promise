// repl-promise/lib/index.js

'use strict';

var _ = require('lodash');
var chalk = require('chalk');
var Q = require('q');
var util = require('util');
var vm = require('vm');

var LineReader = require('./LineReader.js');

var plog = require('debug')('repl-promise');

// If the error is that we've unexpectedly ended the input,
// then let the user try to recover by adding more input.
function isRecoverableError(e) {
  return e &&
    e.name === 'SyntaxError' &&
    /^(Unexpected end of input|Unexpected token :)/.test(e.message);
}

function Recoverable(err) {
  this.err = err;
}
util.inherits(Recoverable, SyntaxError);

function ReplServer() {
  if (!(this instanceof ReplServer)) {
    return new ReplServer();
  }

  var self = this;

  self.init = function(options, _initialContext) {
    options = options || {};
    options.input = options.input || process.stdin;
    options.output = options.output || process.stdout;
    options.prompt = options.prompt || '> ';
    options.writer = options.writer || _writer;

    function _writer(obj) {
      return util.inspect(obj, {depth: null, colors: options.output.isTTY });
    }

    self.echoInputToOutput = !options.output.isTTY || !options.input.isTTY;

    self.options = options;

    var initialContext = {
      require: require,
      console: console,
      process: process,
      Q: Q,
    };

    _initialContext = _initialContext || {};

    initialContext = _.extend(initialContext, _initialContext);

    self.bufferedInput = '';
    self.context = vm.createContext(initialContext);
    self.endOfSessionPromise = self.newSession();

    return self;
  };

  self.promiseOutput = function(line) {
    if (line === '')
      plog('promiseOutput: Empty line');

    var deferred = Q.defer();

    // This may seem like a case where we could use Q.nbind or deferred.makeNodeResolver(),
    // but output.write uses a callback that only takes an err argument, and we need
    // to call deferred.resolve(line), i.e. with line as an argument.
    self.options.output.write(line, "utf8", function(err) {
      if (err) {
        deferred.reject(err);
      }
      else {
        deferred.resolve(line);
      }
    });

    return deferred.promise;
  };

  self.promptForInput = function() {
    var prompt = self.options.prompt;
    if (self.bufferedInput !== '')
      prompt = '... ';
    if (self.options.output.isTTY)
      prompt = chalk.bold.blue(prompt);
    return self.promiseOutput(prompt);
  };

  self.compileAndExecuteScript = function(text) {
    if (text===null && self.lineReader.isDone())
      return new Q(null);

    var executeScriptDeferred = Q.defer();

    var isBufferingInput = self.bufferedInput !== '';
    if (self.bufferedInput !== '') {
      text = self.bufferedInput + text;
      self.bufferedInput = '';
      plog('buffered input:', self.bufferedInput.length);
    }

    // (var) (symbol) = (expression)
    var assignmentExpr = /^(\s*|var\s+)([_\w\$]+)\s*=\s*(.*)$/m;
    var matches = assignmentExpr.exec(text);
    var isScopedVar = matches!==null;
//      var isScopedVar = !isBufferingInput && matches!==null && matches.length===3;
    plog('Is scoped var:', isScopedVar);

    var symbol;
    if (isScopedVar) {
      symbol = matches[2];
      text = matches[3];    // change text that will be compiled & executed!
      plog('var assignment', symbol, text);
    }

    var script;
    try {
      script = vm.createScript(text, {filename: 'repl.vm', displayErrors: false});
      plog('text successfully compiled');

      var result;
      try {
        result = script.runInNewContext(self.context);
        plog('text successfully executed');
        if (!isScopedVar) {
          plog('simple expression result resolved');
          executeScriptDeferred.resolve(result);
        }
        else {
          if (!Q.isPromise(result)) {
            plog('simple expression assignment resolved');
            self.context[symbol] = result;
            if (matches[1].trim() === 'var')
              result = undefined;
            executeScriptDeferred.resolve(result);
          }
          else {
            plog('promise expression assignment deferred');
            result.then(function (resolvedResult) {
              plog('promise expression assignment resolved');
              self.context[symbol] = resolvedResult;
              if (matches[1].trim() === 'var')
                resolvedResult = undefined;
              executeScriptDeferred.resolve(resolvedResult);
            });
          }
        }
      }
      catch (err) {
        plog('script execution failed');
        console.error(chalk.bold.red(err));
        executeScriptDeferred.resolve(null);
        return executeScriptDeferred.promise;
      }
    }
    catch (e) {
      var err;
      if (isRecoverableError(e)) {
        plog('recoverable error in compilation');
        if (isScopedVar) {
          text = util.format('var %s = %s', symbol, text);
        }
        self.bufferedInput = text;
        executeScriptDeferred.resolve(undefined);
      }
      else {
        plog('nonrecoverable error in compilation');
        err = e;
        executeScriptDeferred.reject(err);
      }
    }

    return executeScriptDeferred.promise;
  };

  self.printResult = function(result) {
    if (result===null && self.lineReader.isDone())
      return new Q(null);

    if (result === null || result === undefined) {
      return new Q(result);
    }
    else {
      var resultAsString = self.options.writer(result);
      return self.promiseOutput(resultAsString + '\n');
    }
  };

  self.onEchoInput = function(line) {
    if (line===null && self.lineReader.isDone())
      return new Q(null);
    if (!_.isString(line))
      throw new Error('LineReader.readLine return null!');
    if (line === '')
      line = '\n';
    if (!self.echoInputToOutput)
      return new Q(line);
    return self.promiseOutput(line);
  };

  self.newSession = function() {
    var replSessionDeferred = Q.defer();

    var lineReader = self.lineReader = new LineReader(self.options.input);

    function onScriptInput() {
      if (lineReader.isDone()) {
        if (self.options.output != process.stdout) {
          plog('lineReader is done, closing output');
          self.options.output.end();
        }
        replSessionDeferred.resolve(null);
        return;
      }

      self.promptForInput()
        .then(lineReader.readLine)
        .then(self.onEchoInput)
        .then(self.compileAndExecuteScript)
        .then(self.printResult)
        .catch(function(err) { console.error(chalk.bold.red(err)); })
        .delay(1)
        .done(onScriptInput);
    }

    onScriptInput();

    return replSessionDeferred.promise;
  };
}

module.exports = {
  start: function(options, _initialContext) {
    var replServer = new ReplServer();
    return replServer.init(options, _initialContext);
  }
};
