---
layout: page
title: "[WASM] WebAssembly 생성 및 예제 (1)"
---

## [WASM] WebAssembly 생성 및 예제 (1)

<pre>

이전 글에서는 LLVM인 clang에 대해서 알아봤어. 왜 WebAssembly(이하 WASM)를 설명하다가 난데없이 그쪽을 깊이 알아봤냐면 Emcripten이란 도구를 설명하면서 LLVM의 이해가 필요했기 때문이야. 이번 글에서는 실제로 WASM 생성을 해볼건데 예제를 생성하려다보니 코드가 좀 많은 편이지만 천천히 따라와 봐.

일단 .wasm 파일은 바이너리 파일로 구성되어 있는데 파일 형식은 ELF(Executable and Linkable Format)나 Mach-O(Mach Object file format)와 비슷하게 되어 있어. 

새로운 키워드니까 갑자기 이쪽으로 잠깐 빠져보면 ELF는 리눅스/유닉스 계열의 실행/라이브러리 헤더 포맷이고, Mach-O는 OSX(iOS, macOS 등)의 헤더 포맷이야. 리눅스는 readelf, OSX는 otool 명령으로 볼 수 있는데 실행 결과를 잠깐만 볼게.

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

리눅스는 꽤 세부적으로 잘 나오는데 OSX는 불친절해서 filetype만 찾아보니 타입 2는 실행 파일이더라고. 몰랐던게 많아서 자꾸 옆길로 새네. 이제 진짜로 WASM으로 넘어가볼게.

전에 말했다시피 WASM 만드는 방법에는 4가지가 있어. 순서대로 볼건데 이 글에서는 1,2번 두 가지만 보고 다음편에서 나머지를 볼거야. 한 번에 보기엔 너무 방대하네.

1) WebAssembly Text Format
2) AssemblyScript
3) c/c++ (using Emscripten)
4) Rust, Go


1. WebAssembly Text Format

WASM에는 LLVM의 IR처럼 생긴 별도의 언어가 있어. S-expression(symbolic expression) 타입으로 lisp나 clojure랑 비슷하게 생겼어. 파일은 .wat(WebAssembly Text) 확장자를 가지고 있는데 아래 예제 코드를 보면 대충 이해될거야. import, export를 다 설명하기 위해서 얘만 조금 더 들어갔는데 다른 애들은 add만 구현할거니 참고해 줘.

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

module 선언 이후에 바로 import로 WASM 초기화 시점에 받은 외부 함수인 custom.log를 logger로 재선언 하고 있어. import는 모든 명령보다 우선적으로 나와야 해. 여기서 전달받은 객체는 나중에 호출부 분석 부분에서 한 번 더 나와.

그 이후에 구현한 내부 함수 이름은 add, 파라미터는 i32타입 lhs, rhs 두 개를 받는 함수야. 그 다음에 있는 local.get은 파라미터를 스택 메모리로 불러오는걸 말해. 이렇게 두 개의 변수를 순차적으로 스택, 즉 register로 불러와서 i32.add 명령을 실행해. 그러면 명령 스펙대로 스택에 있는 두 개의 i32값을 가져와서 더하고 반환하게 돼.

그리고 반환된 값이 스택에 있으니 logger 함수를 호출해서 값을 사용하게 되고. 그 다음 줄의 export는 add이름으로 add함수를 노출시키는 것을 말해. 이제 WASM으로 컴파일 해봐야겠지? 

컴파일은 git clone --recursive https://github.com/WebAssembly/wabt 레포를 다운받고 cmake 설치 이후에 가이드대로 하면 될거야. 근데 .zshrc파일에 패스 등록은 알아서 해줘야 하는 느낌.

참고로 나무위키나 블로그에 get_local로 되어있는 예제가 많은데 이게 바뀐지 얼마 안되어서 그래. 나도 왜 안되나 했는데 꼬박 2년의 논의 끝에 PR이 들어간게 2021년 12월이더라고. https://github.com/WebAssembly/wabt/pull/1792

어쨌든 이렇게 하면 컴파일러 wat2wasm이 준비되었어. 아래 커맨드로 실행하면 add.wasm 파일이 생성돼.

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

instatntiate 함수로 add.wasm을 불러오면서 importObject를 넘기는 걸 볼 수 있어. 이렇게 전달된 객체의 함수들은 WASM 내부에서 호출이 가능해. 아래 예제도 동일하게 반복되니까 WASM 호출부는 더 이상 설명하진 않을게.

