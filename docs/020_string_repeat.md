---
layout: page
title: "[go] string.repeat 세부 구현"
date: 2023-03-11
---

<pre>
요즘 go 구현부를 보다가 string.repeat 구현이 재미있길래 분석해보고, 다른 언어들의 repeat 구현부랑 같이 비교도 잠깐 해봤어. (javascript, rust)


- 개요
일단 내 시선을 끈 건 strings.go 파일에서 유난히 긴 한 문단의 주석이었어.
cpu d-cache나 L1 cache도 언급하길래 흥미로웠거든. 링크는 여기.
https://github.com/golang/go/blob/master/src/strings/strings.go#L565


- 기본 사항
보통 string.repeat 함수를 구현한다고 생각하면 이럴거야.

function repeat(s, n) {
  let ret = '';
  for (let i=0; i&lt;n; i++) {
    ret += s;
  }
  return ret;
}

대상 문자열 s를 n번 더하는 일반적인 방법이야.
그런데 만약 n이 천번, 만번이라면?


- 일반적인 최적화
일단 문자열 버퍼 크기가 늘어나면서 자주 realloc이 발생하는걸 막아야겠지?
반환해야하는 문자열 전체 크기로 버퍼를 미리 할당해주고,
이전에 복사했던 문자열을 그대로 더하는 doubling을 사용해볼게.
js에서는 문자열 버퍼 크기 선할당이 안돼서 go로 만들었어.

func repeat(s string, count int) string {
  var b Builder
  n := len(s) * count
  b.Grow(n)
  b.WriteString(s)

  for b.Len() < n {
    chunk := n - b.Len()
    if chunk > b.Len() {
      chunk = b.Len()
    }
    b.WriteString(b.String()[:chunk])
  }
  return b.String()
}

go문법은 c like라서 설명할 건 딱히 없는데 이거 하나만 볼게.
b.String()[:chunk]는 문자열 b에서 [start:end]까지의 값을 반환하는 substr을 뜻해.
여기서는 start가 없으니 chunk까지만 자른 값을 반환하라는거고.
python 문자열이랑 거의 비슷하지. (step은 없지만..)

함수에 'ab', 10을 넣고 for에서 값을 출력해보면 이런 식으로 doubling 하는걸 알 수 있어.
abab
abababab
abababababababab
abababababababababab

최적화 전에는 O(n) 복잡도를 가지지만 개선 이후에는 O(log n)으로 줄어들게 돼
repeat(100)은 7회, 10000번은 14회...


- go의 최적화
strings.go는 여기서 조금 더 나갔어.
바로 cpu레벨의 캐시를 고려해서 더해지는 문자열 최대 크기를 8kb 이하로 설정한거야.

이 부분은 예전에 쓴 글에서 잠깐 다룬 내용인데 https://frogred8.github.io/docs/014_cache_line
cpu에는 L1~3 캐시가 있고, 보통 L1,L2는 코어마다 할당되는 캐시 메모리야.
이 캐시들은 크기가 작기 때문에 캐시 로스 발생 시 L3, 거기도 없으면 메모리까지 가서 patch해오는 과정을 겪게 돼.
(참고로 cpu별 L1캐시 크기가 13900k는 p-core 80kb, e-core 96kb이고, amd 7950x는 64kb를 가지고 있어.)

go 개발자들은 지나치게 큰 문자열을 한 번에 복사할 때의 급격한 속도 저하를 cpu 캐시 미스를 줄이면서 해결했어.
한번에 복사하는 문자열 길이를 8kb로 제한해서 최대한 L1~2 레벨 캐시 로스가 발생하지 않게 한거지.
그 주석에 써있기로는, L2 캐시 크기 이상의 문자열을 복사할 때에 최대 100% 정도의 성능 향상을 이뤄냈다고 해.

아래는 이 과정을 거친 최종 완성된 코드야. (일반적인 가드 처리 같은건 뺐어)

func repeat(s string, count int) string {
  n := len(s) * count
  const chunkLimit = 8 * 1024
  chunkMax := n
  if n > chunkLimit {
    chunkMax = chunkLimit / len(s) * len(s)
    if chunkMax == 0 {
      chunkMax = len(s)
    }
  }

  var b Builder
  b.Grow(n)
  b.WriteString(s)
  for b.Len() < n {
    chunk := n - b.Len()
    if chunk > b.Len() {
      chunk = b.Len()
    }
    if chunk > chunkMax {
      chunk = chunkMax
    }
    b.WriteString(b.String()[:chunk])
  }
  return b.String()
}


- javascript는 어떨까?
nodejs(v8)을 기준으로 보면 이렇게 구현되어 있었어.

// src/js/string.js
repeat(count) {
  var s = TO_STRING(this);
  var n = TO_INTEGER(count);
  var r = "";
  while (true) {
    if (n & 1) r += s;
    n >>= 1;
    if (n === 0) return r;
    s += s;
  }
}

다만 2017년에 js로 구현되어 있던 함수를 CSA(code stub assembler)로 포팅하는 개선 작업이 이뤄졌어
https://chromium-review.googlesource.com/c/v8/v8/+/659097

2019년에는 다시 CSA에서 torque 스크립트로 포팅되면서 지금은 torque 버전을 쓰고 있는 상태야. 로직은 거의 비슷해.
https://chromium-review.googlesource.com/c/v8/v8/+/1524640


- rust 구현
rust도 비슷하게 문자열을 2배씩 늘리면서 복사하는데 여기서는 짜투리를 따로 더해주는 로직이 추가된게 조금 달라.loop에서 매번 확인하지 않고 별도로 빼는게 낫다고 생각한듯.
https://github.com/rust-lang/rust/blob/master/library/alloc/src/slice.rs#L489


- 결론
1) go의 strings.repeat은 cpu 캐시를 고려하여 최적화 되어있다
2) javascript, rust에서도 비슷하게 구현되어 있지만 복사할 문자열이 지나치게 길 경우에 go보다는 느리게 작동할 것이다
3) 튜닝의 끝은 언제나 비슷


#frogred8 #go #javascript