---
layout: page
title: "[c++] Analyzing the implementation of emplace"
date: 2023-05-13
---

<pre>
The emplace feature newly added in C++11 is something you've probably heard of and used quite a bit. This post started from the question: why didn't we have such a useful feature before?

When adding an element to a vector, you usually use push_back.

vector&lt;Car> cars;
cars.push_back(Car('tico', 4));

But writing it this way is inefficient. That's because when an element is added to the vector, the temporary object's copy constructor and destructor are called. So in the past, people sometimes inserted only pointers so the constructor would be called just once.

vector&lt;Car*> cars;
cars.push_back(new Car('tico', 4));

Usually, memory creation and deletion were hidden by wrapping insert and delete in methods inside the object that manages the vector, or this approach was used together with a memory pool.

Now, coming back to the present and using emplace, when adding an element it constructs the object directly at the last memory address, so compared to the old push_back approach, it has the advantage that the copy constructor and destructor are not called. You just pass the constructor arguments in order like this.

vector&lt;Car> cars;
cars.emplace_back('tico', 4);


- Implementation analysis
The definitions in gcc were complicated, so I brought over the boost code instead. The structure is the same anyway.

template &lt;class... _Args>
void __split_buffer::emplace_back(_Args&&... __args)
{
  if (__end_ == __end_cap()) {
    // Roughly, code that increases memory and copies elements
  }
  __alloc_traits::construct(__alloc(), _VSTD::__to_address(__end_), _VSTD::forward&lt;_Args>(__args)...);
  ++__end_;
}

If you look at the implementation of emplace_back, it passes the allocator, pointer, and variadic arguments through std::forward to the construct function. That construct function is implemented like this.

template &lt;class _Tp, class... _Args>
static void construct(allocator_type&, _Tp* __p, _Args&&... __args) {
  ::new ((void*)__p) _Tp(_VSTD::forward&lt;_Args>(__args)...);
}

Using placement new, it specifies the memory address of the object to be created, and the actual construction passes variadic arguments to the constructor through a variadic template.

placement new was introduced in C++98, but variadic templates were only developed in C++11. Therefore, because of that variadic argument feature, the emplace logic we know today could be implemented.


- Conclusion
1) emplace is an element-insertion function introduced in C++11
2) Using it can reduce calls to the temporary object's copy constructor and destructor
3) It is implemented using placement new and variadic templates


- References
https://en.cppreference.com/w/cpp/language/new#Placement_new
https://en.cppreference.com/w/cpp/language/parameter_pack

#frogred8 #c++ #emplace #variadic #template