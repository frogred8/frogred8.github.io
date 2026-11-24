---
layout: page
title: "[c++] MSVC, GCC의 unordered_map 구현 분석"
date: 2026-10-30
---

<pre>
최근에 c++로 된 오픈소스를 몇 개 구경하다가 unordered_map의 bucket을 소수로 설정한다는 주석을 봤어.
bucket이 2^n으로 되어있으면 hash 함수에 따라 특정 패턴의 값으로 치우침이 있을 수 있기 때문에 거기까진 이해했는데 rehash로 doubling이 되면 다시 짝수가 되는거 아닌가 싶은 생각이 들더라고.
그래서 unordered_map의 MSVC STL과 gcc STL의 구현부를 살펴봤는데 서로 다른 철학으로 구현되어 있는 게 꽤 재밌어서 간단히 글을 써봤어.


- 분석 시작
일단 각 코드를 git에서 찾아서 받았어. 이런 대형 라이브러리는 git clone --depth=1 로 커밋 히스토리를 없애고 받아오는게 좋아.
오랜 시간동안 많은 수정이 이뤄졌기 때문에 커밋 히스토리가 코드보다 훨씬 더 크거든.
내부 서버에서 ci/cd로 자동 빌드&배포할 때에도 이 옵션이 유용해.

어쨌든 검색해서 아래 두 개의 레포를 찾아냈어.
MSVC STL: https://github.com/microsoft/STL
gcc: https://github.com/gcc-mirror/gcc.git

잠깐 열어보니 대부분 unordered_map 파일 하나에 구현부가 모여있어서 편했어.
아무래도 가장 밑바닥 자료구조다보니 참조하는 게 적더라.
각 라이브러리마다 hashing 정책, 저장하는 자료구조, rehash 조건 및 구현에 대해서 살펴볼거야.
그럼 MSVC부터 시작할게.


- MSVC STL
microsoft visual c++ 컴파일러에서 사용하는 standard library 코드야.
2019년에 github으로 공개해서 오픈소스로 전환했다고 해. 

key의 hashing 정책부터 보면, 모든 키는 hashing해서 숫자로 변환하는데 키가 string이면 특수화된 hash<string<>> 으로 문자열 길이만큼 돌면서 숫자로 변환하게 돼. 
이렇게 얻은 키에 대한 hash값으로 bucket을 구하게 되는데 이건 최대 사이즈-1 값으로 xor 연산을 하고 있어.

bucket = hash & (size-1);

여기서 size는 2^n으로만 증가하기 때문에 양수에 한해서 나머지 연산과 동일하지만 이건 비트 연산이라 나머지 연산보다 더 빠른게 소소한 장점이야.
그리고 당연히 hash가 달라도 bucket은 동일할 수 있어. 예를 들어 bucket_size가 8인 상태라면 hash 3과 11은 동일한 bucket인 3을 반환할거야.


이제 unordered_map의 실제 내부 변수를 한번 보고 갈게.

template <class T>
class unordered_map {
    using value_type = pair<Key, T>;
    using _Mylist = list<value_type>;
    using _MylistIter = _Mylist::iterator;

    _Mylist _List;  // 전체 key/value 리스트 
    vector<_MylistIter> _Vec;  // bucket별 시작/끝 반복자
    size_type _Mask;    // bucket_count - 1
    size_type _Maxidx;  // 현재 버킷 수
}

선언부를 빼면 주요 변수는 4개 뿐인데 하나씩 알아보면, 
_List는 unordered_map에 추가된 모든 key/value를 저장하는 전체 리스트야. 
그리고 _Vec이 실제 bucket 접근자인데 8개의 bucket을 가진 unordered_map이 생성되었다고 했을 때, _Vec은 8개 개별 bucket의 시작/마지막에 대한 list 반복자를 지정하게 돼.
그렇게 _Vec은 8*2=16개의 반복자를 보관하는 배열이 되고, 접근할 bucket*2 인덱스의 반복자를 가져와서 값을 가져오는거야.
A~F까지의 값이 0~3번 사이의 bucket에 분포되어 있다면 이런 식으로 저장될거야.

