// repl-promise/lib/index.js

'use strict';

var byline = require('byline');
var Q = require('q');
var util = require('util');
var vm = require('vm');

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

function start(options) {
    options = options || {};
    options.input = options.input || process.stdin;
    options.output = options.output || process.stdout;
    options.prompt = options.prompt || '> ';

    options.input.setEncoding('utf8');
    options.output.setEncoding('utf8');

    options.input = byline(options.input);

    var sandbox = vm.createContext();
    
    var bufferedInput = '';
    
    var nullScript = vm.createScript('null;', {filename: 'null.vm', displayErrors: false});

    function promptForInput() {
        var promptForInputPromise = Q.defer();
        
        var prompt = options.prompt;
        if (bufferedInput !== '')
            prompt = '... ';

        options.output.write(prompt, 'utf8', function (err) {
            if (err) {
                promptForInputPromise.reject(err);
            }
            else {
                promptForInputPromise.resolve();
            }
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

        if (script === nullScript) {
            executeScriptPromise.resolve(null);
        }
        else {
            var result = script.runInNewContext(sandbox);
            executeScriptPromise.resolve(result);
        }

        return executeScriptPromise.promise;
    }

    function printResult(result) {
        var printResultPromise = Q.defer();

        if (result === null || result === undefined) {
            options.input.resume();
            printResultPromise.resolve();
        }
        else {
            var resultAsString = util.inspect(result, {depth: null});
            options.output.write(resultAsString + '\n', "utf8", function(err) {
                if (err) {
                    printResultPromise.reject(err);
                }
                else {
                    options.input.resume();
                    printResultPromise.resolve();
                }
            });
        }

        return printResultPromise.promise;
    }
    
    function onScriptInput(line) {
        options.input.pause();
        var readLinePromise = Q.defer();
        readLinePromise.resolve(line);
        
        readLinePromise.promise
            .then(compileText)
            .then(executeScript)
            .then(printResult)
            .then(promptForInput)
            .catch(function(err) { console.log("CAUGHT", err); })
            .done();
    }

    var replSessionPromise = Q.defer();

    options.input.on('data', onScriptInput);
    options.input.on('end', function() {
        replSessionPromise.resolve("end-of-input");
    });
    options.input.on('error', function(err) {
        replSessionPromise.reject(err);
    });

    return replSessionPromise.promise;
}

module.exports = { start: start };
