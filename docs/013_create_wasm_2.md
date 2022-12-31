---
layout: page
title: "[WASM] WebAssembly 생성 및 예제 (2)"
date: 2022-08-30
---

## [WASM] WebAssembly 생성 및 예제 (2)

<pre>

예전 글과 이어지는 내용이야. 
기억이 흐릿해졌을테니 목차만 뿌리고 3,4번 바로 시작할게.

1) WebAssembly Text Format
2) AssemblyScript
3) c/c++ (using Emscripten)
4) Rust


3. c/c++ (using Emscripten)

예제 생성 전에 꼭 알아야 할 도구가 하나 있어. 그건 Emscripten이라는 컴파일러 도구인데 LLVM의 back-end 컴파일러 도구 중 하나야. be라고 하니까 IR(Intermediate Representation)에서 기계어 변환만 말하는 것 같은데 사실 Emcripten의 최초 목적은 c/c++ 코드를 자바스크립트로 변환하는 거였어. 

그 와중에 asm.js의 혼란기를 지나고, 지금은 LLVM으로 나온 IR(Intermediate Representation) 파일을 .wasm으로 변경하는 작업을 하고 있어. 컴파일러 front-end(혹은 middle-end)에서 나온 .bc/.ll 파일들 말이야. Emscripten은 Binaryen 이라는 툴과 같이 설명해야 하는데 깊이 들어가면 툴 설명만 한가득일테니 간단히만 써볼게. (사실 아는게 없어..)

이전에 슬쩍 넘어갔던 AssemblyScript의 컴파일러(asc)가 Binaryen이야. node_modules에 설치되는 그거. 그리고 WebAssembly -> js로 변환도 가능하고, WASM -> IR optimizing -> WASM 변환도 가능해. 저 마지막 기능은 뭐냐하면 Emscripten 자체적인 최적화는 부족하기 때문에 최적화 툴로써 Binaryen을 사용하는데 더 작고, 더 빠른 WASM 파일이 추출된다고 해.

이건 딴 얘긴데 Binaryen FAQ 페이지에 이름에 대한 이런 토막글이 있어. 친절하게 발음 방법도 알려주는걸 보면 개발자가 왕좌의 게임 팬인듯.

Why the weird name for the project?
- "Binaryen" is pronounced in the same manner as "Targaryen": bi-NAIR-ee-in. Or something like that? Anyhow, however Targaryen is correctly pronounced, they should rhyme. Aside from pronunciation, the Targaryen house words, "Fire and Blood", have also inspired Binaryen's: "Code and Bugs."


이제 진짜 예제로 들어가볼게.

#include &lt;emscripten.h>
int EMSCRIPTEN_KEEPALIVE calc(int a, int b) {
  return a + b * 2;
}

$> emcc ./calc.c

간단한 산술 연산값을 반환하는 함수를 만들었고, 아래는 emcc로 컴파일 하는 명령줄이야. 근데 함수 반환 타입에 EMSCRIPTEN~~ 구문이 하나 붙었지? 이건 .wat 설명할 때에 나왔던 export 지시어처럼 WASM 외부로 노출시킬 함수에 붙는 구문이야. 저렇게 코드에 추가하는 방법 외에 컴파일 시점에 노출할 함수를 지정할 수도 있어.

$> emcc -s EXPORTED_FUNCTIONS=_calc ./calc.c

여기서 함수 이름이 _calc인게 좀 이상하지 않아? 이것 때문에 살짝 헤멨는데 c컴파일러들은 예로부터 외부 함수 맹글링을 prefix underscore로 했대. 어셈으로 선언한 함수와 혼동되지 않기 위해서라는 썰도 있고 여러가지인데 아무튼 저렇게 _를 붙여줘야 인식하더라고. c로 외부 모듈 만들어 본 적이 없어서 잘 모르는 부분인데 혹시 자세히 아는 분은 덧글로 썰좀 풀어줘.

어쨌든 컴파일을 완료하면 a.out.wasm, a.out.js 파일이 생성돼. wasm파일은 알테니까 js파일을 설명하면 브라우저에 붙일 수 있게 나온 glu파일이라고 보면 돼. 생성된 js 파일은 2천줄이 넘을 정도로 꽤 긴데 내가 만든 함수만 찾아보면 아래처럼 바인딩 되어있어.

/** @type {function(...*):?} */
var _calc = Module["_calc"] = createExportWrapper("calc");

이렇게 생성된 a.out.wasm을 사용하는 방법엔 몇 가지가 있어. 이전 글에 설명했던 것처럼 node에서 initialize하고 사용할 수도 있는데 웹에서 사용하려면 cwrap, ccall을 컴파일 옵션에 추가해서 컴파일해주고 a.out.js 파일을 로드해서 이렇게 구성하면 돼.

$> emcc ./calc.c -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']"

&lt;script src="a.out.js">&lt;/script>
&lt;script>
Module.onRuntimeInitialized = _ => {
  const calc = Module.cwrap('calc', 'number', ['number', 'number']);
  console.log(calc(10, 20));
};
&lt;/script>

index.html에 저 내용을 넣고 로컬에서 해보니까 CORS 에러가 나오긴 하는데 어찌저찌 http-server로 우회해서 해보니까 개발자 도구 콘솔에 50이 잘 찍혀있더라. 연결 성공!