이렇게 해서 WebAssembly Text 코드와 컴파일을 알아봤는데 아까 설치했던 컴파일러 중에 wasm2wat도 잠깐 보고 갈게. 어차피 지금 아니면 볼 일도 없을거라. wasm2wat는 말그대로 wasm을 wat로 디컴파일 해주는 도구인데 원본과 얼마나 달라지는지 궁금해서 해봤어.

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

원본보다는 조금 더 길어졌는데 일단 파라미터에 넣었던 변수 이름이 0,1같은 offset으로 바뀌었고, 함수 이름도 type으로 선언된 인덱스로 치환된 걸 볼 수 있어. 사실 예제에서도 굳이 이름이 필요하진 않았은데 읽기 쉬우라고 alias 개념으로 넣은거라 디컴파일되니까 확실히 없어지긴 했네.

간단하게 테스트해보고 싶은 사람들은 여기에서 웹 REPL로 구현해놓은거 있으니 한 번 해봐도 좋아. https://webassembly.github.io/wabt/demo/wat2wasm/


2. AssemblyScript

근데 wat파일로 적으려면 지금 스택에 몇개 넣었고 무슨 타입인지 그거 다 알고 있어야 하는데 쉽지 않잖아? 그래서 superset 개념으로 나온게 AssemblyScript야. AssemblyScript -> wat 관계를 말하자면 타입스크립트 -> 자바스크립트라고 보면 돼. 그럼 AssemblyScript 설치하고, 생성되는 예제 index.ts 파일부터 볼게.

$> npm init
$> npm i --save-dev assemblyscript
$> npx asinit .

// index.ts
export function add(a: i32, b: i32): i32 {
  return a + b;
}

가이드대로 하면 예제 프로젝트를 만들어 주게 돼. index.ts파일에는 딱 우리가 원하던 add 함수가 구현되어 있는데 export로 선언되어 있으면 외부 노출을 하겠다는 뜻이야. 대부분의 ts문법을 그대로 쓸 수 있어서 훨씬 편해졌지. 실제 컴파일은 아래 명령으로 실행할 수 있어.

$> npm run asbuild

실행하면 build 폴더 아래에 debug, release마다 js, wat, wasm 파일을 생성하는데 여기서의 js파일은 wasm 호출부를 자동 구현해준다고 보면 돼. 여기선 호출부인 js파일을 먼저 볼게.

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

여기서 선언된 instantiate 함수에서 모듈 초기화를 진행하는데 나중에 설명할 string 관련 함수가 여기에 구현될거야. 다른 문법들은 평이하니까 따로 설명 안할게. 그럼 js파일 다음으로 wat 파일을 볼까? 일단 debug.wat를 열어봤어. release.wat와 비교해서 더해진 내용은 라인 시작할 때 !를 붙여놓았으니 참고해.

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

debug에서 추가된 라인을 제외하면 우리가 직접 만든 것과 거의 동일하게 나온걸 확인할 수 있어. 그런데 이제와서 하는 얘기지만 wat 파일에서는 숫자 타입 외에 문자열은 사용하기가 까다로워. wat에서는 문자열 처리 함수도 없고, 자체 메모리 할당도 안되는 등 편의성에 문제가 좀 있거든. 

모듈이 초기화할 때에 메모리 버퍼를 생성해서 그곳에서 wat가 작업 후 반환하면 호출한 함수쪽에서 메모리 버퍼니까 문자열로 디코딩 변환하고 막 이런 짓을 해줘야 해. 

아래처럼 문자열 반환 함수로 바꿔서 컴파일해보면 wat는 깔끔해보이지만 호출부에 생성되는 js파일은 난리도 아니야. ts, wat, js 순서대로 볼건데 중요하진 않으니 대충 이런 모양이구나 하고 지나가자구. (js파일은 그 아래 로직은 동일해서 instantiate 함수만 가져왔어.)

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


이번건 조금 길었지? 이 글을 보는 대부분의 사람들이 실제로 만들어보진 않을테니 구경이라도 시켜주려고 첨삭없이 그대로 붙였더니 페이지가 꽤 넘어갔네. 그래도 인터넷의 수많은 만료된/틀린 정보 사이에서 직접 실행해 본 내용만 넣은거라 최신판이긴 할거야.

다음 WASM 글이 끝나면 조금 가벼운 주제로 해야겠어. 한 주제만 공부한지 3주 넘어가니까 슬슬 재미도 떨어지고 그러네. 이번 글도 즐겁게 봐줘.

이전글: https://frogred8.github.io/
#frogred8 #WASM #AssemblyScript