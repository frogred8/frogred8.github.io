---
layout: page
title: "[etc] Prime numbers: how far have you optimized them?"
date: 2022-08-29
---

<pre>
There’s been a lot of talk about coding tests lately, so I’ll analyze and share a prime-number problem I enjoyed solving a while back.

I don’t want to spoil anyone else’s intellectual fun, so if you want to try it yourself, you can solve it here. For reference, it took me 3 days, and it took quite a while to reach the final optimization step. That said, generator syntax shows up in the problem, so if you’re not familiar with it, it might be better to start from the lower-level problems and get used to it first.
https://www.codewars.com/kata/59122604e5bc240817000016


First, everyone knows what a prime number is, right? It’s a natural number divisible only by 1 and itself, and we usually use the Sieve of Eratosthenes.
When a number x is given, you try dividing it by 2,3,4,5,6.. and so on. In code, it looks like this.

function isPrime(x) {
  for (let i=2; i<x-1; i++) {
    if (x % i === 0) return false;
  }
  return true;
}

Using this code as the baseline, I’ll go through how we can optimize it to run faster and use less space.


1) Filter out even numbers
Suppose x is the prime number 10007. The loop checks it by running about 10,000 times. But even numbers are divisible by 2 anyway, so there’s no need to check them repeatedly, right? Then we can add a condition to check whether the number is even and skip the loop by twos. We can also change the starting point to 3. This cuts the total loop count roughly in half. (10000 -> 5000)

function isPrime(x) {
  if (x % 2 === 0) return false;
  for (let i=3; i<x-1; i+=2) {
    if (x % i === 0) return false;
  }
  return true;
}

2) Use the square root
I said a prime number is a number divisible only by 1 and itself. Conversely, if a number is not prime, that means a*b=x, so we only need to find the smaller one between a and b, right? And no matter how large a and b are, the smaller one won’t exceed the square root of the number. In the example above, 10007 has a square root of 100.03... If we drop the decimal part and calculate with 100, the loop count drops sharply from over 5000 to 50. (5000 -> 50)

function isPrime(x) {
  if (x % 2 === 0) return false;
  let sq = parseInt(Math.sqrt(x),10);
  for (let i=3; i<sq; i+=2) {
    if (x % i === 0) return false;
  }
  return true;
}

3) Apply caching
But we don’t want to calculate the same thing every time a request comes in, right? So we’ll precompute and cache it.

Forget the function we made earlier. We’re going to build a prime table up to 100 million. We allocate a global array variable called sieve, and record 1 in it when a number is not prime. The basic principle is the same as the Sieve of Eratosthenes. If i is 3, we mark 3,6,9.. in the sieve index as 1. If i is 5, we mark 5,10,15.. as 1.

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
let sieve = new Array(limit).fill(0);
for (let i=3; i<sq; i+=2) {
  for (let k=i*i; k<limit; k+=i) {
    sieve[k] = 1;
  }
}

With this, caching up to 100 million makes the total loop run about 390 million times. In the next step, we’ll reduce that a bit more.

4) cache - looping opt.
First, when i is 3, the part that checks every 3,6,9.. doesn’t need to mark cases where it’s multiplying by an even number, so we can make it check 3,9,15,21 by using k+=i*2. Also, the sequence of numbers marked when i is 3 and when i is 9 is the same, right? Then if the number itself has already been marked, we don’t need to continue from there. Let’s add a part that skips it if it isn’t prime.

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
let sieve = new Array(limit).fill(0);
for (let i=3; i<sq; i+=2) {
  if (sieve[i] === 1) continue;
  for (let k=i*i; k<limit; k+=i*2) {
    sieve[k] = 1;
  }
}

This optimization reduced the loop count from 390 million to 96 million. Execution time dropped to one quarter.

5) cache - memory opt.
The only information we store is 0 and 1, so instead of using 4-byte integers in an array, we’ll store it in bits. Then one number can hold 32 pieces of information, right? And if you think about it, we don’t need to store the even-number array at all. The caller can handle 2 and even numbers as exceptions in advance. Let’s reduce that part too. But if bit operations are mixed into the code, it looks unnecessarily complicated, so I’ll separate them into isPrime and setSieve functions.

function setSieve(num) {
  num = Math.floor(num / 2);
  let chunk = Math.floor(num / 32);
  let index = num % 32;
  sieve[chunk] |= 1 << index;
}

function isPrime(num) {
  if (num === 2) return true;
  if (num % 2 === 0) return false;
  num = Math.floor(num / 2);
  let chunk = Math.floor(num / 32);
  let index = num % 32;
  return (sieve[chunk] & (1 << index)) === 0;
}

const limit = 1_0000_0000;
const sq = parseInt(Math.sqrt(limit),10);
const length = limit / 32 / 2;
let sieve = new Array(length).fill(0);
for (let i=3; i<sq; i+=2) {
  if (!isPrime(i)) continue;
  for (let k=i*i; k<limit; k+=i*2) {
    setSieve(k);
  }
}

With this, the cache object that used to consume 400MB was reduced to 6.2MB.


If we optimize a little further from here, readability will suffer a bit, but it will be faster. For example, we could change the parts that calculate chunk and index into bit operations, or split out the cache-call version from isPrime and use that separately, and so on. (separating the 2 and even-number checks)
It’s not directly related to the problem, but as areas to expand on a bit more, it could be interesting to think about how to design things when the dynamically cached part grows even though we only used a static array here (memoization), or how to implement a requirement like finding the Nth prime number.

What made this problem fun was that even in real work, there are occasional cases where you convert a long flag array into bits to improve space efficiency, so I thought it was a pretty good problem. And the part where you had to clearly understand the requirements and constraints of the problem to solve it felt fresh too. For some reason, I get a bit tired when I see a coding-test problem with a full page of explanation. I think simple and free-form problems like this are good.

After writing this and reading through it again, I’m wondering if it was unnecessary since everyone could answer it after thinking for just a bit, but just read it casually on your way to work.

Previous post: https://frogred8.github.io/
#frogred8 #codetest #prime
</pre>