웹이나 노드 외에 wasm 파일을 standalone으로 실행할 수도 있어. 코드에 main 함수를 추가하고 컴파일 옵션을 변경해서 외부 툴로 실행하면 되는데 wasmtime이란 도구도 있지만 난 wasmer를 사용했어. 이게 더 빠르고 좋다고 하더라. 

아래에서는 변경된 예제 코드랑 컴파일 및 실행까지 한번에 해봤어.

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

컴파일도 잘 되고 출력값도 정상으로 나오는 걸 확인할 수 있어.


4. Rust
원래 Go도 하려고 했는데 어차피 바인딩 과정은 비슷할 것 같아서 Rust만 할게. (사실 귀찮..)
Rust에서는 wasm-bindgen이라는 도구가 중요한데 왜냐하면 순수 WASM에서는 숫자만 전달이 가능해. 어찌저찌 공유메모리를 사용하여 어렵게 문자열을 넘길 수는 있지만 객체나 배열 등을 넘길 생각하면 아득해지는게 현실이야.

그걸 쉽게 만들어주는 도구가 wasm-bindgen인데, Rust에서 js로 문자열, 객체 등의 여러가지를 전달하고 받을 수 있게 중간 glu코드를 자동 생성해줘서 쉽게 쓸 수 있도록 도와주게 돼. 이에 대한 패키징 도구는 wasm-pack이고 이런 것들을 이용해 예제를 만들어볼거야. cargo는 npm같은 rust용 패키지 매니저라고 보면 되는데 이걸로 툴 설치랑 프로젝트를 생성해볼게.

$> cargo install wasm-pack 
$> cargo new --lib calc-wasm

생성된 calc-wasm 폴더에서 src/lib.rs 파일을 싹다 지우고 여기에 예제 코드를 넣었어.

use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn calc(a: i32, b: i32) -> i32 {
    a + b * 2
}

여기 예제는 i32타입으로 변수 두개 받아서 반환은 i32로 하겠다는 내용이야. 이러면 js에서 해당 함수를 사용할 수 있어. 이제 컴파일을 해볼건데 rust는 cargo.toml 파일에 빌드 옵션을 설정하기 때문에 그쪽도 수정해볼게.

[lib]
crate-type = ["cdylib", "rlib"]
[dependencies]
wasm-bindgen = "0.2"

wasm-bindgen은 아직 0.2.82가 최신이네. 저렇게 설정하면 ^0.2와 동일하게 작동해. 설정은 끝났으니 빌드를 시작해볼까?

$> wasm-pack build --target web

처음 빌드하면 뭔가 이것저것 하면서 20초 정도 후에 빌드가 완료되는데 새로 생긴 pkg 폴더 아래에 glu용 js코드, wasm파일 등이 생성돼. js 파일을 열어보면 변수 두개 받아서 전달만 하는데 만약 숫자가 아니라 문자열이나 배열, 객체를 넘기는 부분이었다면 이 부분이 꽤나 복잡해졌을거야. wasm은 말했다시피 문자열을 그대로 못쓰고 공유메모리로 옮겨서 전달하는 방식으로 통신해야 하거든.

어쨌든 그 코드 외에도 WebAssembly.instantiate 함수를 사용해서 wasm을 js로 불러와서 초기화 하는 코드들이 잔뜩 있어. 근데 자동 생성해주는 js파일에서 init함수가 자동 호출이 잘 안돼서 그냥 index.html에서 강제로 호출하게 짰어. 사소한 기술적 문제들은 패스패스.

&lt;script type="module">
  import init from "./pkg/calc_wasm.js";
  init().then((js) => {
    console.log(js.calc(10,20));
  });
&lt;/script>

실행해보면 개발자 도구 콘솔에 50이 찍히는 걸 볼 수 있어. 이렇게 rust에서 만든 함수도 웹 연동 끝~
근데 rust의 wasm은 클로저나 WebGL 같은 외부 객체의 적용 예제가 공식 문서에 잘 정리되어 있더라고. 디테일에 조금 감탄했는데 구경이나 한번 해봐. https://rustwasm.github.io/docs/wasm-bindgen/examples/


WASM 글이 2달 만에 마무리되네. 사실 한참 전에 거의 다 써놓고 마무리만 하면 되는거였는데 한번 놓으니까 왜이리 손이 안가던지.. 급하게 마무리한 것 같아서 좀 찜찜하긴한데 대신 예제 코드를 github에 올려놨으니 나중에라도 wasm 시작할 때에 작은 도움이 되길 바랄게.
https://github.com/frogred8/wasm-sample


시리즈의 마지막이니까 관련 시리즈 글 링크도 달아놓을게. 블라에서 내 이름 태그로 검색해도 나와.
WASM이란? https://frogred8.github.io/docs/010_asmjs_and_wasm/
LLVM이란? https://frogred8.github.io/docs/011_introduce_llvm/
WASM 예제-1 https://frogred8.github.io/docs/012_create_wasm/
WASM 예제-2 https://frogred8.github.io/docs/013_create_wasm_2/ (이 글)

#frogred8 #WASM