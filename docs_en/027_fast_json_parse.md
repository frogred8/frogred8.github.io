---
layout: page
title: "[javascript] JSON.parse is faster than object literals"
date: 2023-07-19
---

<pre>
When you have a large JSON object of about 8 MB, what is the fastest way to load it?
Usually, you might think of converting it into a literal and putting the object itself directly into the code.
At a glance, parsing a JSON file stored as a string seems like it would obviously cost more, right?

But if you actually measure the performance of a literal vs JSON.parse, JSON.parse can construct the object up to twice as fast. https://www.youtube.com/watch?v=ff4fgQxPaO0
In this post, I’ll summarize the explanation from the video for why that result happens, and briefly take a look at faster stringify as well.


- Content
First, let’s look at a bit of code.
// literal
const data = { foo: 42, bar: 1337, ... };
// JSON.parse
const data = JSON.parse('{"foo":42,"bar":1337,...}');

The top creates a literal object, and the bottom creates an object in real time from a string using JSON.parse.
But even looking at this again, it still seems like there should be no reason for JSON.parse to be faster, right? That is because we usually think in terms of compiled languages.

In a compiled language, if you create an object like that in code, it is parsed at compile time, serialized into the .data section according to the PE structure, and when the file runs, it is loaded into memory as-is and can be used immediately without much additional parsing.

But in an interpreted language like JavaScript, if you put that in the code and run the JS file, syntax analysis is performed token by token, which means broad parsing happens, much like JSON.parse.

Then if it is the same kind of parsing from a string anyway, why is there such a big speed difference? It is because the JavaScript parser has to prepare for many more situations than JSON.parse does.

- JavaScript parser
Suppose the parser has read up to here.

const x = 42;
const y = ({x}

At this point, the parser cannot predict what type of value will go into y. It has to keep reading until the parenthesis closes before it can know what meaning that syntax has.

const y = ({x});   // y = { x: 42 }
const y = ({x} = { x: 21 });  // y = { x: 21 }

In the first line, it creates an object using shorthand, and in the second line, it uses object destructuring.
In the end, because the JavaScript parser has to look at the full set of tokens before it can determine types or object structure, it has no choice but to try and resolve more information.

- JSON.parse
Now let’s look at JSON.parse.

const y = JSON.parse('{');

That will obviously throw an error. Since JSON.parse guarantees that something starting with '{' must be an object, it does not need to consider anything else. (If something is even a little off, it errors immediately.) 
So if the goal is simply to read an object into memory, JSON.parse is theoretically the fastest.

- Performance test
That explanation makes sense, but does it actually work? Since that material is from 2019, wouldn’t things be different now? I had that question, so I ran the benchmarking script published by Chrome.
https://github.com/GoogleChromeLabs/json-parse-benchmark

When you run the code, it saves a 7 MB object file separately as a literal and with JSON.stringify, and each file is structured like this.

// js.js
const data = [{"id":1,"method":"Inspector.enable"}...
// json.js
const data = JSON.parse("[{"id":1,"method":"Inspector.enable"}...

It measures the result of loading each one 100 times, and on an M1 it came out like this.

Benchmarking JS literal on node… 11.695s
Benchmarking JSON.parse on node… 7.631s (1.53x faster)

Strictly speaking, it should be loaded with V8, and I used Node instead. Also, maybe because the JavaScript parser keeps improving, it was not 2x like the video described, but the result was still clearly better.


- Faster stringify
While looking into JSON.parse, I also found some material about stringify optimization, so I’ll briefly introduce it.

Stringifying an object is simple. You can iterate over its child members and write them sequentially into a single string. But by adding a simple idea, you can make this feature several times faster. That idea is using a schema.

JSON.stringify is designed to calculate types and members in real time no matter what shape of object comes in. But what if you frequently need to stringify objects that always have the same schema?
It can be a good approach to optimize it by building a separate function like below.

// obj = {a:1, b:2};
function stringifyData(obj) {
  return '{"a":' + obj.a + ',"b":' + obj.b + '}';
}

But what if objects of multiple types need to be used? What if object parsing needs branching based on a specific type? The library that started from that idea is fast-json-stringify.
https://github.com/fastify/fast-json-stringify

I briefly brought over the usage example from the main text.

const schema = {
  type: 'object',
  properties: {
    nickname: {
      type: 'string'
    },
    mail: {
      type: 'string'
    }
  },
  required: ['mail']
}
const stringify = fastJson(schema);
const obj = {
  nickname: 'nick',
  mail: 'nick@gmail.com'
}
console.log(stringify(obj)) 
// '{"nickname":"nick","mail":"nick@gmail.com"}'

The actual performance test results are said to look like this. (higher faster)

JSON.stringify obj x 3,153,043 ops/sec
fast-json-stringify obj x 6,866,434 ops/sec
compile-json-stringify obj x 15,886,723 ops/sec
AJV Serialize obj x 8,969,043 ops/sec

compile-json-stringify is also a project that started from a similar idea, but its last update was in 2018, so fast-json-stringify is probably a little better in terms of stability and features.


- Conclusion
1) JSON.parse on a stringified object is faster than loading a literal object written in code
2) This is because literals require the parser to consider more cases
3) In a performance test with Node 18, JSON.parse was 1.5x faster
4) If you do a lot of stringify, keep an eye on fast-json-stringify

Previous post: https://frogred8.github.io/
#frogred8 #javascript #parse #stringify