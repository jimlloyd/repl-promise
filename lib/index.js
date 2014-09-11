// repl-promise/lib/index.js

'use strict';

var Q = require('q');
var chalk = require('chalk');
var util = require('util');
var vm = require('vm');
var _ = require('lodash');

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

function LineReader(inputStream, endOfInput) {
    if (!(this instanceof LineReader)) {
        return new LineReader(inputStream);
    }

    var self = this;

    self.inputStream = inputStream;
    self.remaining = '';
    self.lines = [];
    self.pendingDeferred = null;
    self.done = false;

    self.isDone = function() {
        return self.done && self.lines.length===0;
    };

    self.fullfill = function() {
        var line = self.lines.shift();
        if (line)
            line = line + '\n';
        self.pendingDeferred.resolve(line);
        var result = self.pendingDeferred.promise;
        self.pendingDeferred = null;
        return result;
    };

    self.readLine = function() {
        if (self.pendingDeferred !== null) {
            throw new Error('LineReader.readLine called before pendingDeferred fulfilled');
        }
        self.pendingDeferred = Q.defer();

        if (self.isDone()) {
            endOfInput.resolve(null);
            return self.fullfill();
        }

        if (self.lines.length > 0) {
            return self.fullfill();
        }

        return self.pendingDeferred.promise;
    };

    process.on('SIGINT', function() {
        self.remaining = '';
        self.lines = [''];
        if (self.pendingDeferred !== null) {
            self.fullfill();
        }
    });

    inputStream.on('data', function(chunk) {
        self.remaining = self.remaining + chunk.toString();
        var newLines = self.remaining.split('\n');
        self.lines = self.lines.concat(_.initial(newLines));
        self.remaining = _.last(newLines);
        if (self.pendingDeferred!==null && self.lines.length>0) {
            self.fullfill();
        }
    });

    inputStream.on('end', function() {
        self.done = true;
    });
}

function identityTransformResult(result) {
    return new Q(result);
}

function start(options, _initialContext) {
    options = options || {};
    options.input = options.input || process.stdin;
    options.output = options.output || process.stdout;
    options.prompt = options.prompt || '> ';
    options.transformResult = options.transformResult || identityTransformResult;

    var echoInputToOutput = !options.output.isTTY || !options.input.isTTY;

    var initialContext = {
        require: require,
        console: console,
        process: process,
        Q: Q,
    };

    _initialContext = _initialContext || {};

    initialContext = _.extend(initialContext, _initialContext);

    var sandbox = vm.createContext(initialContext);
    var bufferedInput = '';
    var nullScript = vm.createScript('null;', {filename: 'null.vm', displayErrors: false});

    function promiseOutput(line) {

        if (line === '')
            console.log('Empty line');


        var deferred = Q.defer();

        // This may seem like a case where we could use Q.nbind or deferred.makeNodeResolver(),
        // but output.write uses a callback that only takes an err argument, and we need
        // to call deferred.resolve(line), i.e. with line as an argument.
        options.output.write(line, "utf8", function(err) {
            if (err) {
                deferred.reject(err);
            }
            else {
                deferred.resolve(line);
            }
        });

        return deferred.promise;
    }

    function promptForInput() {
        var prompt = options.prompt;
        if (bufferedInput !== '')
            prompt = '... ';
        if (options.output.isTTY)
            prompt = chalk.bold.blue(prompt);
        return promiseOutput(prompt);
    }

    function compileText(text) {
        var compileTextDeferred = Q.defer();

        if (bufferedInput !== '') {
            text = bufferedInput + text;
            bufferedInput = '';
        }

        try {
            var script = vm.createScript(text, {filename: 'repl.vm', displayErrors: false});
            compileTextDeferred.resolve(script);
        }
        catch (e) {
            var err;
            if (isRecoverableError(e)) {
                bufferedInput = text;
                compileTextDeferred.resolve(nullScript);
            }
            else {
                err = e;
                compileTextDeferred.reject(err);
            }
        }

        return compileTextDeferred.promise;
    }

    function executeScript(script) {
        var executeScriptDeferred = Q.defer();
        try {
            var result = script.runInNewContext(sandbox);
            executeScriptDeferred.resolve(result);
        }
        catch (err) {
            console.error(chalk.bold.red(err));
            executeScriptDeferred.resolve(null);
        }

        return executeScriptDeferred.promise;
    }

    function printResult(result) {
        if (result === null || result === undefined) {
            return new Q(result);
        }
        else {
            var resultAsString = util.inspect(result, {depth: null, colors: options.output.isTTY });
            return promiseOutput(resultAsString + '\n');
        }
    }

    function onEchoInput(line) {
        if (line === '')
            line = '\n';
        if (!echoInputToOutput)
            return new Q(line);
        return promiseOutput(line);
    }

    function newSession() {
        var replSessionDeferred = Q.defer();

        var lineReader = new LineReader(options.input, replSessionDeferred);

        function onScriptInput() {
            if (lineReader.isDone()) {
                if (options.output != process.stdout) {
                    options.output.end();
                }
                return;
            }

            promptForInput()
                .then(lineReader.readLine)
                .then(onEchoInput)
                .then(compileText)
                .then(executeScript)
                .then(options.transformResult)
                .then(printResult)
                .catch(function(err) { console.error(chalk.bold.red(err)); })
                .done(onScriptInput);
        }

        function sigintHandler() {
            options.output.write('\n');
            if (bufferedInput === '') {
                process.exit();
            }
            else {
                bufferedInput = '';
            }
        }

        process.on('SIGINT', sigintHandler);

        options.input.on('end', function() {
            process.removeListener('SIGINT', sigintHandler);
            replSessionDeferred.resolve("end-of-input");
        });
        options.input.on('error', function(err) {
            process.removeListener('SIGINT', sigintHandler);
            replSessionDeferred.reject(err);
        });

        onScriptInput();

        return replSessionDeferred.promise;
    }

    var replServer = {
        context: sandbox,
        endOfSessionPromise: newSession()
    };

    return replServer;
}

module.exports = { start: start };