_List:
A -> B -> C -> D -> E -> F

_Vec:
// [bucket*2, +1] -> [start, end]
[0,1] -> [A,B]  // 0번 bucket: A,B
[2,3] -> [C,E]  // 1번: C,D,E
[4,5] -> [null, null] // 2번: 비었음
[6,7] -> [F,F]  // 3번: F
...
[14,15] -> [null, null]  // 7번 bucket

여기서 end 반복자는 왜 필요할까? 어차피 동일 bucket이면 시작 반복자부터 하나씩 세서 확인하게 되잖아.
end 반복자가 필요한 이유는 모든 값이 하나의 리스트에 연속으로 이어져서 시작 반복자만 있으면 그 bucket이 어느 노드까지 같은 bucket에 속해있는지 알 수 없기 때문이야.
사실 end 반복자를 없애기 위해서는 현재 bucket과 같은 항목인지만 확인하면 되는 거라 자신의 bucket 정보를 저장하는게 낫지 않나 싶긴 했는데 트레이드오프니까 뭐..

다음으로 rehash 정책은, 일단 대다수의 자료구조처럼 여기서도 최대 사이즈(여기서는 bucket 개수)에 도달하면 rehash가 발생해.
이 때, 늘어나게 되는건 _List가 아니라 bucket 정보를 담고 있는 _Vec 객체야. (노드는 생성할 때마다 할당되니까)
그래서 전체 멤버 개수만큼 돌면서 개별 key에 대한 bucket을 계산하고 해당 bucket에 맞는 _Vec 배열에 begin/end 반복자 정보를 갱신시키는 작업을 하게 돼.

이 rehash 비용이 크다 보니까 512개 이하일 경우에는 공간을 2배씩 증가시키지 않고, 8배씩 증가시키는 전략을 취하고 있어. 그래서 최초 할당될 때부터 순차적으로 8->64->512->1024.. 으로 증가하며 rehash를 최대한 줄이는거지.
여기까지 MSVC에 포함된 내용을 봤고, 다음은 gcc인데 방식은 비슷하니 차이점 위주로 볼게.


- gcc STL
MSVC에는 하나의 구현체만 있는데 gcc에서는 필요한 부품들은 다 만들어놓고, 최종 조합에서만 선택적으로 사용하는 느낌이었어.
여기에서도 hashing 정책과 저장 자료구조, rehash를 순서대로 볼게.

gcc unordered_map의 hashing 정책은 두 가지로 구현되어있어. 
_Mask_range_hashing, _Mod_range_hashing이 구현된 함수 객체들인데 Mask는 위에서 사용했던 & 연산으로 bucket을 구하는 방식이고, Mod가 나머지 연산으로 하는 방식이야. 실제 코드에선 이렇게 되어있어.

struct _Mod_range_hashing
{
  size_t operator()(size_t __num, size_t __den) const noexcept {
    return __num % __den;
  }
};

실제 사용은 _RangeHash{}(from, count) 이런 방식으로 임시 객체를 매번 생성해서 사용하지만 워낙 똑똑한 컴파일러가 이런 간단한 로직은 다 인라인으로 만들어서 객체 생성 비용은 물론 호출 비용도 없어지니 괜찮아.
unordered_map에서는 _Mod_range_hashing만 사용하는데 그 이유는 bucket 최대 크기가 2^n으로 늘어나지 않기 때문이야.
이건 아래에서 조금 더 자세히 살펴보고, 다음은 자료구조야.

class unordered_map {
  __buckets_ptr _M_buckets;  // bucket 배열
  size_type _M_bucket_count; // bucket 개수
  size_type _M_element_count;  // 멤버 개수
  __node_base _M_before_begin; // 전체 key/value 리스트 시작 노드
  _RehashPolicy _M_rehash_policy;  // rehash 정책
}

