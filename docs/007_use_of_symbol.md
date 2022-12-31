---
layout: page
title: "[javascript] Symbol의 활용"
date: 2022-05-25
---

<pre>
이번엔 작고 귀여운 녀석을 가져와봤어.

자바스크립트에 Symbol은 많이 들어봤을거야. Symbol은 primitive value 타입 7개 중 하나로 아래 mdn문서를 참고하면 조금 더 자세히 나와있어.
https://developer.mozilla.org/ko/docs/Glossary/Primitive

근데 사실 한번도 안써보거나 아예 존재 자체를 모르는 사람들이 많을거야. 왜냐하면 나도 알기만 했거든. 마치 유니콘 같은 존재인양.. 아래는 Symbol의 설명이야.
"Symbol()로부터 반환되는 모든 심볼 값은 고유합니다. 심볼 값은 객체 프로퍼티(object properties)에 대한 식별자로 사용될 수 있습니다"

이게 무슨 소리지.. 고유값인건 알겠는데 이걸 어디다 쓰지.. 하다가 이번에 v8 코드를 보며 새롭게 깨달은게 있어서 잠깐 공유해볼까 해.



이 함수가 내 의문을 가지게 한 함수야.

// client.js
get [kPending] () {
  return this[kQueue].length - this[kPendingIdx]
}

여기 kPending값은 아래 파일에 선언되어 있었고.

// symbol.js
module.exports = {
  kPending: Symbol('pending'),
  ...
}

여기서 궁금증은 그냥 "pending"으로 안하고 왜 굳이 저렇게 했을까 였어. 저렇게 하면 접근을 아무 곳에서도 못하거든. Symbol의 성격이 잘 이해안되는 아래 예를 보여줄게.

> var sb = Symbol('foo');
undefined
> var a={[sb]: 'bar'}
undefined
> a['foo']
undefined
> a[Symbol('foo')]
undefined
> a[sb]
'bar'

이렇게 a안에 선언된 심볼 foo는 고유 접근자 sb로만 접근할 수 있어. 고유하기 때문에 동일한 값으로 심볼을 만들어도 접근하지 못해. 여기서 난 깨달았어.

일단 자바스크립트는 클래스가 있지만 접근 제한자가 없어. 그래서 아무리 숨겨도 결국 접근이 가능하지. 그럼 어떻게 private하게 만들 수 있을지 고민하던 분들이 아예 접근자를 숨겨놓는 방식으로 해버린거야.

저 symbol.js 파일을 공유받지 못한 파일에서는 제일 처음에 선언한 getter 함수에 접근할 수 없는거지. 언어에서 접근 제한자가 없으니 고유 접근자를 따로 만들어서 제한하는 클라스~ 역시 구글갓

자바스크립트는 보통 프로젝트 크기가 작을 뿐더러 커질수록 유지보수가 상당히 힘든데 node같은 대단위 프로젝트에서만 볼 수 있는 고오급 기법이라 한번 소개해봤어. 확실히 이런 프로젝트들은 멀리서 보면 그저 잘 돌아가겠거니 하는데 자세히 볼수록 감탄하게 되는 구석이 있어.

결론)
1) Symbol은 고유값을 가지는 primitive value이다
2) 이 접근자를 통해 클래스에 private한 접근을 구현할 수 있다
3) 구글 차냥해


이런거 쓰면서 나도 많은 공부가 되고 있는데 혹시 내가 잘못 설명했거나 다른 의견 있으면 언제든 덧글 부탁해. 

#javascript #symbol
