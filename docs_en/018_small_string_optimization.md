---
layout: page
title: "[c++] How are short strings created in std::string? (SSO)"
date: 2022-12-31
---

<pre>
While previously analyzing malloc, I ended up looking through gcc's libstdc++ code, and when I saw that std::string objects use SSO, I thought I would share what I found while analyzing the implementations in several libraries.

- Overview
In general, when a string object receives a string, it allocates heap memory equal to that size and copies the string into it.
This is where a technique called small string optimization (SSO from here on) is applied, and the idea is simple.
If the length of the string to store is smaller than a certain threshold, it is stored in an internal array; if it is larger, heap memory is allocated and used as before.

For a more detailed explanation, refer to this post. I'll start with a simple implementation.
https://github.com/elliotgoodrich/SSO-23


- General implementation of SSO
First, if we write a basic string structure in pseudocode, it would look roughly like this.

class string {
  char* data;
  size_type capacity;
  size_type size;
};

I declared a data pointer variable where the heap allocation will be stored, size, which tells us the string length, and capacity, which stores the size of the allocated heap.
If SSO is applied to strings of length 15 or less in this structure, the data structure would look like this.

class string {
  enum { MAX_SSO_SIZE = 15 };
  char* data;
  int capacity;
  int size;
  char sso_str[MAX_SSO_SIZE + 1];
}

But then, depending on the condition, there are variables that are not used, which wastes space unnecessarily. The key idea is to wrap those in a union.

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

The structure that was previously 28 bytes was reduced to 20 bytes by wrapping it in a union. To apply this data structure to the actual logic, the assignment part also needs to be changed to branch on the condition, right?

void string::assign(const char* str) {
  if (strlen(str) <= MAX_SSO_SIZE) {
    strcpy(sso_str, str);
  } else {
    data = (char*)malloc(strlen(str) + 1);
    strcpy(data, str);
  }
  ...
}

Other than assign, the getter also needs to be changed..

const char* string::c_str() {
  if (size <= MAX_SSO_SIZE) {
    return sso_str;
  }
  return data;
}


- SSO logic applied in practice
Above, I put together a simple version in pseudocode, but libraries that actually apply it implement it in quite a variety of ways. We'll look at four string libraries and examine the parts where gcc, llvm, facebook, and bloomberg implement SSO.


1. libstdc++ (gcc)
https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/bits/basic_string.h#L215
It uses an _Alloc_hider structure that allows the memory allocator to be changed, and the memory actually allocated is stored in the _M_dataplus._M_p pointer.
Also, depending on char and wchar, the _S_local_capacity enum value is determined, and you can see that a local buffer of that length is defined in the union. (15 for char, 7 for wchar)

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

When a string is assigned, it compares size with _S_local_capacity. If it is within range, it sets the _M_local_buf pointer through the _M_data function; if it is larger, it allocates through the allocator.

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

Then it checks whether _M_local_buf is currently being used and branches based on that mode.

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
This approach defines two structures, long and short, wraps them in a union, and accesses them differently depending on whether SSO is being used.
Here, the __r_ member variable, whose first value is the __rep structure, holds the actual value.
The actual value can be accessed with __r_.first().__l.__data_.
The functions here are interesting too, so I'll take a quick look at those as well.

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

The code below is all basic_string functions. If you look at the init function, when the requested __reserve value is smaller than __min_cap, it is created in short mode; otherwise, it is created in long mode. 
Based on that, other functions branch on whether __is_long() is true and return the corresponding value, and this function is quite interesting.

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

The __is_long function determines true/false based on the result of a bit operation between __s.__size_ and __short_mask, and you need to look closely at that __s.__size_.
At first, I thought something would be set there when a short string was configured, so I dug through all kinds of places and still couldn't find it. It turned out there is a tricky setting when a long string is configured.

void __set_long_cap(size_type __s) 
{ 
  __r_.first().__l.__cap_  = __long_mask | __s; 
}
size_type __get_long_cap() 
{
  return __r_.first().__l.__cap_ & size_type(~__long_mask); 
}

Here, you can see that when assigning __l.__cap_, __long_mask is added through a bit operation. Then, in the getter, the opposite operation removes that bit.
So why does __is_long use __s.__size_? Since __s and __l are in a union, they use the same memory address, right? If you look closely at the order of the structures there, the memory location of __s.__size_ matches exactly with __l.__cap_.

Therefore, __s.__size_ & __short_mask == __l.__cap_ & __long_mask holds, producing the same result. (But setting the mask on __cap_ and then suddenly checking it through a member variable of a different structure does feel a bit questionable..)

The reason I explained this in such detail is that the next library we'll look at uses the same technique.


3. folly (facebook open source library)
https://github.com/facebook/folly/blob/main/folly/FBString.h#L572
This time, it's a library released by facebook.

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

Here, the union is made up of three types: bytes_, small_, and ml_.
Similar to libc++, you can see that a mask is added when setting capacity_ and removed when retrieving it.
I wondered where bytes_ was used, and it turned out that in the category function, it branches on the type using the value of bytes_[lastChar], which is at the same memory address as the mask position in the capacity_ variable. 
mutableData is a function that uses that branch.

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
Yes, that Bloomberg, the foreign media company. Randomly, Bloomberg.
There were still quite a lot of work records from up to three months ago, so it isn't an abandoned repo, which is why I brought it in.

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

In the actual implementation, it branches based on the result of the isShortString function.
Here, it simply checks whether capacity is the default value. This is a bit less extensible, but it is far better in execution speed and especially readability, so personally I prefer this kind of approach.
Thinking too much about extensibility and splitting it all the way into categories feels a bit like overengineering.

bool String_Imp<CHAR_TYPE, SIZE_TYPE>::isShortString() const
{
    return d_capacity == this->SHORT_BUFFER_CAPACITY;
}

CHAR_TYPE *String_Imp<CHAR_TYPE, SIZE_TYPE>::dataPtr()
{
    return isShortString() ? d_short.buffer() : d_start_p;
}


Conclusion)
1) Short strings are handled separately through SSO in string libraries.
2) The initial idea is the same, but the final implementation differs subtly from library to library depending on design philosophy.
3) It is normal for this to be hard to read.

I didn't intend to write this much, but I figure only the people who want to read it will read it anyway, so I'll leave it as is.
The readability is already pretty bad, and there may be too much code, so next time I might write something that can be explained mostly in words.

Previous post: https://frogred8.github.io/
#frogred8 #c++ #small_string_optimization
</pre>
