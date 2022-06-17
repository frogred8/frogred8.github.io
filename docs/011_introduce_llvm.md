---
layout: page
title: "[etc] LLVM 알아보기 (clang)"
---

## [etc] LLVM 알아보기 (clang)

<pre>
WebAssembly에 대해 알아보다가 LLVM에 대해 자주 나오는데 이에 대한 제대로 된 이해없이는 넘어가기가 쉽지 않아서 한번 정리해봤어.

컴파일러는 큰 범주로 보면 front-end, back-end (이하 fe, be)로 나눠져. fe는 어휘/구문 분석 및 중간 코드 생성과 그에 대한 최적화를 하고, be에서는 해당 플랫폼에서 실행할 수 있는 기계어 생성 및 그에 대한 최적화를 하게 돼. 
fe의 결과물인 IR(Intermediate Representation, 중간 표현 코드)까지는 플랫폼 독립적이고, be의 결과물은 플랫폼 의존적인거지. JVM이나 .NET에서 쓰이는 stack-based bytecode도 동일한 맥락의 IR이라고 보면 돼. 

저렇게 IR을 결과물로 내는 컴파일러인 경우에 플랫폼 독립적이라 하나의 결과물로 여러 플랫폼에 배포 가능한게 장점이야. 그리고 이 결과물을 실행하는 곳에서는 보통 가상 머신이 IR을 실행 시점이나 실행 도중에 필요한 부분을 실시간으로 컴파일해서 메모리에 적재하게 돼. 이게 JIT(Just-In-Time) 컴파일의 정의라고 할 수 있어.

