---
layout: page
title: "[etc] Getting to know LLVM (clang)"
date: 2022-06-18
---

<pre>
While learning about WebAssembly, LLVM kept coming up. It wasn’t easy to just move on without a proper understanding of it, so I decided to write up a summary.

In broad terms, a compiler is divided into a front-end and a back-end (fe and be below). The fe performs lexical/syntactic analysis, generates intermediate code, and optimizes it; the be generates machine code that can run on the target platform and optimizes that machine code.
The IR (Intermediate Representation) produced by the fe is platform-independent, while the output of the be is platform-dependent. Stack-based bytecode used in the JVM or .NET can also be understood as IR in the same context.

For compilers that output IR like this, the advantage is that the result is platform-independent, so a single output can be distributed to multiple platforms. And where this output is executed, a virtual machine usually compiles the required parts of the IR in real time at startup or during execution and loads them into memory. This is basically the definition of JIT (Just-In-Time) compilation.

Taking Ignition and Turbofan, which came up before when talking about the v8 compiler, as examples, (https://frogred8.github.io/docs/004_v8_engine_history)
Ignition generates bytecode (IR) from the parsed abstract syntax tree (AST) (fe), and also converts it into machine code (be), so you could say it plays both fe and be roles. Turbofan, on the other hand, is an engine responsible only for optimizing machine code, so it can be considered a compiler at the end of the be.

These days, in addition to fe and be, there is also a 3-phase model that includes a middle-end responsible for optimizing IR, and LLVM uses this approach. LLVM stands for Low Level Virtual Machine, but it has nothing to do with a VM, and even the official site says not to put much meaning into the words themselves, so just remember that this is where the name came from. So what we now call LLVM can be understood as the name of a compiler framework project.

In the early days, when Apple was developing Objective-C, they used gcc as the compiler, but because the specs they wanted kept getting postponed and not added, they created clang, an open-source compiler based on LLVM. Apparently it should be pronounced "clang," but because of my old habit I keep reading it as "C-lang." Anyway, Apple is still hiring clang compiler developers, so I guess there is still a lot of work to do. (Sometimes on Stack Overflow, answers related to v8 that start with "V8 developer here." from Google engineers look really cool, and clang developers must give off that same cool vibe.)

clang supports c/c++, and Objective-C. I’ll try a few fun things with a simple c example.

// calc.c
int calc(int a, int b) {
  return a + b * 2;
}

Because everything is modularized at each compilation stage in line with LLVM’s goals, you can inspect all kinds of things. Shall we take a look at the abstract syntax tree (AST)?

$> clang -Xclang -ast-dump -fsyntax-only calc.c

...
`-FunctionDecl 0x14980d9c0 <calc.c:1:1, line:3:1> line:1:5 calc 'int (int, int)'
  |-ParmVarDecl 0x14980d868 <col:10, col:14> col:14 used a 'int'
  |-ParmVarDecl 0x14980d8e8 <col:17, col:21> col:21 used b 'int'
  `-CompoundStmt 0x14980db98 <col:24, line:3:1>
    `-ReturnStmt 0x14980db88 <line:2:3, col:18>
      `-BinaryOperator 0x14980db68 <col:10, col:18> 'int' '+'
        |-ImplicitCastExpr 0x14980db50 <col:10> 'int' <LValueToRValue>
        | `-DeclRefExpr 0x14980dab8 <col:10> 'int' lvalue ParmVar 0x14980d868 'a' 'int'
        `-BinaryOperator 0x14980db30 <col:14, col:18> 'int' '*'
          |-ImplicitCastExpr 0x14980db18 <col:14> 'int' <LValueToRValue>
          | `-DeclRefExpr 0x14980dad8 <col:14> 'int' lvalue ParmVar 0x14980d8e8 'b' 'int'
          `-IntegerLiteral 0x14980daf8 <col:18> 'int' 2

I brought in the part starting from the calc function declaration, and you can see the parameters a and b. In the return part, you can also see that the tree for the a+b*2 code is structured nicely. It looks really elegant in a zsh shell, but there’s no way to convey that feeling here. If you change it to -ast-dump=json, it prints as JSON. Also, if you use the -emit-ast option, it outputs a calc.ast binary file, but I couldn’t really do anything with it. The -fsyntax-only option doesn’t have to be there, but I added it because I didn’t want it to try compiling and throw an error.

Now I’ll look at the real IR.

$> clang -emit-llvm -c calc.c
$> clang -emit-llvm -S calc.c

Both are options that output IR. -c outputs the calc.bc (bitcode) binary file, and -S outputs the calc.ll text file. Since the bc file is binary and there isn’t much to see, I’ll skip it and go through the ll file in order.

; ModuleID = 'calc.c'
source_filename = "calc.c"
target datalayout = "e-m:o-i64:64-i128:128-n32:64-S128"
target triple = "arm64-apple-macosx12.0.0"

Starting from the first paragraph, you can see the file that was being compiled, the datalayout, and the triple. The meaning of datalayout can be found by splitting it into tokens by hyphens. The first letter means big/little endian; e means little endian, m:o means ELF (Executable and Linkable Format), and i64:64 means i64 should be allocated 64 bits.
The triple field is written in the format {arch}{sub}-{vendor}-{sys}-{abi}, and I think it appears like that because I’m on an M1.

Next is the function body.

; Function Attrs: noinline nounwind optnone ssp uwtable
define i32 @calc(i32 %0, i32 %1) #0 {
  %3 = alloca i32, align 4
  %4 = alloca i32, align 4
  store i32 %0, i32* %3, align 4
  store i32 %1, i32* %4, align 4
  %5 = load i32, i32* %3, align 4
  %6 = load i32, i32* %4, align 4
  %7 = mul nsw i32 %6, 2
  %8 = add nsw i32 %5, %7
  ret i32 %8
}

