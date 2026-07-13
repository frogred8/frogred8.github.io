---
layout: page
title: "[javascript] Analyzing the substr implementation"
date: 2022-05-01
---

<pre>
I just wanted to organize what I studied today.

First, I recently saw an interesting line in this document.
https://developer.mozilla.org/ko/docs/Web/JavaScript/Memory_Management

var s = 'azerty';
var s2 = s.substr(0, 3); // s2 is a new string
// Because strings are immutable values in JavaScript,
// it simply stores the [0, 3] range without allocating new memory.

Really? That is hard to believe.
Would there really be a need to manage it separately by storing only the indexes instead of simply copying it?
So I started by digging around on Google.

https://mrale.ph/blog/2016/11/23/making-less-dart-faster.html
After quite a bit of searching, I found this, and this guy had written it up in great detail. 
Looking only at the main points, in Dart, substring is implemented as a copy, while in JS, as the MDN guide says, it is implemented by storing two indexes. (Dart is a C-like language.)
So the performance difference is hundreds of times apart, and up to this point, that is an obvious result.

The reason I started looking into this in the first place was that if it only stores indexes, the ref count of the original string would go up, meaning the original string would not be freed. So I figured I would have to use it with that in mind, and I wondered, "If you use this without really knowing how it works, could things occasionally go wrong?" This article pointed out the exact same thing.

Counterintuitively obj above retains the whole 10Gb input string instead of a small 20 character token.
(Paradoxically, it keeps the 10 GB string instead of 20 characters - roughly what that means.)
The linked material about issues caused by this is also pretty interesting, so read it if you are interested. Now, getting back to the original purpose,

In the end, this is something you can only know by looking into the substring implementation, so I also downloaded V8 and followed that post, tracing through it one piece at a time. I was curious about the implementation itself, but I was also curious how the actual command reaches the implementation, so I started tracing backward. (If this part is boring, you can skip to the conclusion.)

Since I did not know much at first, I searched for SubString and found that it was declared like this in builtins-definitions.h.
TFC(StringSubstring, StringSubstring)
From this, I could tell that SubString is implemented as a V8 built-in function, and TFC means this. (TurboFan is the name of V8's optimizing engine.)
// TFC: Builtin in Turbofan, with CodeStub linkage and custom descriptor.

That StringSubstring keyword is connected to builtins-string-gen.cc and declared there.
TF_BUILTIN(StringSubstring, StringBuiltinsAssembler) {
  auto string = Parameter&lt;String>(Descriptor::kString);
  auto from = UncheckedParameter&lt;IntPtrT>(Descriptor::kFrom);
  auto to = UncheckedParameter&lt;IntPtrT>(Descriptor::kTo);
  Return(SubString(string, from, to));
}

I thought, "So this is where the main SubString function appears." But there was still a long way to go.
That TF_BUILTIN macro connects StringSubstring, which is designated as a built-in function, to StringBuiltinsAssembler::SubString. So if you follow that function (SubString), you can see that it calls a runtime function again.

  // Fall back to a runtime call.
  BIND(&runtime);
  {
    var_result =
        CAST(CallRuntime(Runtime::kStringSubstring, NoContextConstant(), string, SmiTag(from), SmiTag(to)));
    Goto(&end);
  }

When it is called with that kStringSubstring value, it searches the intrinsic functions registered in runtime.h and calls the function connected to that enum. The function is registered with a macro in runtime-strings.cc, and only now did I find the NewSubString function connected to the implementation.

RUNTIME_FUNCTION(Runtime_StringSubstring) {
  ...
  return *isolate->factory()->NewSubString(string, start, end);
}

The implementation is in factory.cc, and the most important implementation function is this: Factory::NewProperSubString()
After analyzing the code, I saw that there were various tuning details inside as well. It was interesting that when creating a substring shorter than 13 characters, it uses copying instead of two indexes. I guess it was implemented that way because the cost of copying a small string is not very high. 
Anyway, there I could see the behavior I had been looking for all this time.

  slice.set_length(length);
  slice.set_parent(*str);
  slice.set_offset(offset);

It connects the original string, sets offset to the starting position of the slice, and changes length not to the length of the original string it holds, but to the end - begin value.
That slice object is an instance of the SlicedString class, and besides this, there are a lot of string classes depending on the use case. ConsString, ThinString... Seeing these small optimizations come together, I can understand how V8 became such a good engine.

The analysis was done, but earlier I had seen this comment in the string header.

// Currently missing features are:
//  - truncating sliced string to enable otherwise unneeded parent to be GC'ed.
The V8 development team also knows that keeping the entire long string is a problem, so they wrote this feature for GC'ing everything except the sliced string as a todo. But since it is still a missing feature, I guess it is not easy to solve.

I thought about it briefly too. Maybe every time a sliced string is accessed, it could check the ref count, and if only one sliced string is connected, copy the sliced string and release the original string.
But 1. checking this in the leap func would be too excessive, and 2. having string copying happen during a get operation at an unpredictable time (what if it is huge...) also leaves a bad aftertaste... I get the feeling that the Google folks do not really have a clear answer either, so they are leaving it for now.

Conclusion)
1. JS's substring keeps a pointer to the original string and stores only two indexes for use.
2. If the number of sliced characters is less than 13, it just copies and uses it.
3. If the original string is excessively long, it is better to slice it with substring and then copy it before using it.

I had no idea that a question that started from one line on MDN would turn into such a long journey, but anyway, as long as I had fun, that is enough.
To be honest, I could have just understood it by myself and moved on, but since today's topic was a bit complicated, I wanted to write it somewhere as a way to organize my thoughts.
If I feel inspired again next time, I will write another one.