이 구현도 동일하게 실제 데이터는 노드로 추가되어 리스트로 관리되는데, bucket으로 접근하는 배열에는 하나의 노드 반복자만 저장되어있어. 
MSVC에서는 start/end 두개였잖아. 아까 고민했던 것처럼 end 반복자를 삭제하고 bucket을 실시간으로 구하는 방법이 역시 나쁘진 않았나 봐.
여기서는 __cache_hash_code 플래그로 개별 노드에 hash 캐싱의 저장 유무를 결정하고, 로직에서는 캐싱이 있으면 미리 저장된 hash로 bucket을 계산하고, 없다면 key에서 hash계산한걸 다시 bucket으로 변환하는 방식으로 구현했어.
그런데 4byte 아까워서 안할 필요는 없으니 캐시가 항상 켜져있게 되어있어서 결국 bucket 하나에 여러 개의 값이 연속된 리스트로 붙어있고 이 리스트가 언제 끝나는지는 다음 노드의 hash가 현재 bucket인지 비교하여 결정하게 돼.
이것만 빼면 자료구조랑 rehash 구현부는 사실 MSVC와 거의 동일한 수준이야.

가장 큰 차이라면 bucket 크기를 MSVC의 doubling(사실 8배긴 하지만)이 아니라 소수로 지정하고 있다는 점이야.
hashtable-aux.cc 파일에 보면 이런 식으로 소수를 배열로 저장해놓고 늘리려는 최대값보다 큰 소수가 선택되게 해놨어. 간단한 의사 코드랑 같이 볼게.

// 이런 식으로 256+@개
prime_list[] = { 2, 3, 5, 7, 11, 13, 17, 19, ...
if (curr_size >= max_size) {
  max_size = lower_bound(prime_list, max_size*2);
  set_bucket_max_size(max_size);
  // run rehash
}

prime_list에는 순차적으로 소수가 기록된 배열이 있고, 해당 소수 배열에서 기존 최댓값의 두배보다 큰 첫번째 소수를 검색(lower_bound 함수 역할)해서 최대 사이즈를 설정하고, rehash가 작동하는 구문이야.
이 구조대로 unordered_map에 멤버를 하나씩 넣어보면 bucket 크기가 13, 29, 59, 127, 257로 증가하게 되어 있어. 메모리 할당 시 align이 안맞아서 살짝 비효율적이긴 하지만 bucket마다 chaining이 최대한 적게 하고 싶다는 컨셉이라면 소수로 하는게 정답이긴 해.
gcc에 하드코딩으로 들어가있는 저 소수 배열은 모든 소수를 기록한 건 아니고, 숫자가 커질수록 적당히 생략되어 있어. 15173 다음 소수가 15187인데 저 배열에서는 다음 값이 16411인 것처럼 말이야.
참고로 배열의 256번째 소수는 4294967291이야. (2^32 - 5)
이와 별개로 meta의 해시맵 구현체에 최적화 관련해서 재미있는 부분이 많아서 잠깐 소개만 하려다가 글이 너무 길어져서 그건 다음 주제로 가져올게.


- 소회
굳이 글로 정리할 필요가 있을까 싶을 정도로 AI가 코드 분석을 잘해줘서 많이 배우는 시간이었어.
이런 cs지식들도 이젠 개발자의 소양이라기보단 뜨개질 같은 취미생활에 가까워지는 듯하네.
기술의 발전으로 순수한 코드 분석의 재미는 대부분 사라졌지만, 아직은 글 쓰는 게 재미있으니까 가끔이라도 써볼게.


- 결론
1) MSVC, gcc의 unordered_map은 전체 노드를 리스트로 묶는 큰 틀은 같지만, bucket과 반복자 관리에서 다른 정책을 사용한다.
2) MSVC는 512보다 작은 크기에서는 bucket 확장 시 8배씩 증가하여 작은 크기에서의 잦은 rehash를 방지했다.
3) gcc는 메모리 효율을 조금 포기하고 최대 bucket을 소수 테이블을 참고하여 사용한다.
4) 결국 어떤 비용을 줄이고 어디에 집중할 지에 대한 트레이드오프의 차이가 이를 결정한다.


이전글: https://blog.frogred8.dev
#frogred8 #unordered_map #c++

</pre>
