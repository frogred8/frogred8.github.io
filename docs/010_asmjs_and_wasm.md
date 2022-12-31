---
layout: page
title: "[WASM] asm.js, WebAssembly의 이해"
date: 2022-06-16
---

<pre>
오늘 알아볼 주제는 WebAssembly, 약어로는 WASM이라고 쓰고 와즘이라고 읽어. 이게 왜 만들어졌는지, 그리고 어디에 사용할 수 있는지 먼저 알아볼게.

자바스크립트는 느려. 왜냐하면 태생이 JIT 컴파일러를 사용하는 스크립트 언어라서 그래. 

1) 텍스트로 된 코드를 받으면 이를 토큰 별로 분리하고, 
2) 이 토큰화된 정보로 추상 구문 트리(Abstract syntex tree, AST)를 만들고, 
3) AST를 기반으로 바이트 코드를 생성하고, 
4) 생성된 바이트 코드를 현재 실행 중인 플랫폼에 따라 기계어로 변경하는 작업이 필요하기 때문이야.

여기에 최적화 작업이 들어가면 더 복잡해져. 실행 초기에는 최적화되지 않은 코드로 돌아가다가 여러 번 실행하면서 함수 실행에 소요된 시간을 추정하여 최적화하는게 얼마나 유용한지 예측하고, 이에 따라 최적화하기로 결정한 hot function은 실시간으로 최적화 코드를 만들어내서 기존 실행 코드와 교체하는 작업을 실행하게 돼. (이전에 여러번 말했던 turbofan)

이 일련의 과정을 '어떻게 하면 더 빠르게 실행할 수 있을까?'에 대해 고민한 결과물이 asm.js와 WebAssembly라고 보면 돼.

근데 WebAssembly를 검색하다보면 asm.js가 많이 나올텐데 이건 firefox에서 최초로 구현했던 개별 기능이었어. asm.js가 무슨 라이브러리를 설치하거나 그런게 아니라 브라우저에서 구현한 스펙인데 그 조건에 맞으면 기계어로 바로 컴파일 해주는거야. 아래에 asm.js를 적용한 함수를 한번 보자구.

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

함수 첫줄에 "use asm" 디렉티브를 써서 이 함수를 asm.js로 적용하겠다는 지시어를 쓰는데 "use strict"랑 비슷하다고 보면 돼. 브라우저가 저 디렉티브를 보면 이 함수를 기계어로 컴파일을 시도하게 되는데 세부 조건에 맞지 않으면 그냥 일반 자바스크립트로 해석하게 돼.

asm.js는 산술 연산의 최적화에만 맞춘 기능이라 or연산이나 기호를 사용하여 변수 타입을 직접적으로 알려줘야 해.
a|0 -> int, +a -> double 등 자바스크립트 코드가 저런 식으로 구성되어야 firefox에서 기계어로 컴파일 시도를 하는거지.
이거 외에 세부 조건이 꽤 많은데 굳이 예전 기술을 알아보는건 의미없으니 넘어갈게.

어쨌든 이런 웹 최적화를 firefox가 시작했지만 이후 chrome, edge에서도 "use asm" 디렉티브를 만났을 때 최적화를 시도하는 기능을 개발했어. 그렇게 각 개발사가 따로 개발하다가 통합적인 표준이 필요했고, W3C 커뮤니티 그룹에서 이에 대한 논의 끝에 WebAssembly가 탄생하게 되었지.
참고로 chrome에서는 그 시기에 PNaCl(Portable Native Client)이라는 프로젝트를 개발하기도 했는데 아래에서 설명할 WASI랑 비슷한 개념으로 시작했어. 물론 지금은 WASI로 통합되면서 개발이 중단된 상태야.

WASM을 사용하는 여러 이유가 있는데 수학 연산에 대한 성능 향상 부분도 있지만 동일한 js코드에 비해 더 빠르게 실행되기 때문이야. js코드는 WASM보다 파일 크기가 크고, 파싱과 타입 추론, JIT가 필요하지만 WASM은 이미 IR(Intermediate Representation)로 작성되었기 때문에 파싱없이 그대로 메모리에 적재하기만 하면 끝, 타입도 이미 들어가있고, 각 언어마다 .wasm 파일을 생성하면서 컴파일러가 정적 언어의 최적화를 적용해놓기 때문에 브라우저 최적화 기법의 영향을 덜 받으면서 사용할 수 있어. 당연히 더 빠르고 효율적이기도 하고.

