---
layout: page
title: "[javascript] Using Symbol"
date: 2022-05-25
---

<pre>
This time, I brought along a small and cute little thing.

You've probably heard a lot about Symbol in JavaScript. Symbol is one of the seven primitive value types, and you can find a bit more detail in the MDN document below.
https://developer.mozilla.org/ko/docs/Glossary/Primitive

But in reality, many people have probably never used it, or do not even know it exists. Because I only knew about it too. Like some kind of unicorn... Below is the description of Symbol.
"Every Symbol value returned from Symbol() is unique. A Symbol value may be used as an identifier for object properties."

What does that mean... I get that it is a unique value, but where would I use it... Then, while looking through the v8 code this time, I realized something new, so I thought I would briefly share it.



This is the function that made me wonder.

// client.js
get [kPending] () {
  return this[kQueue].length - this[kPendingIdx]
}

The kPending value here was declared in the file below.

// symbol.js
module.exports = {
  kPending: Symbol('pending'),
  ...
}

What I wondered here was why they bothered doing it like that instead of just using "pending". If you do it that way, you cannot access it from anywhere else. Here is an example that shows why Symbol's nature can be hard to understand.

> var sb = Symbol('foo');
undefined
> var a={[sb]: 'bar'}
undefined
> a['foo']
undefined
> a[Symbol('foo')]
undefined
> a[sb]
'bar'

As you can see, the symbol foo declared inside a can only be accessed through the unique accessor sb. Because it is unique, even if you create a symbol with the same value, you cannot access it. This is where it clicked for me.

First of all, JavaScript has classes, but it does not have access modifiers. So no matter how much you try to hide something, it can eventually be accessed. So people who were thinking about how to make things private ended up using a method where they hide the accessor itself.

In files that have not been given that symbol.js file, you cannot access the getter function declared at the very beginning. Since the language does not have access modifiers, they create a separate unique accessor and use it to restrict access. Classy~ As expected, Google is god

JavaScript projects are usually small, and the bigger they get, the harder they become to maintain. This is a pretty advanced technique that you only really see in large-scale projects like Node, so I wanted to introduce it. With projects like this, when you look at them from far away, you just assume they run well, but the closer you look, the more there is to admire.

Conclusion)
1) Symbol is a primitive value with a unique value
2) Through this accessor, you can implement private access in a class
3) Praise Google


Writing things like this has been a good learning experience for me too, so if I explained anything incorrectly or if you have a different opinion, please feel free to leave a comment anytime. 

#javascript #symbol
