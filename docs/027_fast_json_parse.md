---
layout: page
title: "[javascript] literal 객체보다 빠른 JSON.parse"
date: 2023-07-19
---

<pre>
한 8MB정도 되는 큰 JSON 객체가 있을 때에 이걸 읽어들이는 가장 빠른 방법은 뭘까?
일반적으로는 literal로 변환시켜서 객체 자체를 코드에 넣는 방법을 떠올릴 수 있겠지.
문자열로 된 json파일을 parsing하는 비용이 딱 봐도 더 커보이잖아?

그런데 실제로 literal vs JSON.parse의 성능을 측정해보면 JSON.parse가 최대 두 배까지 빠르게 객체를 구성할 수 있다고 해. https://www.youtube.com/watch?v=ff4fgQxPaO0
이 글에서는 그런 결과가 나온 이유에 대해 영상에 나온 내용을 축약해보고, 더 빠른 stringify에 대해서도 살짝 구경해볼게.


- 내용
일단 코드 조금 보고 갈게.
// literal
const data = { foo: 42, bar: 1337, ... };
// JSON.parse
const data = JSON.parse('{"foo":42,"bar":1337,...}');

위에는 literal 객체, 아래는 string을 JSON.parse로 객체를 실시간으로 만들었어.
그런데 이걸 보고 다시 생각해봐도 JSON.parse가 더 빠를 이유가 없을 것 같잖아? 그건 우리가 보통 compiled 언어를 기준으로 생각하고 있어서 그래.

compiled 언어는 코드에 저런 객체를 생성하면, 컴파일 시에 구문 해석이 되어 PE구조에 따라 .data 영역에 serialize된 상태로 기록되고, 파일을 실행시키면 적재된 상태 그대로 메모리에 올라가서 별다른 구문 분석없이 바로 사용할 수 있어.

그런데 javascript같은 interpreter 언어는 코드에 저걸 넣고 js파일을 실행하면 토큰마다 구문 분석을 실행하게 되고, 이로 인해 JSON.parse처럼 전반적인 parsing이 일어나게 돼.

그렇다면 어차피 string의 동일한 parsing 동작인데 왜 속도 차이가 이렇게까지 발생할까? 그건 JSON.parse보다 javascript parser가 더 많은 상황을 대비해야해서 그래.

- javascript parser
파서에서 저기까지 읽었다고 치자.

const x = 42;
const y = ({x}

여기까지 읽은 상태에서 parser는 y에 어떤 타입의 값이 들어갈 지 예측할 수 없어. 괄호가 닫힐 때까지 봐야 저 구문에 어떤 의미가 들어갈 지 알 수 있으니까.

const y = ({x});   // y = { x: 42 }
const y = ({x} = { x: 21 });  // y = { x: 21 }

첫번째 라인이면 shorthand를 사용하여 객체를 만든거고, 두번째 라인이면 object destructuring을 사용한거야.
결론적으로 javascript parser는 토큰의 전체를 봐야 타입이나 객체 구성이 가능하기 때문에 더 많은 정보를 대입해보고 찾을 수 밖에 없어.

- JSON.parse
이번엔 JSON.parse를 볼게.

const y = JSON.parse('{');

저러면 당연히 에러나겠지. JSON.parse는 '{'로 시작하면 무조건 object가 나오는걸 보장하기 때문에 그 외 다른걸 고려할 필요가 없어. (좀 이상하면 바로 에러) 
따라서 객체를 단순하게 메모리로 읽어들일 용도라면 JSON.parse가 이론적으로 가장 빨라.

- 성능 테스트
저 내용이 말은 되는데 실제로 작동할까? 저건 2019년 자료니까 지금은 다르지 않을까? 라는 의문이 들어서 chrome에서 공개한 벤치마킹 스크립트를 돌려봤어.
https://github.com/GoogleChromeLabs/json-parse-benchmark

코드를 실행하면 7MB짜리 객체 파일을 literal과 JSON.stringify로 나누어 저장하는데 각 파일은 이런 식으로 구성되어 있어.

// js.js
const data = [{"id":1,"method":"Inspector.enable"}...
// json.js
const data = JSON.parse("[{\"id\":1,\"method\":\"Inspector.enable\"}...

이걸 각각 100번씩 로딩한 값을 측정하게 되고, M1에서는 이렇게 나오더라.

Benchmarking JS literal on node… 11.695s
Benchmarking JSON.parse on node… 7.631s (1.53x faster)

원래는 v8로 로딩해야 하는데 node를 쓴 것도 있고, javascript parser가 나날이 발전해서 그런지 영상에서 설명한 것처럼 2배는 아닌데 어쨌든 월등한 결과가 나오긴 했어.


- 더 빠른 stringify
JSON.parse에 대해 찾다보니 stringify 최적화 관련 내용도 알게 되어서 잠깐 소개할게.

object의 stringify는 간단해. 하위 멤버를 순환하면서 하나의 문자열에 순차적으로 기록하면 되거든. 그런데 간단한 아이디어 추가로 이 기능을 몇배나 빨라지게 할 수 있어. 바로 스키마를 사용하는거야.

JSON.stringify에는 어떤 형태의 객체가 들어오든 모두 실시간으로 타입과 멤버를 계산하도록 되어 있어. 하지만 항상 같은 스키마의 object를 자주 stringify 해야하는 경우는 어떨까?
아래처럼 별도 함수로 구성해서 최적화하는 것도 좋은 방법이 될거야.

// obj = {a:1, b:2};
function stringifyData(obj) {
  return '{"a":' + obj.a + ',"b":' + obj.b + '}';
}

그런데 여러 타입의 객체가 사용되어야 한다면? 특정 타입에 따라 오브젝트 파싱에 분기가 필요하다면? 그 아이디어에서 시작한게 fast-json-stringify 라이브러리야.
https://github.com/fastify/fast-json-stringify

본문에 있는 활용 예제를 잠깐 옮겨와봤어.

const schema = {
  type: 'object',
  properties: {
    nickname: {
      type: 'string'
    },
    mail: {
      type: 'string'
    }
  },
  required: ['mail']
}
const stringify = fastJson(schema);
const obj = {
  nickname: 'nick',
  mail: 'nick@gmail.com'
}
console.log(stringify(obj)) 
// '{"nickname":"nick","mail":"nick@gmail.com"}'

실제 성능 테스트 결과는 이렇게 나온다고 해. (higher faster)

JSON.stringify obj x 3,153,043 ops/sec
fast-json-stringify obj x 6,866,434 ops/sec
compile-json-stringify obj x 15,886,723 ops/sec
AJV Serialize obj x 8,969,043 ops/sec

compile-json-stringify도 비슷한 아이디어로 시작한 프로젝트인데 이건 2018년이 마지막 업데이트라서 fast-json-stringify가 안정성이나 기능면에서 조금 더 나을거야.


- 결론
1) 코드로 구성된 literal 객체 로딩 속도보다 stringify된 객체의 JSON.parse 속도가 더 빠르다
2) literal이 parser에서 고려할 부분이 더 많기 때문이다
3) node18버전으로 성능 테스트 시 JSON.parse가 1.5배 빨랐다
4) stringify가 많다면 fast-json-stringify를 눈여겨 보자

이전글: https://frogred8.github.io/
#frogred8 #javascript #parse #stringify