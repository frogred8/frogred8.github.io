---
layout: page
title: "[c++] std::string에서 짧은 문자열은 어떻게 생성되는가 (SSO)"
---

## [c++] std::string에서 짧은 문자열은 어떻게 생성되는가 (SSO)

<pre>

이전에 malloc을 분석하면서 gcc의 libstdc++ 코드를 살펴보게 되었는데 std::string 객체에 SSO가 있는걸 보고 여러 라이브러리의 구현부에 대해 분석한 내용을 공유해볼까 해.

- 개요
일반적으로 string 객체는 문자열을 받으면 그 크기만큼 heap을 할당하고 문자열을 복사하는 동작을 하게 돼.
여기서 small string optimization (이하 SSO) 이라고 불리는 기법이 적용되는데 아이디어는 간단해.
저장할 문자열의 길이가 특정 threshold 값보다 작으면 내부 array에, 그보다 크면 기존처럼 heap을 할당해서 사용하는 최적화 방식이야.

자세한 설명은 이 포스팅을 참고하면 되고 간단히 구현부터 해볼게.
https://github.com/elliotgoodrich/SSO-23


- SSO의 일반적인 구현
일단 기본적인 string 구조체를 의사 코드로 작성해보면 대충 이런 모습이 될거야.

class string {
  char* data;
  size_type capacity;
  size_type size;
};

heap이 할당될 data 포인터 변수와 문자열 길이를 알려주는 size, 할당된 heap의 크기를 저장하는 capacity 값을 선언했어.
이 구조에서 길이 15이하의 문자열에 SSO를 적용시키면 이런 데이터 구조가 나올테고.

class string {
  enum { MAX_SSO_SIZE = 15 };
  char* data;
  int capacity;
  int size;
  char sso_str[MAX_SSO_SIZE + 1];
}

근데 이러면 조건에 따라 사용하지 않는 변수가 있어서 괜한 용량 낭비가 되는데 이를 union으로 묶는게 핵심 아이디어야.

class string {
  enum { MAX_SSO_SIZE = 15 };
  union {
    struct {
      char* data;
      int capacity;
    };
    char sso_str[MAX_SSO_SIZE + 1];
  }
  int size;
}

기존에 28byte였던 구조체를 union으로 묶어서 20byte로 줄었어. 이 데이터 구조를 실제 로직에 적용시키려면 대입하던 부분도 분기문으로 바꿔줘야겠지?

void string::assign(const char* str) {
  if (strlen(str) <= MAX_SSO_SIZE) {
    strcpy(sso_str, str);
  } else {
    data = (char*)malloc(strlen(str) + 1);
    strcpy(data, str);
  }
  ...
}

assign 부분 외에 getter도 바꿔줘야 할거고..

const char* string::c_str() {
  if (size <= MAX_SSO_SIZE) {
    return sso_str;
  }
  return data;
}


- 실제 적용된 SSO 로직
위에서는 의사 코드로만 간단히 구성해봤는데 실제로 적용한 라이브러리들은 구현 방법이 꽤나 다양해. 4가지의 string 라이브러리를 볼건데 gcc, llvm, facebook, bloomberg 에서 SSO 구현한 부분을 살펴볼게.


1. libstdc++ (gcc)
https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/basic_string.h#L215
메모리 할당자를 바꿀 수 있는 _Alloc_hider 구조체를 사용하는데 실제 할당받은 메모리는 _M_dataplus._M_p 포인터에 저장돼.
그리고 char, wchar에 따라 _S_local_capacity enum값이 정해지는데 이 길이만큼 union에 로컬 버퍼가 정해지는걸 확인할 수 있어. (char는 15, wchar는 7)

class basic_string {
  struct _Alloc_hider : allocator_type
  {
	  pointer _M_p; // The actual data.
  };
  _Alloc_hider _M_dataplus;
  size_type _M_string_length;

  enum { _S_local_capacity = 15 / sizeof(_CharT) };

  union
  {
    _CharT _M_local_buf[_S_local_capacity + 1];
    size_type _M_allocated_capacity;
  };
}

문자열이 할당될 때 size랑 _S_local_capacity를 비교해서 범위 안이면 _M_data 함수로 _M_local_buf 포인터를 설정하고, 그 이상이면 allocator로 할당하고 있어.

