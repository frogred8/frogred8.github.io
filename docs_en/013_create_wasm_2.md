---
layout: page
title: "[WASM] Creating WebAssembly and examples (2)"
date: 2022-08-30
---

<pre>
This continues from the previous post. 
Your memory has probably gotten a bit hazy, so I'll just drop the table of contents and jump straight into parts 3 and 4.

1) WebAssembly Text Format
2) AssemblyScript
3) c/c++ (using Emscripten)
4) Rust


3. c/c++ (using Emscripten)

Before creating the example, there is one tool you absolutely need to know about. It is a compiler tool called Emscripten, one of LLVM's back-end compiler tools. Calling it a back end makes it sound like it only converts IR (Intermediate Representation) into machine code, but Emscripten's original purpose was actually to convert c/c++ code into JavaScript. 

Along the way, it went through the chaotic asm.js era, and now it works on converting IR (Intermediate Representation) files produced by LLVM into .wasm. I'm talking about the .bc/.ll files produced by the compiler front end (or middle end). Emscripten should really be explained together with a tool called Binaryen, but if I go too deep, this will be nothing but tool explanations, so I'll keep it brief. (Honestly, I don't know much..)

The AssemblyScript compiler (asc) that I briefly glossed over before is Binaryen. The one installed under node_modules. It can also convert WebAssembly -> js, and it can do WASM -> IR optimizing -> WASM conversions too. That last feature means Binaryen is used as an optimization tool because Emscripten's own optimization is limited, and they say it produces smaller and faster WASM files.

This is a side note, but the Binaryen FAQ page has this little snippet about the name. Since it even kindly tells you how to pronounce it, I guess the developer must be a Game of Thrones fan.

Why the weird name for the project?
- "Binaryen" is pronounced in the same manner as "Targaryen": bi-NAIR-ee-in. Or something like that? Anyhow, however Targaryen is correctly pronounced, they should rhyme. Aside from pronunciation, the Targaryen house words, "Fire and Blood", have also inspired Binaryen's: "Code and Bugs."


Now let's get into the actual example.

#include &lt;emscripten.h>
int EMSCRIPTEN_KEEPALIVE calc(int a, int b) {
  return a + b * 2;
}

$> emcc ./calc.c

I made a function that returns the result of a simple arithmetic operation, and below is the command line for compiling it with emcc. But you can see an EMSCRIPTEN~~ clause attached to the function return type, right? Like the export directive that came up when explaining .wat, this is a clause attached to functions that should be exposed outside the WASM. Besides adding it to the code like that, you can also specify the functions to expose at compile time.

$> emcc -s EXPORTED_FUNCTIONS=_calc ./calc.c

Isn't it a little strange that the function name here is _calc? I got a bit stuck on this, but apparently c compilers have traditionally used a prefixed underscore for external function mangling. There are various stories, including that it was to avoid confusion with functions declared in assembly, but anyway, it only recognized the function when I added the _. I have never really created an external module in c, so this is a part I don't know well. If anyone knows the details, please share the story in the comments.

Anyway, once compilation finishes, a.out.wasm and a.out.js files are created. You already know what the wasm file is, so to explain the js file, you can think of it as glue code generated so it can be attached to the browser. The generated js file is fairly long, over 2,000 lines, but if you look only for the function I made, it is bound like this.

/** @type {function(...*):?} */
var _calc = Module["_calc"] = createExportWrapper("calc");

There are several ways to use the generated a.out.wasm. As explained in the previous post, you can initialize and use it in node, but if you want to use it on the web, compile it with cwrap and ccall added to the compile options, then load the a.out.js file and configure it like this.

$> emcc ./calc.c -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']"

&lt;script src="a.out.js">&lt;/script>
&lt;script>
Module.onRuntimeInitialized = _ => {
  const calc = Module.cwrap('calc', 'number', ['number', 'number']);
  console.log(calc(10, 20));
};
&lt;/script>

When I put that content in index.html and tried it locally, I did get a CORS error, but after somehow working around it with http-server, 50 showed up nicely in the developer tools console. Connection successful!

Besides the web or node, you can also run a wasm file standalone. You add a main function to the code, change the compile options, and run it with an external tool. There is also a tool called wasmtime, but I used wasmer. I heard this one is faster and better. 

Below, I tried the changed example code, compilation, and execution all at once.

#include &lt;stdio.h>
int calc(int a, int b) {
  return a + b * 2;
}
int main() {
  int val = calc(10, 20);
  printf("%d\n", val);
  return 0;
}

$> emcc ./calc.c -s STANDALONE_WASM
$> wasmer a.out.wasm
50

You can confirm that it compiles properly and that the output value is correct.


4. Rust
I originally planned to cover Go too, but the binding process will probably be similar anyway, so I'll just do Rust. (Honestly, too much hassle..)
In Rust, a tool called wasm-bindgen is important because pure WASM can only pass numbers. You can somehow use shared memory to pass strings with some difficulty, but when you start thinking about passing objects or arrays, the reality gets overwhelming.

The tool that makes that easy is wasm-bindgen. It automatically generates intermediate glue code so Rust can pass and receive various things such as strings and objects to and from js, making it easier to use. The packaging tool for this is wasm-pack, and we'll use these things to make an example. You can think of cargo as a package manager for rust, like npm. I'll use it to install the tool and create the project.

$> cargo install wasm-pack 
$> cargo new --lib calc-wasm

In the generated calc-wasm folder, I deleted everything in src/lib.rs and put this example code there.

use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn calc(a: i32, b: i32) -> i32 {
    a + b * 2
}

This example means it will take two variables of type i32 and return an i32. With this, the function can be used from js. Now we'll compile it. Since rust configures build options in the cargo.toml file, I'll modify that too.

[lib]
crate-type = ["cdylib", "rlib"]
[dependencies]
wasm-bindgen = "0.2"

wasm-bindgen is still at 0.2.82 as the latest version. If you configure it like that, it works the same as ^0.2. The configuration is done, so shall we start the build?

$> wasm-pack build --target web

The first build does this and that, and after about 20 seconds the build finishes. Under the newly created pkg folder, js code for glue, the wasm file, and so on are generated. If you open the js file, it only receives two variables and passes them along, but if this had been a part passing strings, arrays, or objects instead of numbers, this part would have become quite complicated. As I said, wasm cannot use strings as-is, so it has to communicate by moving them into shared memory and passing them that way.

Anyway, besides that code, there is a lot of code that uses WebAssembly.instantiate to load wasm into js and initialize it. But the init function in the automatically generated js file did not get called automatically very well, so I just wrote it to force the call from index.html. I'll skip over the minor technical issues.

&lt;script type="module">
  import init from "./pkg/calc_wasm.js";
  init().then((js) => {
    console.log(js.calc(10,20));
  });
&lt;/script>

If you run it, you can see 50 printed in the developer tools console. With that, the web integration for a function made in rust is done too~
By the way, the official documentation for rust's wasm has well-organized examples for applying external objects like closures and WebGL. I was a little impressed by the detail, so take a look sometime. https://rustwasm.github.io/docs/wasm-bindgen/examples/


The WASM posts are finally wrapping up after 2 months. Actually, I had written almost all of it a long time ago and only needed to finish it, but once I put it down, for some reason I just couldn't get back to it.. I do feel a bit uneasy because it seems like I wrapped it up in a hurry, but I uploaded the example code to github, so I hope it can be a small help later when you start with wasm.
https://github.com/frogred8/wasm-sample


Since this is the last post in the series, I'll also add links to the related posts in the series. You can also find them by searching for my name tag on Blind.
What is WASM? https://frogred8.github.io/docs/010_asmjs_and_wasm/
What is LLVM? https://frogred8.github.io/docs/011_introduce_llvm/
WASM Example-1 https://frogred8.github.io/docs/012_create_wasm/
WASM Example-2 https://frogred8.github.io/docs/013_create_wasm_2/ (this post)

#frogred8 #WASM