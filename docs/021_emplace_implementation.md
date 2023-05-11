---
layout: page
title: "[c++] emplace 세부 구현 분석"
date: 2023-05-11
---

<pre>
c++11에서 새롭게 추가된 emplace는 많이 들어보고 써봤을거야. 모르는 사람들을 위해서 실제 사용 예를 기준으로 알아보면, 보통 vector에 멤버를 추가할 때 push_back을 써서 추가했어.

vector&lt;Car> cars;
cars.push_back(Car('tico', 4));

근데 이렇게 쓰면 비효율적이야. 왜냐하면 vector에 멤버 추가될 때에 더미 객체의 복사 생성자+소멸자가 호출되기 때문이야. 그래서 예전에는 생성자가 한번만 호출되도록 포인터만 넣는 방식도 주로 썼어.

vector&lt;Car*> cars;
cars.push_back(new Car('tico', 4));

보통 vector를 관리하는 객체 안에서 insert와 remove를 랩핑한 메소드로 메모리 생성과 삭제를 안보이게 처리하거나 메모리풀이랑 연계해서 쓰기도 했지.

다시 현재로 돌아와서 emplace 기능을 사용해보면, 멤버를 추가할 때 가장 마지막 메모리 주소에 직접 생성하기 때문에 기존의 push_back에 비해 복사 생성자+소멸자가 호출되지 않는 장점이 있어.

vector&lt;Car> cars;
cars.emplace_back('tico', 4);

근데 왜 예전에는 이렇게 좋은 기능이 없었을까? 에서 시작된 궁금증을 풀어본 글이야.


- 구현부 분석
gcc에 있는건 define이 복잡하길래 boost코드로 가져와봤어. 어차피 구조는 동일해.

template &lt;class... _Args>
void __split_buffer::emplace_back(_Args&&... __args)
{
  if (__end_ == __end_cap()) {
    // 대충 메모리 늘리고 복사하는 코드
  }
  __alloc_traits::construct(__alloc(), _VSTD::__to_address(__end_), _VSTD::forward&lt;_Args>(__args)...);
  ++__end_;
}

emplace_back 구현부를 보면 construct 함수에서 std::forward 를 사용하여 인자를 전달하는데 저 construct 함수는 이렇게 구현되어 있어.

template &lt;class _Tp, class... _Args>
static void construct(allocator_type&, _Tp* __p, _Args&&... __args) {
  ::new ((void*)__p) _Tp(_VSTD::forward&lt;_Args>(__args)...);
}

placement new를 이용하여 생성할 객체의 메모리 주소를 지정해주고, 실제 생성은 variadic template로 생성자에 가변 인자로 넣어주고 있어.

placement new는 c++98에 들어갔지만 variadic template는 c++11에야 비로소 개발된 기능이야. 따라서 저 가변 인자 기능으로 인해 현재 우리가 아는 emplace 로직이 구현될 수 있었던 거야.


- 결론
1) emplace는 c++11부터 적용된 멤버 추가 함수이다
2) 이를 사용하면 더미 객체의 복사 생성자+소멸자 호출을 줄일 수 있다
3) placement new와 variadic template를 사용하여 구현되어 있다


- 참고 문서
https://en.cppreference.com/w/cpp/language/new#Placement_new
https://en.cppreference.com/w/cpp/language/parameter_pack

#frogred8 #c++ #emplace #variadic #template