---
layout: page
title: "[c++] 빠르게, 더 빠르게 (성능 튜닝)"
date: 2023-12-03
---

<pre>
이번 글은 최근에 재미있게 본 유튜브 영상을 하나 정리해봤어.
https://www.youtube.com/watch?v=fV6qYho-XVs
특정 타입의 변수를 받아서 문자열을 만드는 함수 하나를 최적화하는 내용인데, 왜 그런 결과가 나오는지 자세히 분석해서 단계 별로 개선하는 방식이 참 좋더라.


- 1번 코드 (550ns)
아래 코드는 실행할 때 550ns가 걸리는 코드야.

#include &lt;sstream>
using namespace std;
string newOrder(string id, int price, int quantity) {
  stringstream s;
  s << "NEW " << id << " " << price << " " << quantity;
  return s.str();
}

간단히 stringstream 객체에 문자와 값을 합성해서 하나의 문자열을 반환하는 기능인데 저 함수에 값을 넣어보면 결과는 이런 식으로 나오게 될거야.

newOrder("20",10000,30)
-> "NEW 20 10000 30"

이 코드에서 최적화 해볼 부분은 뭘까?
그냥 직관적으로 보면 파라미터를 call by value로 받고 있어서 string 임시 객체가 매번 생성되는 부분이 가장 오래 걸릴것 같고, stringstream 생성 비용도 만만찮을 느낌이 들고 등등..
그런데 저 코드를 perf 툴로 분석해보면 이런 식으로 나온다고 해.

26.46%  __dynamic_cast
 6.00%  ostream:_M_insert
 5.12%  __strcmp_sse2_unaligned
 4.10%  _int_free
 3.99%  _basic_streambuf::xsputn
 3.72%  newOrder
...

결과를 보면 동적 변환 루틴이 가장 많은 부하를 내고 있어.
저 내부를 보면 그 중에서도 locale 관련된 부하가 높은데, 내가 설정한 locale인지 template 안에서 비교하는 루틴도 있어 (has_facet)
그런 부분이 dynamic_cast와 strcmp_sse2 로직의 부하를 일으키고 있으니, 메인 로직과 관련없는 동작에만 30%의 시간이 소모되고 있었던 거야.
(이 부분은 자세히 쓰려니 너무 길어져서 축약했어. 궁금한 사람은 영상을 참고해)


- 2번 코드 (550ns -> 130ns, 4x)
이번에는 string 객체를 사용하지 않고, sprintf 로 구현하여 이전보다 4배 이상 빨라진 결과가 나왔어.

void newOrder(char *buf, const char *id, int price, int quantity) {
  sprintf(buf, "NEW %s %d %d", id, price, quantity);
}

이제 좀 그럴싸해졌지? 이에 대한 perf 결과야.

47.38%  vfprintf
21.51%  _IO_default_xsputn
 9.81%  __strchrnul
 6.80%  _itoa_word

위에서부터 하나씩 보면, 
printf 계열의 함수는 출력하는 곳만 다르고 결국 vfprintf 함수를 호출하게 돼서 저기를 거치게 돼.
그리고 _IO_default_xsputn을 사용하여 버퍼에 문자열 출력을 하고, __strchrnul은 문자열 끝인지 확인하는 기능이야.
마지막인 _itoa_word는 숫자를 문자로 치환하는 역할을 하고 있고.

이를 전체적으로 평가해보면 저 중에 80%의 시간은 우리가 원하는 기능과 상관없는 일을 하고 있는걸 알 수 있어.
다음은 진짜 필요한 기능만 있는 formatter를 만들고, itoa도 좀 더 빠르게 만들어 볼거야.


- 3번 코드 (550ns -> 130 -> 20ns, 27x)
이전 결과보다 6.5배, 최초 코드보다는 27배가 더 빠른 코드가 되었어.
여기서는 아래 세 가지를 순서대로 하나씩 살펴볼거야.
format 클래스와 itoa 최적화, 실제 사용부인데 코드는 좀 길지만 구현은 단순해.

class Format {
  char _buffer[2048];
  int _ptr;
public:
  Format() : _ptr(0) {}
  void append(char c) { _buffer[_ptr++] = c; }
  void append(const char *data) {
    while (*data) append(*data++);
  }
  void finish() { append('\x00'); }
  ...
}

format 클래스를 보면, 생성 시 내부 버퍼와 커서(_ptr)를 가지고 있고, append 함수로 char 혹은 연속된 char* 를 받아서 버퍼에 하나씩 더해주는 간단한 기능이야.
마지막에 종료 문자를 추가하는 finish 함수도 있고.

그리고 아래 코드는 itoa 최적화인데, 가장 끝자리부터 숫자를 하나씩 분리해서 문자로 변환하여 붙여놓고 마지막에 이 문자열을 뒤집는 방식이야.

