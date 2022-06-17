---
layout: page
title: "[WASM] WebAssembly 생성 방법 및 예제 (WIP)"
nav_exclude: true
---

## [WASM] WebAssembly 생성 방법 및 예제 (WIP)

<pre>

이전 글에서는 WebAssembly(이하 WASM)에 대해 전반적으로 알아봤어. 이번 글에서는 실제로 WASM 생성을 해볼거야. 근데 예제를 생성하려다보니 코드가 좀 있는데 천천히 따라와 봐.

전에 말했다시피 WASM 만드는 방법에는 4가지가 있어. 하나씩 순서대로 해볼게.

1) c/c++ (using Emscripten)
2) Rust, Go
3) AssemblyScript
4) WebAssembly Text Format


1. c/c++ (using Emscripten)

Emcripten은 llvm로 나온 IR(Intermediate Representation) 파일을 .wasm으로 변경하는 일을 맡고 있어.











~/work/wasm                                                                                     09:11:37
❯ node a.out.js
hello_world: 1836311903

~/work/wasm                                                                                 16s 09:11:56
❯ node hello_world.js
hello_world: 1836311903

~/work/wasm                                                                                 14s 09:13:23
❯ node a.out_1.js
hello_world: 1836311903

~/work/wasm                                                                                 23s 13:01:17
❯