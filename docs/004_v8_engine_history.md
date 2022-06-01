---
layout: default
title: "[javascript] v8 엔진 컴파일러 변천사"
---

## [javascript] v8 엔진 컴파일러 변천사

<pre>
오늘은 v8의 전반적인 컴파일러 변천사에 대해 소개해볼까 해. 크게 복잡한 부분은 없으니 편하게 읽어줘.


사실 v8은 정확히 말하면 크롬 브라우저의 자바 스크립트 엔진 이름일 뿐이야. 파이어 폭스는 SpiderMonkey, 사파리는 Webkit(JavascriptCore) 등 브라우저마다 개별적으로 자바 스크립트 엔진을 가지고 있는 것처럼. 여러가지 브라우저가 혼재되던 2010년도 초기에 v8은 거듭되는 개선 끝에 브라우저 전쟁의 최종 승자가 되었지. 물론 extension 기능도 그 역할이 컸고. (팝업 번역은 사랑입니다)

사족으로, v8이 이렇게 빨라지다보니 자바 스크립트를 실행할 수 있는 강력한 엔진이 되었고 어떤 프로젝트에서 v8을 컴파일 엔진으로 차용하여 libuv를 결합한 어플리케이션을 개발하게 돼. 이 프로젝트가 nodejs이고, 이걸 만든 사람이 Ryan dahl이란 사람이야. 

여기까지가 기본적인 소개이고 이제 v8 개발의 시작을 알아보면,
태초의 v8은 저 Webkit의 모듈 중 하나인 web core 코드의 fork로 시작했어. 이를 기반으로 개발하다가 2011년이 변곡점이 되었는데 Full-codegen과 Crankshaft가 추가된거지. 이 개선으로 기존보다 50% 이상의 비약적인 성능 향상을 이루게 돼. 이전 버전도 브라우저 사이에서는 빠른 편이었는데 말이야.

그 때 추가된 컴파일러인 Full-codegen은 자바 스크립트 코드를 해석하여 바이트 코드로 만드는 컴파일러고, Crankshaft는 그 바이트 코드로 추상화 트리(SSA)를 만들어 최적화를 시키는 컴파일러야. 모든 코드가 Crankshaft로 최적화될 필요는 없기 때문에 최초 실행은 Full-codegen으로 컴파일된 기본 바이트 코드로 실행되고 여러 번 실행되는 hot function에 한해 그 부분만 실시간 최적화되는 방식을 채택했지.

이렇게 초기 컴파일러 두 가지가 나오고 2017년에 새로운 컴파일러인 Ignition과 Turbofan가 나오게 되었어.
Ignition은 Full-codegen과 마찬가지로 바이트 코드로 만드는 역할은 동일하지만 이전보다 더 발전했어. 기존에는 전체 코드를 메모리에 올려놓은 이후에야 바이트 코드 생성이 가능했지만 Ignition은 한줄씩 해석하여 바이트 코드를 만들 수 있어서 메모리 사용량이 훨씬 적었지. 이는 모바일에서 특히 강점을 발휘했어.

Turbofan은 이전의 Crankshaft 역할과 동일하게 최적화 컴파일러였는데 Inline cache, Hidden class, CodeStubAssembler (이하 CSA) 등의 새로운 기능이 추가되면서 메모리 사용량과 유지 보수 효율성, 성능 등이 모두 좋아지게 되었어. 

사실 저 엔진 교체 초기에는 생각보다 성능 향상이 미미했지만 자주 쓰는 내장 함수를 CSA로 재구현하면서 성능이 점점 빨라졌어. 예를 들어 Promise를 CSA로 재구현하여 몇배의 성능 향상이 있었다고 해.


그리고 요즘 WebAssembly(이하 WASM)가 뜨고 있지? rust로 개발한 코드를 WASM에 올려서 쓴다거나 그런거 말이야. v8에서도 WASM을 지원하는데 초기에는 이게 상당히 느렸어. 왜냐하면 WASM은 LLVM으로 컴파일된 바이트 코드인데 이게 Turbofan을 거쳐야 실행이 되었거든.

이 개선을 위해 나온게 Liftoff라는 WebAssembly 전용 컴파일러야. Ignition처럼 바이트 코드를 그대로 실행하는 역할이야. 다운로드 받으면서 컴파일도 된다고 하니 꽤 유용하지. 이런 특징으로 Turbofan보다 훨씬 빠르게 코드를 생성할 수 있는데 최적화를 거치지 않기 때문에 Turbofan으로 컴파일 된 코드보다 50%~70% 낮은 성능이 단점이야. 

근데 이를 그대로 두고 볼 구글이 아니지? 그래서 WASM은 일단 Liftoff 컴파일러로 빠른 실행을 시켜놓고, 백그라운드에서 Turbofan 컴파일러가 열심히 최적화를 해. 이 때 함수 단위로 최적화를 진행하는데 최적화 작업이 완료되는 즉시 기존 함수를 교체해서 성능을 개선하는데 모든 함수가 최적화 될 때까지 이 작업을 반복하게 돼.


결론)
1) v8은 크롬의 자바스크립트 엔진이자 nodejs의 엔진이다.
2) Full-codegen (안씀), Ignition: 바이트 코드 컴파일러
3) Crankshaft (안씀), Turbofan: 최적화 컴파일러
4) Liftoff: WASM 바이트 코드 컴파일러
5) naming이 죄다 차량 부품..

여기 정리해놓은 건 일부분에 불과하고 관련된 키워드로 구글에 검색해보면 수많은 정보들이 있으니 한번씩 읽어보면 도움될거야. 이런 불친절한 글에 비해 성능 그래프나 예제 코드도 많고 말이야.

그럼 다음에 또 봐.

#javascript #v8
