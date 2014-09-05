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
        self.pendingPromise.resolve(self.lines.shift());
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

    function promptForInput() {
        var promptForInputPromise = Q.defer();

        var prompt = options.prompt;
        if (bufferedInput !== '')
            prompt = '... ';

        options.output.write(prompt, 'utf8', function (err) {
            promptForInputPromise.resolve();
        });

        return promptForInputPromise.promise;
    }

    function compileText(text) {
        var compileTextPromise = Q.defer();

        if (bufferedInput !== '') {
            text = bufferedInput + '\n' + text;
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
        var printResultPromise = Q.defer();

        if (result === null || result === undefined) {
            printResultPromise.resolve();
        }
        else {
            var resultAsString = util.inspect(result, {depth: null});
            options.output.write(resultAsString + '\n', "utf8", function(err) {
                if (err) {
                    printResultPromise.reject(err);
                }
                else {
                    printResultPromise.resolve();
                }
            });
        }

        return printResultPromise.promise;
    }

    function onEchoInput(line) {
        var promise = Q.defer();

        if (echoInputToOutput) {
            options.output.write(line + '\n', "utf8", function(err) {
                if (err) {
                    promise.reject(err);
                }
                else {
                    promise.resolve(line);
                }
            });
        }
        else {
            promise.resolve(line);
        }

        return promise.promise;
    }

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

    options.input.on('end', function() {
        replSessionPromise.resolve("end-of-input");
    });
    options.input.on('error', function(err) {
        replSessionPromise.reject(err);
    });

    onScriptInput();

    return replSessionPromise.promise;
}

module.exports = { start: start };