Doesn’t it look similar to the bytecode from the js file I explained before? That bytecode also plays the role of IR. Now I’ll analyze it line by line.

%3 = alloca i32, align 4
Allocate 4 bytes as type i32 to the %3 variable. If the final align is omitted, it works according to the target’s ABI (Application Binary Interface) alignment. If the target is i64, it will allocate 8 bytes, and if it is i32, it will allocate 4 bytes. This is information you would look at when writing by hand or examining details, so just keep it in mind.
store i32 %0, i32* %3, align 4
// Store %0, which is type i32, at the address %3
%5 = load i32, i32* %3, align 4
// Read an i32 value from the i32 address %3 into %5
%7 = mul nsw i32 %6, 2
// Store the result of calculating %6*2 in %7. Here, if the No Signed Wrap option is added, undefined behavior is triggered when overflow occurs.
%8 = add nsw i32 %5, %7
// Store the result of calculating %5+%7 in %8.
ret i32 %8
// Return the %8 value as type i32

For reference, .ll files and .bc files can be converted to each other with the commands below.

$> llvm-as calc.ll
$> llvm-dis calc.bc

Now that we’ve seen the IR, shall we also extract the assembly? When compiled to asm, it comes out as a .s file, and there are two ways to do it: using clang and using llc. llc takes an IR file as an input argument, and it converts both ll and bc files.

$> clang -S calc.c
$> llc calc.ll

The calc.s file looks like this, and it’s ordinary assembly.

  .section	__TEXT,__text,regular,pure_instructions
  .build_version macos, 12, 0	sdk_version 12, 3
  .globl	_calc                           ; -- Begin function calc
  .p2align	2
_calc:                                  ; @calc
  .cfi_startproc
; %bb.0:
  sub	sp, sp, #16                     ; =16
  .cfi_def_cfa_offset 16
  str	w0, [sp, #12]
  str	w1, [sp, #8]
  ldr	w8, [sp, #12]
  ldr	w9, [sp, #8]
  add	w0, w8, w9, lsl #1
  add	sp, sp, #16                     ; =16
  ret
  .cfi_endproc
                                    ; -- End function
.subsections_via_symbols

Now it’s time to turn that assembly file into an object file. However, from the next step onward, a main function is needed to proceed, so I added a main function that calls calc and continued.

// calc.c
#include &lt;stdio.h>
int calc(int a, int b) {
  return a + b * 2;
}
int main() {
  int val = calc(10, 20);
  printf("%d", val);
  return 0;
}

$> clang -c calc.s

Looking at the description of the -c option, it says, 'Run all of the above, plus the assembler, generating a target ".o" object file.' So I tried specifying intermediate-stage files like .ll or .bc as well, and it produced calc.o just fine. Smart, very smart.
If you create an executable file from the resulting calc.o object file and run it, you can confirm that it prints the output value 50 correctly.

$> clang calc.o -o calc
$> ./calc
50

But actually, if you run 'clang calc.c -o calc', it just creates the executable and works lol. Most people will probably use it that way, but anyway, it was fun to build it step by step and check the intermediate stages.

Conclusion)
1) A compiler usually consists of 2 phases (fe/be), but LLVM has 3 phases (fe/me/be), with an IR optimization stage in the middle-end.
2) LLVM is only the name of a compiler framework, and clang is the representative compiler.
3) When compiling with clang, you can print and inspect the output produced at each stage.

I need to finish WASM, but I just wrote up what I studied first because I felt like it. Whenever new keywords, options, or concepts come up, I tend to look each of them up, but as expected, compilers are not easy. I also looked quite a bit at the LALR (LookAhead Left-to-Right) Parser part, but I didn’t understand it well enough to explain it, so I gave up. It made me resolve not to look at the parser part.

This is an unfamiliar area for me, so if there is any incorrect information, please let me know anytime.

#frogred8 #llvm #clang