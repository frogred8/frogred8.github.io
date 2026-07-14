---
layout: page
title: "[javascript] The evolution of the v8 engine compiler"
date: 2022-05-09
---

<pre>
Today I’m going to introduce the overall history of how V8’s compilers have changed. There’s nothing too complicated, so just read it comfortably.


Strictly speaking, V8 is just the name of the JavaScript engine in the Chrome browser. Just like Firefox has SpiderMonkey, Safari has WebKit (JavaScriptCore), and each browser has its own JavaScript engine. In the early 2010s, when many different browsers coexisted, V8 kept improving and eventually became the final winner of the browser wars. Of course, extension support also played a big role. (Popup translation is love)

As a side note, because V8 became this fast, it turned into a powerful engine capable of running JavaScript, and one project adopted V8 as its compilation engine and developed an application by combining it with libuv. That project is Node.js, and the person who created it is Ryan Dahl.

That’s the basic introduction. Now, looking at the beginning of V8 development,
the original V8 started as a fork of WebCore code, one of WebKit’s modules. Development continued based on that, and 2011 became a turning point, when Full-codegen and Crankshaft were added. With this improvement, V8 achieved a dramatic performance gain of over 50% compared to before. And even the previous version was already on the fast side among browsers.

Full-codegen, the compiler added at that time, was a compiler that interpreted JavaScript code and turned it into bytecode, while Crankshaft was a compiler that built an abstract tree (SSA) from that bytecode and optimized it. Since not all code needed to be optimized by Crankshaft, the first execution used basic bytecode compiled by Full-codegen, and only hot functions that were executed repeatedly were optimized in real time.

After those two early compilers came out, new compilers called Ignition and TurboFan appeared in 2017.
Like Full-codegen, Ignition has the same role of producing bytecode, but it is more advanced than before. Previously, bytecode could only be generated after loading the entire code into memory, but Ignition could interpret code line by line and produce bytecode, so memory usage was much lower. This was especially advantageous on mobile.

TurboFan was an optimizing compiler, just like the earlier Crankshaft, but with new features such as Inline Cache, Hidden Class, and CodeStubAssembler (CSA below), memory usage, maintainability, and performance all improved.

In fact, in the early days of replacing the engine, the performance improvement was smaller than expected, but performance gradually got faster as frequently used built-in functions were reimplemented with CSA. For example, they say reimplementing Promise with CSA produced a severalfold performance improvement.


And WebAssembly (WASM below) is getting popular these days, right? Things like compiling code written in Rust to WASM and using it. V8 also supports WASM, but in the beginning it was quite slow. That’s because WASM is bytecode compiled with LLVM, and it had to go through TurboFan before it could run.

What came out to improve this was Liftoff, a dedicated compiler for WebAssembly. Like Ignition, its role is to execute bytecode directly. They say it can compile while downloading, so it’s quite useful. Because of this characteristic, it can generate code much faster than TurboFan, but since it does not go through optimization, its downside is that performance is 50% to 70% lower than code compiled with TurboFan.

But Google wouldn’t just leave that as it was, right? So WASM first gets running quickly through the Liftoff compiler, while the TurboFan compiler works hard on optimization in the background. At this point, optimization proceeds at the function level, and as soon as an optimization task is completed, the existing function is replaced to improve performance. This process repeats until every function has been optimized.


Conclusion)
1) V8 is Chrome’s JavaScript engine and also the engine for Node.js.
2) Full-codegen (not used), Ignition: bytecode compilers
3) Crankshaft (not used), TurboFan: optimizing compilers
4) Liftoff: WASM bytecode compiler
5) The naming is all car parts..

What I’ve summarized here is only a small part, and if you search Google for the related keywords, there is a huge amount of information, so reading through some of it should help. Compared to this unfriendly post, there are plenty of performance graphs and example code too.

See you next time.

#javascript #v8

</pre>