어쨌든 이렇게 만들어진 WASM을 기반으로 WASI(WebAssembly System Interface)가 나왔는데 플랫폼(cpu, os)에 상관없이 작동하는 인터페이스 규약이야. 이를 이용하면 기존에 웹에서만 사용했던 WASM을 모든 플랫폼에서 사용할 수 있고, 권한받은 폴더에 한해서 시스템 콜도 가능해.
이를 위해 우리가 따로 해줄건 없고 WASI를 지원하는 컴파일러로 컴파일만 해주면 되는데 WASM이 나온지 얼마 안돼서 WASI도 나왔기때문에 지금은 이미 모든 곳에 적용되어 있다고 봐도 돼.

WASI는 c/c++, Rust, Go, python, AssemblyScript 등 메이저 언어에서 대부분 지원해. 최근에는 .NET에서도 지원하는 모양이야. 보면서도 신기방기
https://docs.microsoft.com/ko-kr/events/build-2022/od108-future-possibilities-net-core-wasi-webassembly-on-server

.wasm 파일은 언어별 컴파일러를 사용해서 나온 IR을 .wasm으로 변경해서 사용할 수 있어. 각 언어의 컴파일러에서 지원하는 기능인데 clang은 .wasm 컴파일 기능이 없어서 이를 Emscripten이라는 외부 프로그램을 사용해서 변경하는 부분만 달라.

c/c++ -> clang -> LLVM (IR) -> Emscripten -> .wasm
Rust -> cargo -> LLVM (IR) -> .wasm
Go -> TinyGo -> LLVM (IR) -> .wasm

사실 .wasm 파일을 만드는 방법은 몇 가지가 더 있어. 근데 이 부분은 지나치게 길어지니 다음 글에서 예제와 함께 자세히 보고, 지금은 간단히 소개만 할게.

1) c/c++ (Emscripten)
2) Rust, Go
3) AssemblyScript
4) WebAssembly Text Format


여기서 끝내긴 아쉬우니 WASM을 실행하는 코드만 잠깐 구경할게. 생성된 .wasm 파일은 이진 파일로 구성되어 있고, 외부 모듈처럼 불러와서 사용할 수 있어. 아래는 node에서 sayHi 함수를 노출한 .wasm 파일을 읽어서 호출하는 간단한 코드야.

WebAssembly.instantiateStreaming(fetch('/hello_world.wasm'), imports)
  .then(wasm => {
    let func = wasm.instance.exports.sayHi;
    console.log(func());
  });

instantiateStreaming와 비슷한 함수로 instantiate가 있는데 가이드에서는 inst~Streaming 함수를 권장하고 있어. 이유는 instantiate는 .wasm 파일이 완벽히 읽어진 arrayBuffer를 넘겨야 해서 복사가 한번 일어나는데 inst~Streaming은 read buffer에서 바로 전달하기 때문에 복사가 일어나지 않고, fetch중인 데이터를 실시간으로 받으면서 컴파일하기 때문에 대기 시간도 줄어드는 효과가 있다고 하니 참고해.


결론)
1) 브라우저 최적화를 위해 asm.js가 한때 존재했지만 지금은 WebAssembly로 통합되었다.
2) 이보다 상위 개념인 WebAssembly System Interface(WASI)의 등장으로 플랫폼에 상관없이 실행할 수 있는 강력한 모듈이 생겼다.
3) WASM은 js보다 최초 실행속도와 성능이 우수하다.
4) 다음 글은 꽤 길어질 것 같다..


WebAssembly는 워낙에 방대한 내용에다가 최신 글과 예전 글이 혼재되어 며칠을 헤메고 다녔어. 이미 deprecated된 asm.js 예제 한번 돌려보려다가 하루를 날리기도 했고..
사실 자신감은 없지만 그래도 일단 공부한 내용이니 한번 정리해봤어. 혹시 틀린 정보가 있으면 덧글로 알려줘. 

#frogred8 #WebAssembly #WASM