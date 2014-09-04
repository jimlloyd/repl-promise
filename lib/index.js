// repl-promise/lib/index.js

'use strict';

var byline = require('byline');
var Q = require('q');
var util = require('util');
var vm = require('vm');

function start(options) {
    var replSessionPromise = Q.defer();

    options = options || {};
    options.input = options.input || process.stdin;
    options.output = options.output || process.stdout;
    options.prompt = options.prompt || '> ';

    options.input.setEncoding('utf8');
    options.output.setEncoding('utf8');
    
    options.input = byline(options.input);
    
    var sandbox = vm.createContext();
    
    function promptForInput() {
        var promptForInputPromise = Q.defer();
        
        options.output.write(options.prompt, 'utf8', function (err) {
            if (err) {
                promptForInputPromise.reject(err);
            }
            else {
                promptForInputPromise.resolve();
            }
        });
        
        return promptForInputPromise.promise;
    }
    
    function readLine() {
        var readLinePromise = Q.defer();
    
        options.input.on('data', function(line) {
            options.input.pause();
            readLinePromise.resolve(line);
        });
        options.input.on('end', function() {
            replSessionPromise.resolve("end-of-input");
        });
        options.input.on('error', function(err) {
            readLinePromise.reject(err);
        });
    
        return readLinePromise.promise;
    }

    function compileText(text) {
        var compileTextPromise = Q.defer();
    
        try {
            var script = vm.createScript(text, 'repl.vm');
            compileTextPromise.resolve(script);
        }
        catch (err) {
            compileTextPromise.resolve(err);
        }
    
        return compileTextPromise.promise;
    }

    function executeScript(script) {
        var executeScriptPromise = Q.defer();
    
        var result = script.runInNewContext(sandbox);
        executeScriptPromise.resolve(result);
    
        return executeScriptPromise.promise;
    }

    function printResult(result) {
        var printResultPromise = Q.defer();
    
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
    
        return printResultPromise.promise;
    }
    
    function replLoop() {
        return promptForInput()
            .then(readLine)
            .then(compileText)
            .then(executeScript)
            .then(printResult)
            .then(replLoop)
            .done();
    }
    
    replLoop();
    
    return replSessionPromise.promise;
}

module.exports = { start: start };