이전에 v8 컴파일러 얘기할 때에 나왔던 Ignition, Turbofan을 예로 보면, (https://frogred8.github.io/docs/004_v8_engine_history)
Ignition은 parsing된 추상 구문 트리(AST)로 bytecode(IR)를 생성하고(fe), 이를 머신 코드 변환(be)까지 해주니 fe와 be의 역할을 한다고 볼 수 있어. 여기서 Turbofan은 머신 코드에 대한 최적화만 담당하는 엔진이니 be 끝단에 있는 컴파일러라 할 수 있겠지.

요즘에는 fe, be 외에 IR의 최적화를 담당하는 middle-end까지 3 phase도 나오는데 LLVM에서 이 방식을 사용 중이야. LLVM은 Low Level Virtual Machine의 약자인데 vm이랑 상관도 없고 공식 사이트에서도 단어의 뜻에 큰 의미를 두진 말라고 하니까 그냥 어원이 저거구나 하고 알아만 둬. 그래서 지금 우리가 부르는 LLVM은 컴파일러 프레임워크 프로젝트의 이름이라고 보면 돼. 

초기에 애플이 Objective-C를 개발할 때에 gcc를 컴파일러로 썼는데 원하는 스펙을 자꾸 미루고 안넣어주니까 새로 만든게 LLVM기반 오픈소스 컴파일러인 clang이야. 클랭이라고 읽으라는데 난 예전에 읽던 버릇때문에 씨랭이라고 읽어지네. 어쨌든 애플에서 clang 컴파일러 개발자 채용도 하고 있을 정도니 아직도 할 일이 많은가 봐. (가끔 stackoverflow에 v8 관련 답변에서 'V8 developer here.'로 시작하는 구글형 멋지던데 clang 개발자도 멋짐 뿜뿜하겠다.)

clang에서는 c/c++, Objective-C를 지원하고 있어. 간단한 c예제를 가지고 이것저것 재밌는 것좀 해볼게.

// calc.c
int calc(int a, int b) {
  return a + b * 2;
}

llvm의 지향점대로 컴파일 단계마다 모듈화 되어있기 때문에 별걸 다 볼 수 있어. 추상 구문 트리(AST)를 한번 구경해볼까?

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

calc 함수 지정되는 부분부터 가져왔는데 파라미터 a,b도 보이고 반환하는 곳에서는 a+b*2 코드에 대한 트리가 잘 구성된 걸 볼 수 있어. zsh쉘에서 보면 참 미려하게 나오는데 여기선 그 감동을 표현할 방법이 없네. -ast-dump=json 으로 변경하면 json으로 출력이 되고, 그 외에 -emit-ast 옵션을 쓰면 calc.ast 바이너리 파일이 나오기도 하는데 이걸로 뭘 할 수는 없더라. -fsyntax-only 옵션은 없어도 상관은 없는데 컴파일을 시도해서 에러가 나오는게 싫어서 넣어봤음.

이젠 진짜 IR을 볼거야.

$> clang -emit-llvm -c calc.c
$> clang -emit-llvm -S calc.c

둘 다 IR을 출력하는 옵션인데 -c는 calc.bc(bitcode) 바이너리 파일을, -S는 calc.ll 텍스트 파일을 출력해. bc 파일은 바이너리라 볼거 없으니 넘기고 ll 파일을 순차적으로 볼게.

; ModuleID = 'calc.c'
source_filename = "calc.c"
target datalayout = "e-m:o-i64:64-i128:128-n32:64-S128"
target triple = "arm64-apple-macosx12.0.0"

첫 단락부터 보면 컴파일 대상이었던 파일이랑 datalayout, triple이 보여. datalayout은 하이픈을 토큰으로 잘라서 의미를 찾을 수 있어. 첫 글자는 big/little endian을 뜻하는데 e는 little endian을 뜻하고, m:o는 ELF(Executable and Linkable Format)을 의미하고, i64:64는 i64는 64bit를 할당하라는 뜻이야.
triple 필드는 {arch}{sub}-{vendor}-{sys}-{abi} 형식으로 쓰는데 난 m1이라 저렇게 나오는 듯. 

다음은 함수 본문이야.

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

이전에 설명한 js파일의 bytecode랑 비슷해보이지? 거기도 bytecode가 IR 역할을 하고 있거든. 이젠 한줄씩 분석해볼게.

%3 = alloca i32, align 4
i32타입으로 4byte를 %3 변수에 할당. 마지막 align을 생략하면 타겟의 ABI(Application Binary Interface) alignment로 작동하게 돼. 타겟이 i64면 8바이트를 할당할거고, i32면 4바이트를 할당하겠지. 손으로 작성할 때나 세부적으로 살펴볼 정보니 그냥 알아만 두자.
store i32 %0, i32* %3, align 4
// i32타입인 %0를 %3주소에 저장
%5 = load i32, i32* %3, align 4
// i32타입의 주소%3에서 i32값을 %5로 읽어옴
%7 = mul nsw i32 %6, 2
// %6*2 계산한 결과를 %7에 저장. 이 때 No Signed Wrap 옵션이 추가되면 오버플로가 발생했을 때에 정의되지 않은 동작을 트리거.
%8 = add nsw i32 %5, %7
// %5+%7 계산한 결과를 %8에 저장.
ret i32 %8
// %8값을 i32타입으로 반환

참고로 .ll파일과 .bc파일은 아래 명령으로 서로 변환이 가능해.

$> llvm-as calc.ll
$> llvm-dis calc.bc 

이제 IR도 봤으니 어셈블리도 한번 뽑아볼까? 어셈으로 컴파일되면 .s파일로 나오는데 clang을 쓰는 방법과 llc를 쓰는 방법이 있어. llc는 입력 인자로 IR파일을 받는데 ll, bc파일에 상관없이 다 변환돼.

$> clang -S calc.c
$> llc calc.ll

calc.s파일은 이렇게 생겼는데 일반적인 어셈이야.

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

이제 저 어셈 파일을 오브젝트 파일로 만들어 볼 차례야. 그런데 다음 스텝부터는 main 함수가 있어야 진행이 가능해서 calc함수를 호출하는 main 함수를 넣고 진행했어. 

// calc.c
#include <stdio.h>
int calc(int a, int b) {
  return a + b * 2;
}
int main() {
  int val = calc(10, 20);
  printf("%d", val);
  return 0;
}

$> clang -c calc.s

-c 옵션에 대한 설명을 보면, 'Run all of the above, plus the assembler, generating a target ".o" object file.'라고 나와있어서 중간 단계인 .ll이나 .bc 파일을 지정해서 해보니 calc.o파일로 잘 나오더라고. 똑똑해 똑똑해.
이렇게 나온 calc.o 오브젝트 파일을 executable file로 생성해서 실행해보면 출력값 50이 잘 나오는 걸 확인할 수 있어.

$> clang calc.o -o calc
$> ./calc
50

근데 사실 'clang calc.c -o calc' 하면 그냥 실행 파일 만들어져서 되는거임ㅋㅋ 대부분 저렇게 쓰겠지만 어쨌든 단계별로 만들어보고 중간 단계를 확인해보면서 재미있으면 됐지.

결론)
1) 컴파일러는 보통 2 phase(fe/be)로 이루어져 있는데 LLVM은 3 phase(fe/me/be)로 middle-end에서 IR 최적화 단계가 존재한다.
2) LLVM은 컴파일러 프레임워크의 이름일 뿐이고, 컴파일러로는 clang이 대표적이다.
3) clang으로 컴파일 시 단계마다 나오는 결과를 출력해서 확인할 수 있다.

WASM을 마무리해야 하는데 그냥 내맘대로 먼저 공부한거 정리해봤어. 새로운 키워드나 옵션, 개념들이 나오면 한번씩 다 찾아보는 편인데 역시 컴파일러 쪽은 쉽지 않네. LALR(LookAhead Left-to-Right) Parser 부분도 꽤 봤는데 설명할만큼 이해가 되진 않아서 포-기. 파서 부분은 안보겠다는 다짐을 하게 됨.

익숙하지 않은 부분이라 틀린 정보가 있으면 언제든 알려줘. 

#frogred8 #llvm #clang