void _M_data(pointer __p) 
{ 
  _M_dataplus._M_p = __p; 
}
basic_string& assign(const basic_string& __str)
{
  if (__str.size() <= _S_local_capacity)
  {
    _M_destroy(_M_allocated_capacity);
    _M_data(_M_use_local_data());
    _M_set_length(0);
  }
  else
  {
    const auto __len = __str.size();
    auto __alloc = __str._M_get_allocator();
    auto __ptr = _Alloc_traits::allocate(__alloc, __len + 1);
    _M_destroy(_M_allocated_capacity);
    _M_data(__ptr);
    _M_capacity(__len);
    _M_set_length(__len);
  }
  std::__alloc_on_copy(_M_get_allocator(), __str._M_get_allocator());
}

그리고 내가 지금 _M_local_buf 를 사용중인지 확인해서 그 모드에 따라 분기해서 사용해.

bool _M_is_local() 
{ 
  return _M_data() == _M_local_data();
}
size_type capacity()
{
  return _M_is_local() ? size_type(_S_local_capacity) : _M_allocated_capacity;
}


2. libc++ (llvm)
https://github.com/llvm-mirror/libcxx/blob/master/include/string#L723
long, short 두 가지 구조체를 지정하고 이를 union으로 묶어서 SSO 여부에 따라 다르게 접근하는 방식이야.
여기서는 __rep 구조체를 첫번째 값으로 가진 __r_ 멤버 변수가 실제 값을 가지고 있어.
실제 값으로의 접근은 __r_.first().__l.__data_ 로 가능해.
여긴 함수도 재밌으니 거기까지 잠깐 볼게.

class basic_string {
  struct __long
  {
    size_type __cap_;
    size_type __size_;
    pointer   __data_;
  };

  enum {__min_cap = (sizeof(__long) - 1)/sizeof(value_type)};

  struct __short
  {
    union
    {
      unsigned char __size_;
      value_type __lx;
    };
    value_type __data_[__min_cap];
  };

  struct __raw
  {
    size_type __words[__n_words];
  };

  struct __rep
  {
    union
    {
      __long  __l;
      __short __s;
      __raw   __r;
    };
  };

  __compressed_pair<__rep, allocator_type> __r_;
}

아래는 모두 basic_string 함수들인데 init 함수를 보면 요청한 __reserve 값이 __min_cap보다 작으면 short 모드로, 아닐 경우엔 long 모드로 생성하게 돼. 
이를 바탕으로 다른 함수들에서는 __is_long() 여부로 읽어들일 값을 분기해서 반환하게 되는데 이 함수가 참 재미있어.

void basic_string::__init(const value_type* __s, size_type __sz, size_type __reserve)
{
  pointer __p;
  if (__reserve < __min_cap)
  {
    __set_short_size(__sz);
    __p = __get_short_pointer();
  }
  else
  {
    size_type __cap = __recommend(__reserve);
    __p = __alloc_traits::allocate(__alloc(), __cap+1);
    __set_long_pointer(__p);
    __set_long_cap(__cap+1);
    __set_long_size(__sz);
  }
  ...
}

size_type basic_string::size()
{
  return __is_long() ? __get_long_size() : __get_short_size();
}
size_type basic_string::__get_long_size() { return __r_.first().__l.__size_; }
size_type basic_string::__get_short_size() { return __r_.first().__s.__size_; }
bool __is_long() { return bool(__r_.first().__s.__size_ & __short_mask); }

__is_long 함수는 __s.__size_와 __short_mask를 비트 연산한 값에 따라 참/거짓 여부가 결정되는데 저 __s.__size_를 잘 봐야해.
난 처음에 짧은 문자열이 설정되면 저기에 뭔가 설정할 줄 알고 온갖 곳을 다 뒤졌는데도 안나와서 헤멨는데, 알고 보니 긴 문자열이 설정될 때 tricky한 설정이 있더라고.

void __set_long_cap(size_type __s) 
{ 
  __r_.first().__l.__cap_  = __long_mask | __s; 
}
size_type __get_long_cap() 
{
  return __r_.first().__l.__cap_ & size_type(~__long_mask); 
}

여기 보면 __l.__cap_ 할당 시에 __long_mask를 비트 연산으로 더해서 설정하는게 보일거야. 그리고 getter에서는 반대로 해당 비트를 빼주는 연산을 하게 되고.
그럼 왜 __is_long에서는 __s.__size_를 사용하냐면 union으로 __s, __l 이 동일한 메모리 주소를 사용 중이지? 거기서 구조체 순서를 잘보면 __s.__size_ 의 메모리 위치가 바로 __l.__cap_ 와 매칭돼.

따라서 __s.__size_ & __short_mask == __l.__cap_ & __long_mask 이 성립하면서 동일한 결과가 나오는거야. (근데 __cap_에 마스크를 설정했으면서 갑자기 다른 구조체 멤버 변수로 검사하는건 좀 그렇긴 하다..)

