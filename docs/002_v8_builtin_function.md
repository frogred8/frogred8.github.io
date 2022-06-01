---
layout: default
title: "[javascript] builtin 함수 분석"
---

## [javascript] builtin 함수 분석

<pre>
어제 긴글 쓰느라 좀 지쳤는데 많이들 좋아해줘서 힘이 나네.
오늘은 이전 글에서 안쪽으로 살짝 더 들어와봤어. 어차피 순서는 상관없는데 substr도 연관된거니 한번 보고오길 ㅊㅊ

난 관련있는 부분을 연속적으로 공부하는걸 좋아해서 오늘은 substr이 구현된 방식인 builtin 함수에 대해 볼거야.
전에도 대충은 알고 있었는데 어제 분석하면서 그쪽에서 고생 꽤나 했더니 제대로 알고 싶어지더라고.

알단 builtin 함수는 런타임에 실행할 수 있는 코드를 말하고, 그 종류는 아래 다섯개가 있어.

1) Platform-dependent assembly language 
보통 알고 있는 어셈을 말해. 당연히 효율성은 가장 좋지만 유지보수가 무척 불편하지. 언어 자체의 난이도도 있지만 cpu 아키텍쳐에 따른 분기가 유지보수에 어려움을 주기도 하고. v8코드에서 보면 src/codegen 하위 폴더로 cpu 아키텍쳐 별 폴더가 있는데 거기에 11개 있더라.
2) c++
이건 설명이 필요없으니 패스
3) javascript
예전엔 자바스크립트로 구현된 내부 함수도 꽤 보였는데 최신 v8에서는 싹다 재구현했나 보더라고. 아무래도 js로 구현되어 있으면 가독성이 월등히 좋긴 한데 성능은 제일 떨어져서 바꿨나봐.
4) CodeStubAssembler
CSA라고 부르는데 플랫폼 독립적인 상태와 가독성도 유지하면서 어셈 코드의 효율성을 가지고 있는 방식이야. 추상화된 저수준 primitive 명령셋인데 이건 며칠 파야되는 내용이라 나중에 볼거야.
5) Torque
v8에서만 사용하는 언어야. 내부에서 사용하는 함수는 CSA처럼 저수준 명령셋을 사용하기 때문에 CSA로 구현된 내용이 torque로 옮겨가고 있어. CSA 문서를 봐도 이렇게 나와있고.
Note: Torque replaces CodeStubAssembler as the recommended way to implement new builtins.
(대충 이젠 CSA말고 torque쓰라는 뜻)


이 중에서 오늘은 1번 어셈 빌트인 함수만 알아볼거야.
일단 실제 어셈 코드를 어떻게 짜는지 궁금해서 살펴봤는데 아키텍쳐마다 서로 워낙 다르다보니 opcode 저장이나 추상화 깊이, 방식조차 다른 것도 흥미롭더라고. 
예를 들어 MIPS (Microsoft without Interlocked Pipeline Stages, 흔히 RISC로 알고 있는) 아키텍쳐를 보면 constants-mips.h 헤더 파일에 해당 아키텍쳐의 기본 명령어 셋을 enum으로 다 넣어놨어. 이렇게.

