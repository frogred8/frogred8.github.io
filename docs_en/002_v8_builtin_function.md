---
layout: page
title: "[javascript] Analyzing built-in functions"
date: 2022-05-03
---

<pre>
I was a bit worn out from writing that long post yesterday, but seeing so many people like it gave me energy.
Today I went slightly deeper inside from the previous post. The order doesn't really matter anyway, but substr is related too, so I recommend checking that out first.

I like studying related parts in sequence, so today I'm going to look at builtin functions, which are how substr is implemented.
I had a rough idea before too, but after struggling quite a bit in that area while analyzing it yesterday, I wanted to understand it properly.

First, builtin functions refer to code that can be executed at runtime, and there are five types as shown below.

1) Platform-dependent assembly language 
This means the assembly language we usually know. Naturally, it has the best efficiency, but it is extremely inconvenient to maintain. The language itself is difficult, but branching by CPU architecture also makes maintenance hard. If you look at the V8 code, there are CPU-architecture-specific folders under src/codegen, and I saw 11 of them there.
2) c++
This needs no explanation, so I'll skip it.
3) javascript
In the past, there were quite a few internal functions implemented in JavaScript, but in the latest V8 it looks like they have all been reimplemented. If they are implemented in JS, readability is certainly much better, but performance is the worst, so I guess they changed them.
4) CodeStubAssembler
It is called CSA, and it is a method that keeps platform independence and readability while also having the efficiency of assembly code. It is an abstracted low-level primitive instruction set, but this is something that would take days to dig into, so I'll look at it later.
5) Torque
This is a language used only in V8. Since internally used functions use a low-level instruction set like CSA, things implemented in CSA are being moved to Torque. The CSA documentation says this too.
Note: Torque replaces CodeStubAssembler as the recommended way to implement new builtins.
(Basically, it means use Torque now instead of CSA.)


Among these, today I'm only going to look at number 1, assembly builtin functions.
First, I looked into how the actual assembly code is written, and since each architecture is so different, it was interesting that even opcode storage, the depth of abstraction, and the approach itself differ.
For example, if you look at the MIPS (Microsoft without Interlocked Pipeline Stages, commonly known as RISC) architecture, the constants-mips.h header file contains the architecture's basic instruction set all as enums. Like this.

enum SecondaryField : uint32_t {
  MULT = ((3U << 3) + 0),
  MULTU = ((3U << 3) + 1),
  DIV = ((3U << 3) + 2),
  DIVU = ((3U << 3) + 3),
  ADD = ((4U << 3) + 0),
  ADDU = ((4U << 3) + 1),
  ....

The assigned values are not arbitrary; they are the actual opcodes used by the architecture. If you look at a real usage example, it looks like this, and you can see that the GenInstrRegister function constructs and emits the instruction.

void Assembler::addu(Register rd, Register rs, Register rt) {
  GenInstrRegister(SPECIAL, rs, rt, rd, 0, ADDU);
}

void Assembler::GenInstrRegister(Opcode opcode, SecondaryField fmt, Register rt,
                                 FPUControlRegister fs, SecondaryField func) {
  DCHECK(fs.is_valid() && rt.is_valid());
  Instr instr =
      opcode | fmt | (rt.code() << kRtShift) | (fs.code() << kFsShift) | func;
  emit(instr);
}

I was also curious how that instruction is emitted, so I dug into it. The Assembler constructor receives a byte* and stores it in the buffer_ variable, and if it is empty, it allocates kDefaultBufferSize (4KB) of memory to create space.
It stores the starting pointer of that buffer_ in pc_, and when emitting, it stores things sequentially while advancing that pointer. Up through the constructor, this is implemented in the commonly used assembler.cc, but emit has a separate implementation for each architecture. Here, we'll look at the MIPS implementation. (assembler-mips-inl.h)

void Assembler::EmitHelper(Instr x, CompactBranchType is_compact_branch) {
  ....
  *reinterpret_cast&lt;Instr*>(pc_) = x;
  pc_ += kInstrSize;
  if (is_compact_branch == CompactBranchType::COMPACT_BRANCH) {
    EmittedCompactBranchInstruction();
  }
  CheckTrampolinePoolQuick();
}

You can see that it casts the starting pointer pc_ as a value, pushes instruction x into it, and then increments the pointer by the instruction size. Each time it emits like this, instructions are stacked one by one in buffer_, and this will eventually become executable code.

Now that we've seen how assembly functions are created up to this point, we should also see how actual functions are created using this and how they are used, right?
The asm instruction generation part we've been looking at so far is under the src/codegen/ folder, and now the place we'll look at is the src/builtsin folder, which contains the implementation of builtin functions. Under that folder, just like codegen, the implementation is separated into architecture-specific folders, and if we look at one function in builtins-mips.cc,

void Builtins::Generate_ReflectApply(MacroAssembler* masm) {
  {
    Label no_arg;
    __ LoadRoot(a1, RootIndex::kUndefinedValue);
    __ mov(a2, a1);
    __ mov(a3, a1);
    __ Branch(&no_arg, eq, a0, Operand(JSParameterCount(0)));
    __ lw(a1, MemOperand(sp, kSystemPointerSize));  // target
    ....

You can see that it is composed using functions registered in codegen like this. To compensate for the biggest weakness of assembly code, poor readability, each block of code has comments explaining what action it performs, but usually it is just as hard to understand even after reading them. That's because you need to know all the register types, understand their characteristics, and use the corresponding operations. Who has written MIPS assembly? lol It's a language you only see once in a while, and if this differs by architecture, anyone can tell it must be hard to maintain.
For comparison, I'll also show the x64 version of the same function.

void Builtins::Generate_ReflectApply(MacroAssembler* masm) {
{
    Label done;
    StackArgumentsAccessor args(rax);
    __ LoadRoot(rdi, RootIndex::kUndefinedValue);
    __ movq(rdx, rdi);
    __ movq(rbx, rdi);
    __ cmpq(rax, Immediate(JSParameterCount(1)));
    __ j(below, &done, Label::kNear);
    __ movq(rdi, args[1]);  // target
    ....

So assembly builtin functions are structured like this, and now let's look at the registration part. You remember that file where substr was registered before, right? All builtin functions are registered in the builtins-definition.h file, and the ReflectApply function we created earlier is registered there like this.

  ASM(ReflectApply, JSTrampoline)

But it looks a bit strange, right? There is no Genenrate_. Could ASM be adding that arbitrarily? Yes. That's the answer. ASM is composed of this define statement, so it connects the Generate_##Name implementation with Name. It also connects the k##Name function code.

#define BUILD_ASM(Name, InterfaceDescriptor)                        \
  code = BuildWithMacroAssembler(isolate, Builtin::k##Name,         \
                                 Builtins::Generate_##Name, #Name); \
  AddBuiltin(builtins, Builtin::k##Name, code);                     \
  index++;

Using a registered builtin function works the same way as substr: when registering it, you put in the function code that was connected, and internally it finds and calls the function.

Handle&lt;JSFunction> apply = SimpleInstallFunction(isolate_, reflect, "apply", Builtin::kReflectApply, 3, false);
 

So far we've looked at the creation, registration, and usage of assembly builtin functions.
Honestly, you can't really use this kind of thing in actual work, but just think of it as intellectual fun and enjoy reading it.
Thanks to the people who commented on the previous post, I think I'm putting in a little more effort. Thanks for the comments and recommendations.


#javascript #builtin
</pre>
