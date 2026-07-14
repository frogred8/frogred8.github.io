---
layout: page
title: "[go] Analyzing the string.repeat implementation"
date: 2023-03-11
---

<pre>
I was looking through Go implementations recently and found the implementation of string.repeat interesting, so I analyzed it and compared it with repeat implementations in other languages as well. (JavaScript, Rust)


- Overview
What first caught my eye was an unusually long paragraph of comments in the strings.go file.
It mentioned things like the CPU D-cache and L1 cache, which I found interesting. Here is the link.
https://github.com/golang/go/blob/master/src/strings/strings.go#L565


- Basics
If you were to implement a string.repeat function, you would probably think of something like this.

function repeat(s, n) {
  let ret = '';
  for (let i=0; i&lt;n; i++) {
    ret += s;
  }
  return ret;
}

This is the common approach of adding the target string s n times.
But what if n is one thousand, or ten thousand?


- Common optimization
First, you would want to prevent frequent reallocations as the string buffer grows, right?
Let's preallocate the buffer to the full size of the string that needs to be returned,
and use doubling, where we append the string that was previously copied.
Since JavaScript does not support preallocating the string buffer size, I wrote it in Go.

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

Go syntax is C-like, so there is not much to explain, but let's look at just this one thing.
b.String()[:chunk] means a substr operation that returns the value from [start:end] in string b.
Here, since start is omitted, it means to return the value sliced up to chunk.
It is very similar to Python strings. (though there is no step...)

If you pass 'ab' and 10 to the function and print the values in the for loop, you can see that it doubles like this.
abab
abababab
abababababababab
abababababababababab

Before optimization, it has O(n) complexity, but after the improvement it is reduced to O(log n).
repeat(100) takes 7 iterations, and 10000 takes 14...


- Go's optimization
strings.go goes a little further from here.
It sets the maximum size of the string being appended to 8 KB or less, taking CPU-level cache into account.

I briefly covered this topic in an earlier post: https://frogred8.github.io/docs/014_cache_line
CPUs have L1 through L3 caches, and usually L1 and L2 are cache memory allocated per core.
Because these caches are small, when a cache loss occurs, the CPU has to go to L3, and if the data is not there either, it has to go all the way to memory to fetch it.
(For reference, the L1 cache size by CPU is 80 KB on the 13900K P-core, 96 KB on the E-core, and 64 KB on the AMD 7950X.)

The Go developers addressed the sharp slowdown that happens when copying excessively large strings at once by reducing CPU cache misses.
They limited the length of the string copied at once to 8 KB, so that L1-L2 level cache losses would be avoided as much as possible.
According to the comment, they achieved up to about a 100% performance improvement when copying strings larger than the L2 cache size.

Below is the final completed code after going through this process. (I left out common guard handling and similar parts.)

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


- What about JavaScript?
Looking at Node.js (V8), it was implemented like this.

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

However, in 2017, there was an improvement effort to port the function that had been implemented in JS to CSA (Code Stub Assembler).
https://chromium-review.googlesource.com/c/v8/v8/+/659097

In 2019, it was ported again from CSA to a Torque script, so the Torque version is what is used now. The logic is almost the same.
https://chromium-review.googlesource.com/c/v8/v8/+/1524640


- Rust implementation
Rust also copies the string while doubling it in a similar way, but here it is a little different because additional logic was added to append the remainder separately. It seems they thought it was better to pull that out separately rather than checking it on every loop iteration.
https://github.com/rust-lang/rust/blob/master/library/alloc/src/slice.rs#L489


- Conclusion
1) Go's strings.repeat is optimized with the CPU cache in mind
2) JavaScript and Rust are implemented similarly, but if the string being copied is excessively long, they will probably run slower than Go
3) The end of tuning always looks similar


#frogred8 #go #javascript
</pre>
