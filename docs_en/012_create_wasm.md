---
layout: page
title: "[WASM] Creating WebAssembly and examples (1)"
date: 2022-06-21
---

<pre>
In the previous post, we looked at clang, which is part of LLVM. The reason I suddenly went deep into that while explaining WebAssembly (WASM from here on) is that understanding LLVM was necessary when explaining a tool called Emscripten. In this post, we'll actually generate WASM. The example ended up having quite a bit of code, but follow along slowly.

First, a .wasm file is made up as a binary file, and its file format is similar to ELF (Executable and Linkable Format) or Mach-O (Mach Object file format). 

Since these are new keywords, let me briefly wander over there. ELF is the executable/library header format for Linux/Unix-like systems, and Mach-O is the header format for OSX (iOS, macOS, and so on). You can inspect them with the readelf command on Linux and the otool command on OSX, so let's quickly look at the output.

#> readelf -e libstdbuf.so
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              DYN (Shared object file)
  Machine:                           AArch64
  Version:                           0x1
...

$> otool -h calc
calc:
Mach header
      magic  cputype cpusubtype  caps    filetype ncmds sizeofcmds      flags
 0xfeedfacf 16777228          0  0x00           2    17       1056 0x00200085

Linux gives fairly detailed output, but OSX is unfriendly, so I just looked up the filetype, and type 2 was an executable file. There are so many things I didn't know that I keep going off on tangents. Now I'll really move on to WASM.

As I said before, there are four ways to make WASM. We'll look at them in order, but in this post we'll only cover numbers 1 and 2, and look at the rest in the next part. It's too much to cover all at once.

1) WebAssembly Text Format
2) AssemblyScript
3) c/c++ (using Emscripten)
4) Rust, Go


1. WebAssembly Text Format

WASM has a separate language that looks like LLVM's IR. It uses an S-expression (symbolic expression) format, so it looks similar to Lisp or Clojure. The file has a .wat (WebAssembly Text) extension, and you'll get the general idea from the example code below. I included a little more here so I can explain import and export, but for the others I'll only implement add, so keep that in mind.

// add.wat
(module
  (import "custom" "log" (func $logger (param i32)))
  (func $add (param $lhs i32) (param $rhs i32)
    local.get $lhs
    local.get $rhs
  	i32.add
    call $logger
  )
  (export "add" (func $add))
)

Right after the module declaration, import redeclares the external function custom.log, received at WASM initialization time, as logger. import must appear before every other instruction. The object passed here will come up once more later in the section analyzing the call site.

After that, the internal function we implemented is named add, and it takes two parameters: lhs and rhs, both of type i32. The local.get instructions that follow mean loading parameters into stack memory. In this way, the two variables are sequentially loaded onto the stack, or register, and the i32.add instruction is executed. Then, according to the instruction specification, it takes the two i32 values on the stack, adds them, and returns the result.

And because the returned value is on the stack, we call the logger function and use that value. The export on the next line means exposing the add function under the name add. Now we should compile it to WASM, right? 

For compilation, you can download the repo with git clone --recursive https://github.com/WebAssembly/wabt, install cmake, and then follow the guide. But it feels like you need to register the path in your .zshrc file yourself.

For reference, there are many examples on Namuwiki or blogs that use get_local, and that's because this changed not too long ago. I was also wondering why it didn't work, and it turned out the PR was merged in December 2021 after a full two years of discussion. https://github.com/WebAssembly/wabt/pull/1792

Anyway, with that, the wat2wasm compiler is ready. If you run the command below, an add.wasm file will be created.

$> wat2wasm add.wat -o add.wasm

// sample.js
const fs = require('fs');
var importObject = {
  custom: {
    log: function(arg) {
      console.log(arg);
    }
  }
};
var buf = fs.readFileSync('add.wasm');
WebAssembly.instantiate(buf, importObject)
  .then(obj => obj.instance.exports.add(2, 5));

You can see that importObject is passed while add.wasm is loaded with the instantiate function. The functions in the object passed this way can be called from inside WASM. The examples below repeat the same pattern, so I won't explain the WASM call site anymore.

So we've looked at WebAssembly Text code and compilation. Now let's also briefly look at wasm2wat among the compilers we installed earlier. If not now, we probably won't have another reason to look at it anyway. wasm2wat is, literally, a tool that decompiles wasm into wat, and I tried it because I was curious how different it would be from the original.

$> wasm2wat add.wasm -o add.de.wat

// add.de.wat
(module
  (type (;0;) (func (param i32)))
  (type (;1;) (func (param i32 i32)))
  (import "custom" "log" (func (;0;) (type 0)))
  (func (;1;) (type 1) (param i32 i32)
    local.get 0
    local.get 1
    i32.add
    call 0)
  (export "add" (func 1)))

