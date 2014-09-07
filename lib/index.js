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
    self.pendingPromise = null;
    self.done = false;

    self.isDone = function() {
        return self.done && self.lines.length===0;
    };

    self.fullfill = function() {
        var line = self.lines.shift();
        if (line)
            line = line + '\n';
        self.pendingPromise.resolve(line);
        var result = self.pendingPromise.promise;
        self.pendingPromise = null;
        return result;
    };

    self.readLine = function() {
        if (self.pendingPromise !== null) {
            throw new Error('LineReader.readLine called before pendingPromise fulfilled');
        }
        self.pendingPromise = Q.defer();

        if (self.isDone()) {
            endOfInput.resolve(null);
            return self.fullfill();
        }

        if (self.lines.length > 0) {
            return self.fullfill();
        }

        return self.pendingPromise.promise;
    };

    process.on('SIGINT', function() {
        self.remaining = '';
        self.lines = [''];
        if (self.pendingPromise !== null) {
            self.fullfill();
        }
    });

    inputStream.on('data', function(chunk) {
        self.remaining = self.remaining + chunk.toString();
        var newLines = self.remaining.split('\n');
        self.lines = self.lines.concat(_.initial(newLines));
        self.remaining = _.last(newLines);
        if (self.pendingPromise!==null && self.lines.length>0) {
            self.fullfill();
        }
    });

    inputStream.on('end', function() {
        self.done = true;
    });
}

function start(options) {
    options = options || {};
    options.input = options.input || process.stdin;
    options.output = options.output || process.stdout;
    options.prompt = options.prompt || '> ';

    var echoInputToOutput = !options.output.isTTY || !options.input.isTTY;

    var initContext = {
        require: require,
        console: console,
        process: process,
        Q: Q,
    };

    var sandbox = vm.createContext(initContext);
    var bufferedInput = '';
    var nullScript = vm.createScript('null;', {filename: 'null.vm', displayErrors: false});

    function promiseOutput(line) {
        var promise = Q.defer();

        // This may seem like a case where we could use Q.nbind or printResultPromise.makeNodeResolver(),
        // but output.write uses a callback that only takes an err argument, and we need
        // to call promise.resolve() with line as its argument.
        options.output.write(line, "utf8", function(err) {
            if (err) {
                promise.reject(err);
            }
            else {
                promise.resolve(line);
            }
        });

        return promise.promise;
    }

    function promptForInput() {
        var prompt = options.prompt;
        if (bufferedInput !== '')
            prompt = '... ';
        return promiseOutput(prompt);
    }

    function compileText(text) {
        var compileTextPromise = Q.defer();

        if (bufferedInput !== '') {
            text = bufferedInput + text;
            bufferedInput = '';
        }

        try {
            var script = vm.createScript(text, {filename: 'repl.vm', displayErrors: false});
            compileTextPromise.resolve(script);
        }
        catch (e) {
            var err;
            if (isRecoverableError(e)) {
                bufferedInput = text;
                compileTextPromise.resolve(nullScript);
            }
            else {
                err = e;
                compileTextPromise.reject(err);
            }
        }

        return compileTextPromise.promise;
    }

    function executeScript(script) {
        var executeScriptPromise = Q.defer();
        try {
            var result = script.runInNewContext(sandbox);
            executeScriptPromise.resolve(result);
        }
        catch (err) {
            console.error(chalk.bold.red(err));
            executeScriptPromise.resolve(null);
        }

        return executeScriptPromise.promise;
    }

    function printResult(result) {
        if (result === null || result === undefined) {
            return new Q(result);
        }
        else {
            var resultAsString = util.inspect(result, {depth: null});
            return promiseOutput(resultAsString + '\n');
        }
    }

    function onEchoInput(line) {
        if (!echoInputToOutput)
            return new Q(line);
        return promiseOutput(line);
    }

    function newSession() {
        var replSessionPromise = Q.defer();

        var lineReader = new LineReader(options.input, replSessionPromise);

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
                .then(printResult)
                .catch(function(err) { console.error(chalk.bold.red(err)); })
                .done(onScriptInput);
        }

        process.on('SIGINT', function() {
            options.output.write('\n');
            if (bufferedInput === '') {
                process.exit();
            }
            else {
                bufferedInput = '';
            }
        });

        options.input.on('end', function() {
            replSessionPromise.resolve("end-of-input");
        });
        options.input.on('error', function(err) {
            replSessionPromise.reject(err);
        });

        onScriptInput();

        return replSessionPromise.promise;
    }

    return newSession();
}

module.exports = { start: start };
