---
layout: page
title: "[etc] 소수, 어디까지 최적화해봤니?"
---

## [etc] 소수, 어디까지 최적화해봤니?

<pre>

요즘 코테 얘기가 많아서 예전에 재미있게 풀었던 소수 문제를 하나 분석해서 공유해볼까해.

다른 사람들의 지적 유희를 헤치고 싶지 않으니 혹시 풀어볼거면 여기서 풀어보면 돼. 난 참고로 3일 걸렸는데 마지막 최적화 부분이 도달하는데 좀 오래 걸렸어. 다만 제네레이터 문법에 익숙치 않으면 낮은 단계로 먼저 풀면서 적응해보면 될거야.
https://www.codewars.com/kata/59122604e5bc240817000016


일단 소수가 뭔지는 다 알지? 1과 자신으로만 나누어 떨어지는 자연수를 말하는데 보통 에라토스테네스의 체를 사용해.
어떤 수 x가 주어졌을 때에 2,3,4,5,6.. 이렇게 다 나누어 보는 거지. 코드로 하면 이렇게 돼.

function isPrime(x) {
  for (let i=2; i<x-1; i++) {
    if (x % i === 0) return false;
  }
  return true;
}

이 코드를 기준으로 여기서 어떻게 하면 더 빠르고, 더 적은 용량으로 실행할 수 있는지 최적화를 한번 진행해볼게.


1) 짝수면 거른다
x가 소수인 10007이라고 할 때에 loop는 10000번쯤 돌면서 확인하게돼. 근데 짝수는 어차피 2로 나누어지니까 여러번 확인하지 않아도 되겠지? 그럼 짝수인지 확인하는 구문을 추가해서 loop를 두 개씩 건너뛰어도 될거야. 그리고 시작점도 3으로 바꾸고. 이걸로 전체 loop가 절반쯤 줄었어. (10000 -> 5000)

function isPrime(x) {
  if (x % 2 === 0) return false;
  for (let i=3; i<x-1; i+=2) {
    if (x % i === 0) return false;
  }
  return true;
}

2) 제곱근 사용
소수는 1과 자신으로만 나누어 떨어지는 수라고 했는데 반대로 소수가 아니라면 a*b=x 라는거니까 a,b중에 작은 수 하나만 찾으면 되는거잖아? 그리고 저 a,b는 아무리 커도 자신의 제곱근을 넘어가진 않을테니 위에 예를 든 10007인 경우에 제곱근은 100.03... 라고 나오는데 소수점은 버리고 100으로 계산하면 5000번이 넘어가던 loop가 50번으로 확 줄게 돼. (5000 -> 50)

function isPrime(x) {
  if (x % 2 === 0) return false;
  let sq = parseInt(Math.sqrt(x),10);
  for (let i=3; i<sq; i+=2) {
    if (x % i === 0) return false;
  }
  return true;
}

3) cache 적용
근데 요청마다 매번 똑같은걸 계산하긴 싫잖아? 그래서 미리 계산해서 캐싱해볼거야.

이전에 만든 함수는 잊고 1억까지의 소수 테이블을 만들건데 전역 array인 sieve 변수를 하나 할당해서 여기에 소수가 아니면 1을 기록하는데 기본 원리는 에라토스테네스의 체랑 동일해. i가 3이면 3,6,9.. i가 5면 5,10,15..를 sieve 인덱스에 1로 마킹하는거야. 

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
let sieve = new Array(limit).fill(0);
for (let i=3; i<sq; i+=2) {
  for (let k=i*i; k<limit; k+=i) {
    sieve[k] = 1;
  }
}

이렇게 하면 1억까지 캐싱하는데 전체 loop가 3억9천만번 정도 돌게 돼. 다음 단계에서는 이걸 좀 더 줄여볼거야.

4) cache - looping opt.
일단 i가 3일 때에 3,6,9..마다 체크하는 부분을 보면 짝수를 곱할 때는 굳이 마킹하지 않아도 되니까 3,9,15,21마다 체크하게 k+=i*2를 해주고, i가 3일 때에도 9일 때에도 마킹하는 수열은 동일할거잖아? 그럼 자신이 이미 마킹되어 있으면 그 이후로 안해도 되니까 내가 소수가 아니면 건너뛰는 부분을 넣어보자고. 

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
let sieve = new Array(limit).fill(0);
for (let i=3; i<sq; i+=2) {
  if (sieve[i] === 1) continue;
  for (let k=i*i; k<limit; k+=i*2) {
    sieve[k] = 1;
  }
}

이 최적화로 loop 횟수가 3억9천만->9600만번으로 줄었어. 실행 시간이 1/4로 줄어든거지.

5) cache - memory opt.
저장하는 정보는 0,1뿐이니 array에 4바이트 정수를 쓰지 않고 비트에 저장할거야. 그럼 숫자 하나에 32개의 정보를 담을 수 있겠지? 그리고 생각해보면 짝수 배열은 아예 담을 필요가 없잖아? 호출부에서 2랑 짝수인 부분만 예외로 미리 처리하면 되니까. 이 부분도 줄여보자고. 근데 코드에 비트 연산이 섞여있으면 괜히 복잡해보이니까 isPrime, setSieve 함수로 분리해서 추가해볼게.

function setSieve(num) {
  num = Math.floor(num / 2);
  let chunk = Math.floor(num / 32);
  let index = num % 32;
  sieve[chunk] |= 1 << index;
}

function isPrime(num) {
  if (num === 2) return true;
  if (num % 2 === 0) return false;
  num = Math.floor(num / 2);
  let chunk = Math.floor(num / 32);
  let index = num % 32;
  return (sieve[chunk] & (1 << index)) === 0;
}

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
const length = limit / 32 / 2;
let sieve = new Array(length).fill(0);
for (let i=3; i<sq; i+=2) {
  if (!isPrime(i)) continue;
  for (let k=i*i; k<limit; k+=i*2) {
    setSieve(k);
  }
}

이렇게 해서 기존에 400MB를 소비했던 cache 객체가 6.2MB로 줄어들었어. 


여기서 조금 더 최적화하면 가독성을 살짝 헤치겠지만 더 빠르긴 할거야. chunk, index구하는 부분을 비트 연산으로 바꾼다던가 isPrime에서 cache 호출용을 분리해서 사용한다던가 등등. (2, 짝수 확인 부분 분리)
문제와는 상관없지만 조금 더 확장해 볼 부분으로는 정적 배열만 사용했는데 동적으로 캐싱하는 부분이 늘어날 때에 설계를 어떻게 할 것인가 (memoization), N번째 소수를 찾는 요구사항에는 어떻게 구현할 것인가 같은 것도 생각해보면 재미있고.

이 문제가 재미있던건 실무에서도 긴 flag용 배열을 bit로 바꿔서 공간 효율화를 추구할 경우가 가끔 있어서 꽤 좋은 문제라고 생각했어. 그리고 문제의 요구사항과 제한사항을 명확히 이해하고 있어야 풀 수 있는 부분도 참신했고. 난 왠지 문제 설명만 한페이지 가득 있는 코테를 보면 좀 지치더라. 이런 간단하면서도 자유분방한 문제가 좋은듯.

써놓고 다시 한번 쭉 읽어보니 다들 조금만 고민하면 답할 수 있는건데 괜히 썼나 싶기도 한데 뭐 그냥 출근길에 가볍게 읽어줘.

이전글: https://frogred8.github.io/
#frogred8 #codetest #prime