이렇게 자세히 설명한 이유는 다음에 볼 라이브러리도 이와 동일한 기법을 사용하기 때문이야.


3. folly (facebook open source library)
https://github.com/facebook/folly/blob/main/folly/FBString.h#L572
이번엔 facebook에서 공개한 라이브러리야.

class fbstring_core {
  struct MediumLarge {
    Char* data_;
    size_t size_;
    size_t capacity_;

    size_t capacity() const {
      return kIsLittleEndian ? capacity_ & capacityExtractMask : capacity_ >> 2;
    }

    void setCapacity(size_t cap, Category cat) {
      capacity_ = kIsLittleEndian
        ? cap | cat << kCategoryShift)
        : (cap << 2) | cat;
    }
  };

  union {
    uint8_t bytes_[sizeof(MediumLarge)]; // For accessing the last byte.
    Char small_[sizeof(MediumLarge) / sizeof(Char)];
    MediumLarge ml_;
  };
}

여기서는 bytes_, small_, ml_ 세 가지 타입으로 union을 구성했어.
libc++과 비슷하게 capacity_를 설정할 때 마스크를 넣고, 가져올 때 제거하는 모습을 볼 수 있어.
근데 bytes_는 어디서 사용하나 했더니 category 함수에서 capacity_ 변수의 마스크 위치와 같은 메모리 주소인 bytes_[lastChar] 값으로 타입 분기를 하더라고. 
mutableData가 해당 분기문을 사용한 함수야.

enum class Category : category_type {
  isSmall = 0,
  isMedium = kIsLittleEndian ? 0x80 : 0x2,
  isLarge = kIsLittleEndian ? 0x40 : 0x1,
};

Category category() const {
  size_t lastChar = sizeof(MediumLarge) - 1;
  return bytes_[lastChar] & categoryExtractMask;
}

Char* mutableData() {
  switch (category()) {
    case Category::isSmall:
      return small_;
    case Category::isMedium:
      return ml_.data_;
    case Category::isLarge:
      return mutableDataLarge();
  }
  folly::assume_unreachable();
}


4. BDE (bloomberg)
https://github.com/bloomberg/bde/blob/master/groups/bsl/bslstl/bslstl_string.h#L915
해외 언론 매체인 거기 맞아. 뜬금 블룸버그.
3개월 전까지도 꽤 많은 작업 기록이 남아있어서 버려진 repo도 아니니 한번 가져와 봤어.

class String_Imp {
  enum ShortBufferConstraints {
    SHORT_BUFFER_MIN_BYTES  = 20, 
    SHORT_BUFFER_LENGTH     = SHORT_BUFFER_BYTES / sizeof(CHAR_TYPE),
    SHORT_BUFFER_CAPACITY   = SHORT_BUFFER_LENGTH - 1
  };

  union {
    bsls::AlignedBuffer<SHORT_BUFFER_BYTES, char> d_short;     
    CHAR_TYPE *d_start_p;
  };
}

실제 구현부에서는 isShortString 함수의 결과로 분기해서 사용하고 있어.
여기서는 간단하게 capacity가 기본값인지 보고 확인하는데 이렇게 하는게 확장성만 좀 떨어지고 실행 속도와 특히 가독성이 월등히 좋아서 개인적으로는 이런게 더 좋더라.
괜히 확장성 생각하며 카테고리까지 나누는건 좀 오버엔지니어링이라는 느낌.

bool String_Imp<CHAR_TYPE, SIZE_TYPE>::isShortString() const
{
    return d_capacity == this->SHORT_BUFFER_CAPACITY;
}

CHAR_TYPE *String_Imp<CHAR_TYPE, SIZE_TYPE>::dataPtr()
{
    return isShortString() ? d_short.buffer() : d_start_p;
}


결론)
1) 짧은 문자열은 string 라이브러리에서 SSO를 통해 별도로 처리된다.
2) 최초 아이디어는 같지만 설계 철학에 따라 라이브러리마다 최종 구현부가 미묘하게 다르다.
3) 잘 읽히지 않는게 정상.

이렇게까지 길게 쓸 생각은 아니었는데 어차피 볼 사람만 보겠지 싶어서 그냥 둘게.
가뜩이나 가독성이 안좋은데 코드가 지나치게 많은 감이 있어서 다음에는 말로만 할 수 있는걸 좀 써볼까 싶네.

이전글: https://frogred8.github.io/
#frogred8 #c++ #small_string_optimization