It became a little longer than the original. First, you can see that the variable names I put in the parameters changed into offsets like 0 and 1, and the function names were also replaced with indexes declared as types. In fact, the example didn't really need names either, but I added them as aliases to make it easier to read, so they definitely disappeared after decompilation.

If you want to test it out quickly, there's a web REPL implementation here, so you can try it once. https://webassembly.github.io/wabt/demo/wat2wasm/


2. AssemblyScript

But if you write a wat file, you have to know exactly how many values you've put on the stack and what types they are, which isn't easy, right? So AssemblyScript came out as a kind of superset. If I describe the relationship between AssemblyScript and wat, you can think of it like TypeScript -> JavaScript. Then let's install AssemblyScript and first look at the generated example index.ts file.

$> npm init
$> npm i --save-dev assemblyscript
$> npx asinit .

// index.ts
export function add(a: i32, b: i32): i32 {
  return a + b;
}

If you follow the guide, it creates an example project for you. The index.ts file implements exactly the add function we wanted, and if it's declared with export, that means it will be exposed externally. You can use most TypeScript syntax as-is, so it has become much more convenient. You can run the actual compilation with the command below.

$> npm run asbuild

When you run it, it creates js, wat, and wasm files under the build folder for both debug and release. You can think of the js file here as automatically implementing the wasm call site. Here, we'll look at the call-site js file first.

// release.js
async function instantiate(module, imports = {}) {
  const { exports } = await WebAssembly.instantiate(module, imports);
  return exports;
}
export const {
  add
} = await (async url => instantiate(
  await (async () => {
    try { return await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url)); }
    catch { return globalThis.WebAssembly.compile(await (await import("node:fs/promises")).readFile(url)); }
  })(), {
  }
))(new URL("release.wasm", import.meta.url));

The instantiate function declared here initializes the module, and the string-related function I'll explain later will be implemented here. The other syntax is straightforward, so I won't explain it separately. Then shall we look at the wat file after the js file? First, I opened debug.wat. Compared with release.wat, I marked the added lines with ! at the start of the line, so keep that in mind.

(module
 (type $i32_i32_=>_i32 (func (param i32 i32) (result i32)))
 !(global $~lib/memory/__data_end i32 (i32.const 8))
 !(global $~lib/memory/__stack_pointer (mut i32) (i32.const 16392))
 !(global $~lib/memory/__heap_base i32 (i32.const 16392))
 (memory $0 0)
 !(table $0 1 1 funcref)
 !(elem $0 (i32.const 1))
 (export "add" (func $assembly/index/add))
 (export "memory" (memory $0))
 (func $assembly/index/add (param $0 i32) (param $1 i32) (result i32)
  local.get $0
  local.get $1
  i32.add
 )
)

If you exclude the lines added in debug, you can see that it comes out almost the same as what we made by hand. But this is a bit late to mention, but in a wat file, anything other than numeric types is tricky to use, especially strings. wat doesn't have string handling functions, can't allocate its own memory, and has some convenience issues like that. 

When the module initializes, it has to create a memory buffer, have wat work in that buffer and return, and then the calling function side has to treat it as a memory buffer and decode it into a string and do all kinds of things like that. 

If you change it to a string-returning function as below and compile it, the wat looks clean, but the js file generated for the call site is a mess. We'll look at ts, wat, and js in that order, but this isn't important, so let's just glance over it as "this is roughly what it looks like." (For the js file, the logic below it is the same, so I only brought over the instantiate function.)

// index.ts
export function hello(): string {
  return 'hello world';
}

// release.wat
(module
 (type $none_=>_i32 (func (result i32)))
 (memory $0 1)
 (data (i32.const 1036) ",")
 (data (i32.const 1048) "\01\00\00\00\16\00\00\00h\00e\00l\00l\00o\00 \00w\00o\00r\00l\00d")
 (export "hello" (func $assembly/index/hello))
 (export "memory" (memory $0))
 (func $assembly/index/hello (result i32)
  i32.const 1056
 )
)

// release.js
async function instantiate(module, imports = {}) {
  const { exports } = await WebAssembly.instantiate(module, imports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    hello() {
      // assembly/index/hello() => ~lib/string/String
      return __liftString(exports.hello() >>> 0);
    },
  }, exports);
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  return adaptedExports;
}


This one was a bit long, right? Most people reading this post probably won't actually build it themselves, so I pasted it as-is without trimming it down just to show it to you, and the page ended up getting pretty long. Still, among all the expired or incorrect information on the internet, I only included things I personally ran, so it should be the current version.

After the next WASM post, I should move on to a lighter topic. Since I've been studying just one topic for over three weeks, it's slowly getting less fun. I hope you enjoy this post too.

Previous post: https://frogred8.github.io/
#frogred8 #WASM #AssemblyScript
</pre>
