---
layout: page
title: "[c++] Why you don't need to specify the size when freeing memory"
date: 2022-12-17
---

<pre>
- Overview
A little while ago, I read a post on Twitter that roughly said something like this.
It said, "malloc takes the allocation size as an argument, but free only takes a pointer. The reason it does not need the size is that there is a lookup table that stores the size for each pointer."
https://twitter.com/sanxiyn/status/1558719967398223872

I had used memory allocation/deallocation behavior, but I had never actually looked at the implementation, so that claim sounded pretty plausible.
So I analyzed the implementation of the memory allocation part in my own way and ran some tests, and this is a summary of that.
That said, there are many areas where my knowledge is shallow, so if anything is wrong, please feel free to give me feedback anytime.

- msvc analysis
Since memory debugging is generally easier on Windows, I tried msvc first. The malloc implementation is part of the CRT library, so the code is public.
Originally it was under p~files/vc/crt/src, but it was not there in msvc2022. After looking into it, I found that since the 2015 version, you have to separately select and install the "Universal CRT SDK" package when installing msvc for it to appear under p~files/Windows Kits/10.

When I went to source/10.0.19041.0/ucrt under that folder, the actual Universal CRT implementation was there.
stdio, stdlib, heap, string, and so on..
The actual malloc implementation is in heap/malloc_base.cpp, and I shortened it roughly like this.

void* __cdecl _malloc_base(size_t const size)
{
  void* const block = HeapAlloc(__acrt_heap, 0, size);
  return block;
}

It calls the HeapAlloc function again, but that is only declared in heapapi.h, and I could not see the implementation.
I vaguely heard that Microsoft MVPs can see internal code like this too, but of course I am not one..
I do not know if there is another way, but in any case I could not see the msvc implementation, so I decided to infer it through tests.


- msvc test
It is annoying if the starting address changes every time you run it, so if you turn off the Linker - Advanced - Randomized Base Address option in the project settings, it comes out at the same address, which is convenient. Of course, dynamically allocated memory is different every time.

The test code was like this.

int main()
{
  volatile int* a = (int*)malloc(0x1f00 * 4);  // 31kb
  a[0] = 0xeeeeeeee;
  a[1] = 0x89abcdef;
  a[0x3cccb] = (int)rand();
  printf("%d, %d\n", a[1], a[0x3cccb]);
  free(a);
}

I used the volatile directive so it would not be optimized away even in release mode, and just in case, I also inserted a random value and printed it. (Compilers these days are so smart..)

When I tried it in debug mode, various pieces of information were added before the allocated address. Things like the number of times memory had been allocated since the program started, the memory size, the instruction address that requested the allocation, and so on.
But what I actually wanted to see was the information recorded during malloc, so I tried release mode. No matter how many times I changed things, there was nothing near the memory address that looked like memory size information.
So I was a bit disappointed, but when I changed the allocation size to something larger, a new value appeared.
So this is what I inferred from that result.


- So how does memory allocation work?
First of all, memory allocation is a very frequent operation.
Because of that, each compiler or OS uses various strategies to minimize allocation overhead. A representative approach is to organize memory into fixed-size chunks and return the corresponding chunk address when allocating memory.
This method is not space-efficient because it always allocates one chunk even if the requested size is small, but it has the advantage that deallocation costs almost nothing and there is no memory fragmentation. And contiguous memory itself also has the additional benefit of cache hits.

A more advanced method than this is to, when a size larger than a chunk is requested, combine it with the next chunk and return that. It is fine when allocating, but it has the disadvantage that the cost of splitting the combined chunks during deallocation becomes expensive. Of course, memory fragmentation is also a problem.

Naturally, these methods do not need the size during deallocation. That is because even if you return several combined chunks, the size comes out immediately if you subtract from the next_chunk address value in the linked list.
The small memory allocations I initially tested in msvc probably did not show a size value because the size could be calculated backward like that.

But that method has the limitation that allocating large memory is difficult. So I tested while steadily increasing the allocation size, and sure enough, once 520184 bytes, about 507 KB or more, were allocated, the algorithm changed. From that point on, several values existed before the allocated memory address, and I could obtain a value there that seemed to be the size.

More precisely, it was the value written at allocated address - 16, and the results from four tests were as follows.

(allocation size) -> (address - 16 value)
 0x7eff8 -> 0x80000
0x13b330 -> 0x13c000
0x13c3b8 -> 0x13d000
0x173330 -> 0x174000

From this, I could tell that it stores the requested size rounded up to 4 KB.
In the end, the free function is probably reading and using the structure information placed before the allocated address.
(All of this is just my speculation.)


- Thoughts
In fact, since the implementation is not public in msvc, I worked hard analyzing the malloc part of glibc. But because it has so many optimizations for different conditions, there are all kinds of bit operations, many conditionals, and an enormous amount of related code, so I ended up only analyzing the broad outline.
If you want to take a look, you can get glibc from GitHub and look at the __libc_malloc() function in the malloc.c file.
The malloc function is connected like this.

strong_alias (__libc_malloc, __malloc) strong_alias (__libc_malloc, malloc)

And while searching because I was curious about the garbage values in allocated memory, I found this link, and it explains the memory structure well. (If I had seen this earlier, I would have wasted less effort..)
https://www.nobugs.org/developer/win32/debug_crt_heap.html

The newly allocated memory (0xCD) is Clean memory.
The free()d memory (0xDD) is Dead memory.
The guard bytes (0xFD) are like Fences around your memory.


Conclusion)
1) Memory allocation methods differ by OS and compiler, and in particular they have evolved to use different methods depending on the allocation size.
2) Small amounts of memory usually use a chunk method organized as a linked list.
3) For large amounts of memory, structure information that describes the memory exists at the front, and this value is used to find out the size to deallocate.
4) The paradigm can change at any time, so take this only as a reference.

Previous post: https://frogred8.github.io/
#frogred8 #c++ #memory #allocation