enum SecondaryField : uint32_t {
  MULT = ((3U << 3) + 0),
  MULTU = ((3U << 3) + 1),
  DIV = ((3U << 3) + 2),
  DIVU = ((3U << 3) + 3),
  ADD = ((4U << 3) + 0),
  ADDU = ((4U << 3) + 1),
  ....

지정된 값은 아무거나 넣어놓은게 아니라 실제 아키텍쳐에서 사용하는 opcode야. 실제 사용 예를 보면 이렇게 되어있는데 GenInstrRegister함수에서 instruction 을 구성하고 emit 하는걸 볼 수 있어

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

저 instruction을 어떻게 emit 하는지도 궁금해서 파봤는데 Assembler 생성자에서 byte* 를 받아서 buffer_ 변수에 넣어주는데 비어있으면 kDefaultBufferSize (4KB)만큼 memory alloc 해서 공간을 만들어 두게 돼.
저 buffer_ 시작 포인터를 pc_ 에 저장하는데 여기에 emit 할 때에 순차적으로 늘어나면서 저장하게 돼. 여기서 생성자까지는 공통으로 사용하는 assembler.cc에서 구현하는데 emit은 매 아키텍쳐마다 구현부가 따로 있어. 여기서는 MIPS 구현부를 볼게. (assembler-mips-inl.h)

void Assembler::EmitHelper(Instr x, CompactBranchType is_compact_branch) {
  ....
  *reinterpret_cast<Instr*>(pc_) = x;
  pc_ += kInstrSize;
  if (is_compact_branch == CompactBranchType::COMPACT_BRANCH) {
    EmittedCompactBranchInstruction();
  }
  CheckTrampolinePoolQuick();
}

시작 포인터 pc_를 값 캐스팅해서 instruction x를 밀어넣고 instruction 사이즈만큼 포인터를 증가시킨걸 볼 수 있어. 이렇게 emit할 때마다 buffer_에 instruction이 차곡차곡 쌓이고 이게 결국 실행 코드가 될거야.

여기까지 어셈 함수가 만들어지는걸 봤으니 이를 이용해 실제 만들어진 함수와 사용을 어떻게 하는지도 봐야겠지?
여태까지 살펴봤던 부분인 asm instruction generate는 src/codegen/ 폴더 아래에 있고, 이제 살펴볼 곳은 빌트인 함수의 구현부인 src/builtsin 폴더야. 해당 폴더 아래에는 codegen과 마찬가지로 아키텍쳐 별 폴더로 분리되어 구현부가 따로 존재하는데 builtins-mips.cc에서 함수 하나를 보면,

void Builtins::Generate_ReflectApply(MacroAssembler* masm) {
  {
    Label no_arg;
    __ LoadRoot(a1, RootIndex::kUndefinedValue);
    __ mov(a2, a1);
    __ mov(a3, a1);
    __ Branch(&no_arg, eq, a0, Operand(JSParameterCount(0)));
    __ lw(a1, MemOperand(sp, kSystemPointerSize));  // target
    ....

이렇게 codegen에 등록된 함수를 사용해서 구성된걸 볼 수 있어. 어셈 코드의 가장 큰 단점인 가독성이 떨어지는걸 보완하기 위해 코드 단락마다 주석으로 이게 무슨 행동을 하는건지 써있는데 보통은 봐도 모르긴 마찬가지야. 왜냐하면 레지스터 종류도 다 알아야 하고, 그 특성도 이해하면서 해당 동작을 사용해야하는데 MIPS 어셈 써본 사람? ㅋㅋ 진짜 어쩌다가 한번씩 보는 언어인데 이게 아키텍쳐마다 다르다고 한다면 유지보수가 힘든건 누구라도 알겠지?
비교를 위해 동일한 함수의 x64도 보여줄게.

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

그래서 어셈 빌트인 함수는 이렇게 구성되어 있고, 이제 등록 부분을 살펴보자. 이전에 substr이 등록되었던 그 파일 있지?builtins-definition.h 파일에서 모든 빌트인 함수가 등록되는데 여기에 아까 생성한 ReflectApply 함수가 이렇게 등록돼.

  ASM(ReflectApply, JSTrampoline)

근데 좀 이상하지? Genenrate_ 가 없잖아. 저 ASM에서 임의로 붙여주는건 아닐까? 맞아. 정답이야. ASM은 이런 define문으로 구성되어 있어서 Generate_##Name 구현체와 Name을 엮어줘. 그리고 k##Name 함수 코드도 연결시켜주고.

#define BUILD_ASM(Name, InterfaceDescriptor)                        \
  code = BuildWithMacroAssembler(isolate, Builtin::k##Name,         \
                                 Builtins::Generate_##Name, #Name); \
  AddBuiltin(builtins, Builtin::k##Name, code);                     \
  index++;

등록된 빌트인 함수의 사용은 substr처럼 동일하게 등록할 때 연결했던 함수 코드를 넣으면 안에서 함수 찾아다가 호출하는 방식이야.

Handle<JSFunction> apply = SimpleInstallFunction(isolate_, reflect, "apply", Builtin::kReflectApply, 3, false);
 

여기까지 어셈 빌트인 함수의 생성, 등록, 사용까지 알아봤어.
사실 이런걸 실무에서 어디 쓰진 못하지만 그냥 지적 유희라고 생각하고 재미있게 읽어줘.
이전 글에서 덧글 준 형들 덕에 조금 더 열심히 하게 되는 것 같아. 덧글&추천 고마워.


#javascript #builtin
