repl-promise
============

[![Build Status](https://travis-ci.org/jimlloyd/repl-promise.svg)](https://travis-ci.org/jimlloyd/repl-promise)

A REPL for determinisic processing of input for scripts that use promises.

This REPL implementation is modeled after Node's [repl](http://nodejs.org/documentation/api/repl.html),
but unlike several other NPM packages that have been published which enhance Node's repl in various ways,
this implementation is a rewrite from scratch. It was implemented for three reasons:

1. Node's repl and readline do not behave deterministically when the input is a file stream. See [issue 3628](https://github.com/joyent/node/issues/3628), and in particular the [comment just added](https://github.com/joyent/node/issues/3628#issuecomment-54837098) requesting that the issue be reopened.
2. Node's repl is unware of promises. However, this problem is easily addressed using an add-on such as [repl-promised](https://www.npmjs.org/package/repl-promised).
3. As a learning exercise for the author to understand promises and in particular the package [Q](https://www.npmjs.org/package/q)

This implementation does not use readline and does not provide any of the niceties that one usually expects in a console application for command history, command completion, etc.

Why is it useful then?
----------------------

See problem #1 above. I'm still searching for a reasonable workaround.

In the meantime, I want to be able to use REPL sessions with input and output to/from file streams in unit tests. I want the output to be appear to be a transcript of a REPL session, so that unit tests result in useful examples.