void decimalAppendNonNeg(unsigned value) {
  int startPos = _ptr;
  do {
    append((char)(value % 10) + '0');
    value /= 10;
  } while (value);

  // Reverse the digits.
  auto end = &_buffer[_ptr - 1];
  auto start = &_buffer[startPos];
  while (end > start) swap(*start++, *end--);
}
  
void decimalAppend(int value) {
  if (value < 0) {
    append('-');
    value = -value;
  }
  decimalAppendNonNeg(value);
}

c코드를 오랜만에 봤더니 javascript처럼 '0'을 더해주는게 왠지 문자열 합성같아서 잠깐 헷갈렸는데 저건 그냥 '0'의 ascii 코드를 더해주는 코드야.
예를 들어 value가 3이라면 이렇게 되겠지.
3 + '0' = 3 + 48 = 51 = '3'

전체 로직은 value가 365라면, 첫번째 while문이 끝났을 때에 '563'이 버퍼에 있을거고, 그 아래 reverse 로직을 실행하면 '365'값으로 변환이 잘 될거야.
그리고 타입이 int라면 음수일 때에 '-'문자도 추가해주고 있어.

실제 사용부는 아래처럼 변경됐어.

void newOrder(Format &format, const char *id, int price, int quantity) {
  format.append("NEW ");
  format.append(id);
  format.append(' ');
  format.decimalAppend(price);
  format.append(' ');
  format.decimalAppendNonNeg(quantity);
  format.finish();
}

기존에 stringstream보다 살짝 복잡해졌지만 성능은 많이 올라간 상태야.
여기서 멈춰도 충분하지만 조금 더 고민해 볼 부분이 있어.


- 4번째 코드 (550ns -> 130 -> 20ns -> 13ns, 42x)
이전보다 무려 35%나 개선된 코드야.
이전 코드에서 어느 부분을 개선시켜야 이정도의 효과가 있었을까?

간단히 나열해보면, 한자리씩 계산하지 말고 두자리씩 계산하면 두배로 빠르겠지? loop도 덜 돌고 말이야. 거기에 매번 +'0'을 하지 않도록 0~99까지 lookup 테이블을 만들어놓으면 더 빨라질거야.
그리고 reverse도 문제야. 기껏 변환해서 더해놓은 버퍼를 자릿수/2만큼 loop돌면서 뒷자리랑 앞자리를 치환해야 하잖아?
만약 숫자 자릿수를 미리 알 수 있다면 그 자리부터 채울 수 있어서 reverse를 하지 않아도 될텐데 말이야.

이런 개선점을 적용한 코드를 하나씩 풀어볼게.

static uint16_t _lookup[100];
static void init() {
  for (int i = 0; i < 100; ++i) {
    auto dig1 = '0' + (i % 10);
    auto dig2  = '0' + ((i/10) % 10);
    _lookup[i] = dig2 | dig1 << 8;
  }
}

먼저 lookup table인데 간단해. 0~99까지의 인덱스에 그에 맞는 문자를 대입해서 적용시켜주는거야.
이 때, index마다 char[2]가 아니라 uint16_t로 2byte를 or 연산자로 묶어서 저장하게 돼.

그리고 마지막으로, reverse를 사용하지 않기 위해서 숫자 자릿수를 알아내서 저 lookup table을 참조하는 코드를 볼건데 여기가 이번 글에서 가장 재미있는 부분이야.

static unsigned const PowersOf10[] = 
{1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000};

static unsigned numDigits(unsigned v) {
  auto log2 = 31 - __builtin_clz(v);
  auto log10Approx = (log2 + 1) * 1233 >> 12;
  auto log10 = log10Approx - (v < PowersOf10[log10Approx]);
  return log10 + 1;
}

일단 numDigits는 받은 숫자의 자릿수를 반환하는 함수야.
그런데 자릿수 계산하면서 log가 보이지? 여기서의 logN은 밑수가 10인 상용로그를 말하는데 이 표를 보면 쉽게 알 수 있어.

log(10) = 1
log(100) = 2
log(1000) = 3
...

그럼 floor(log(v))+1 하면 바로 자릿수가 나오겠네? 맞아. 그런데 log함수는 매우 비싼거 알지? 그래서 여기서는 log10을 정수형 연산으로 한번 더 최적화시켰어.

여기서는 __builtin_clz라는 내장 함수를 사용했는데 이건 전달받은 변수의 연속되는 0의 개수를 반환하는 함수야.
예를 들어 숫자 35는 2진수로 100011으로 6자리인데 이를 앞에서부터 연속된 0의 개수를 세면 26이 반환되는 식인거지. (32-6=26)
clz로 나온 값은 남은 비트니까 31에서 빼주면 결국 log2(v)값을 얻을 수 있어.

