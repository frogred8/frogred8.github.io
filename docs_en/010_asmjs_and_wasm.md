---
layout: page
title: "[WASM] Understanding asm.js and WebAssembly"
date: 2022-06-16
---

<pre>
Today’s topic is WebAssembly, abbreviated as WASM and pronounced “wasm.” Let’s first look at why it was created and where it can be used.

JavaScript is slow. That’s because it was born as a scripting language that uses a JIT compiler.

1) When it receives text-based code, it has to split it into tokens,
2) build an abstract syntax tree (Abstract syntax tree, AST) from that tokenized information,
3) generate bytecode based on the AST,
4) and convert that bytecode into machine code depending on the platform currently running it.

When optimization gets involved, it becomes even more complicated. At the beginning of execution, the code runs in an unoptimized form. Then, as it runs multiple times, the engine estimates how long functions take to execute and predicts how useful optimization would be. For hot functions that it decides to optimize, it generates optimized code in real time and replaces the existing execution code with it. (TurboFan, which I’ve mentioned several times before)

You can think of asm.js and WebAssembly as the result of thinking through this whole process: “How can we make this run faster?”

But when you search for WebAssembly, you’ll probably see asm.js mentioned a lot. This was originally an individual feature first implemented in Firefox. asm.js is not something where you install a library or anything like that; it’s a spec implemented by the browser, and if the code meets its conditions, the browser compiles it directly into machine code. Let’s look at a function that applies asm.js below.

{
  function asmFunc() {
    "use asm";
    function plusOne(a) {
	  return (a+1)|0;
    }
    return {plusOne: plusOne};
  }
  var asmfn = asmFunc();
  console.log("plusOne: " + asmfn.plusOne(10));
}

On the first line of the function, you write the "use asm" directive to indicate that this function should be treated as asm.js. You can think of it as similar to "use strict". When the browser sees that directive, it tries to compile the function into machine code, but if the detailed conditions are not met, it simply interprets it as normal JavaScript.

asm.js is a feature focused only on optimizing arithmetic operations, so you have to explicitly tell it variable types using OR operations or symbols.
a|0 -> int, +a -> double, and so on. JavaScript code has to be structured like that for Firefox to attempt compiling it into machine code.
There are quite a few detailed conditions besides these, but there’s no real point digging into an old technology, so I’ll move on.

Anyway, Firefox started this kind of web optimization, but later Chrome and Edge also developed features that attempted optimization when they encountered the "use asm" directive. As each vendor developed its own implementation, there came a need for a unified standard, and after discussions in the W3C Community Group, WebAssembly was born.
For reference, Chrome was also developing a project called PNaCl (Portable Native Client) around that time, which started with a concept similar to WASI, which I’ll explain below. Of course, development has now been discontinued as things have been unified around WASI.

There are several reasons to use WASM. One is the performance improvement for mathematical operations, but it’s also because it runs faster than the same JS code. JS code has a larger file size than WASM, and it requires parsing, type inference, and JIT. WASM, however, is already written as IR (Intermediate Representation), so it only needs to be loaded into memory as-is without parsing. Types are already included, and as each language generates a .wasm file, the compiler has already applied static-language optimizations. This means it can be used with less dependence on browser optimization techniques. Naturally, it is also faster and more efficient.

Based on WASM, WASI (WebAssembly System Interface) was created. It is an interface specification that works regardless of platform (CPU, OS). With this, WASM, which was previously used only on the web, can be used on every platform, and system calls are also possible within authorized folders.
There’s nothing special we need to do for this; we just need to compile with a compiler that supports WASI. Since WASI appeared not long after WASM came out, you can basically consider it already applied everywhere now.

WASI is supported by most major languages, including C/C++, Rust, Go, Python, AssemblyScript, and others. Recently, it also seems to be supported in .NET. It’s amazing even while looking at it.
https://docs.microsoft.com/ko-kr/events/build-2022/od108-future-possibilities-net-core-wasi-webassembly-on-server

.wasm files can be created by taking the IR produced by each language’s compiler and converting it into .wasm. This is supported by each language’s compiler, but clang does not have a .wasm compilation feature, so the only difference is that it uses an external program called Emscripten for that conversion.

c/c++ -> clang -> LLVM (IR) -> Emscripten -> .wasm
Rust -> cargo -> LLVM (IR) -> .wasm
Go -> TinyGo -> LLVM (IR) -> .wasm

There are actually a few more ways to create .wasm files. But that section would get too long, so I’ll go through it in detail with examples in the next post. For now, I’ll just give a brief introduction.

1) c/c++ (Emscripten)
2) Rust, Go
3) AssemblyScript
4) WebAssembly Text Format


It feels a bit unsatisfying to end here, so let’s briefly look at code that runs WASM. The generated .wasm file is a binary file, and it can be loaded and used like an external module. Below is simple code that reads a .wasm file exposing a sayHi function in Node and calls it.

WebAssembly.instantiateStreaming(fetch('/hello_world.wasm'), imports)
  .then(wasm => {
    let func = wasm.instance.exports.sayHi;
    console.log(func());
  });

There is a function called instantiate that is similar to instantiateStreaming, but the guides recommend the inst~Streaming function. The reason is that instantiate requires passing an arrayBuffer containing the fully read .wasm file, which causes one copy to occur. inst~Streaming, on the other hand, passes directly from the read buffer, so no copy occurs. It also compiles while receiving the data being fetched in real time, which reduces waiting time, so keep that in mind.


Conclusion)
1) asm.js once existed for browser optimization, but it has now been unified into WebAssembly.
2) With the emergence of the higher-level concept WebAssembly System Interface (WASI), we now have powerful modules that can run regardless of platform.
3) WASM has better initial execution speed and performance than JS.
4) The next post will probably be quite long..


WebAssembly is such a broad topic, and recent articles and older articles are mixed together, so I spent days wandering around trying to sort it out. I even lost a whole day trying to run an already deprecated asm.js example..
To be honest, I’m not completely confident, but since this is what I studied, I tried organizing it anyway. If there’s any incorrect information, please let me know in the comments.

#frogred8 #WebAssembly #WASM
</pre>