이렇게 clz 내장 함수로 log2를 구하고, 구하려고 하는 log10에 log2를 곱하고 나눠주는데 log10(x) / log2(x)는 x가 어떤 수라도 동일하니까 미리 계산해놓으면 0.30103 정도가 나와.
이걸 그대로 곱하면 실수 연산이 되니까 저 값을 2의 완전제곱수인 분수로 바꾸면 1233/4096 정도로 변환할 수 있어.
4096은 2^12이니까 이걸 비트 연산으로 나눈게 아래 공식이야. 아름답지?

log2(x) = 31 - __builtin_clz(v)
log10(x) = log2(x) * log10(x) / log2(x)
log10(x) / log2(x) = 0.301029996...
log10(x) = log2(x) * 1233 / 4096
log10(x) = log2(x) * 1233 >> 12

이렇게 해서 실수 연산을 쓰지 않고 곱연산+비트연산으로 바꿔서 log10(v)를 구할 수 있었어.
다만 log로 분해하다보니 정확하지 않은 어림짐작한 수라서 PowersOf10 테이블을 이용하여 보정을 해주고 있긴 하더라고.

공식을 사용하면 일반화시킬 수 있기 때문에 32비트 외에 128비트의 수에서도 가능하지만 작은 수라면 사실 분기문으로 해도 나쁘진 않을 것 같아. (나중에 분석도 훨씬 편하고)

if (v < 10) return 1;
else if (v < 100) return 2;
else if (v < 1000) return 3;
else if (v < 10000) return 4;
...


여기까지가 숫자 자릿수를 얻어오는 부분이었고, 이제 이를 활용하여 lookup 테이블을 참조하는 코드만 보고 마무리할게.

void decimalAppendNonZero(unsigned value) {
  auto digits = numDigits(value);
#define CASE(XX) case XX: decimalPadAppend2&lt;XX>(value); break
  switch (digits) {
    CASE(1);
    CASE(2);
    CASE(3);
    ...
  }
}

template&lt;int N>
inline void decimalPadAppend2(unsigned value) {
  if (N >= 2) {
    for (int i = N - 2; i >= 0; i -= 2) {
      auto twoDigits = value % 100;
      value /= 100;
      *reinterpret_cast&lt;uint16_t *>(_buffer + _ptr + i) = _lookup[twoDigits];
    }
  }
  if (N & 1) _buffer[_ptr] = value % 10 + '0';
  _ptr += N;
}

define으로 template 함수를 만들어 호출하는데 N이 자릿수인데 여기서 _buffer에 _ptr+i 번지에 뒷자리부터 채워넣는걸 볼 수 있어.
실제 완성된 마지막 코드는 이 링크에서 확인할 수 있어.
https://godbolt.org/z/3befMz74j


- 소회 (feat. perf)
이 글을 쓸 때에 예제 코드 컴파일해서 직접 perf로 돌린 결과로 하고 싶어서 어제 하루종일 도전해봤는데 원하는 결과가 안나와서 결국 유튜브에 있는 지표를 그대로 옮겼어.

perf는 커널에서 perf_events를 받아서 성능 측정하는 도구인데 당연히 리눅스 커널이랑 물려있다보니 mac에서 docker로 linux 띄워서 적용하는게 쉽지 않았어. 
docker 띄울 때에 privilege 모드랑 seccomp 설정 파일도 매핑하고, 안에서 linux_tools도 별도로 깔아야 하는데 버전도 잘 안맞아서 여러개 깔아보고 등등..
그렇게 우여곡절 끝에 perf를 설치해서 동일 로직을 컴파일해서 돌려봤더니 내 결과는 뭔가 좀 다르기도 하고 조잡하게 나와서 안되겠더라고.
(WSL2에서도 해봤는데 거기도 설정할게 꽤 많더라..)

내 숙련도가 낮아서 그런가 싶기도 한데 하루를 통으로 날린게 아까우니까 perf로 2번 코드(sprintf) 돌려본거 하나만 첨부해볼게. 명령줄은 이렇게 했어.

perf record --call-graph dwarf ./test2

-   83.14%    47.97%  test2    libc.so.6
  + 47.97% _start
  - 35.17% __vfprintf_internal
    - 23.66% outstring_func (inlined)
      - __GI__IO_default_xsputn (inlined)
        __GI__IO_default_xsputn (inlined)
      6.65% _itoa_word
    - 3.24% __find_specmb (inlined)
      __strchrnul
      1.62% __GI_strlen (inlined)


- 결론
1) 최적화 할 때에는 직관을 따르지 말고, 면밀한 성능 측정이 우선되어야 한다.
2) perf 잘 쓰고 싶다..
3) godbolt 짱짱

이전글: https://frogred8.github.io/
#frogred8 #c++ #performance