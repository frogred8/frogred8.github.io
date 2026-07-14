---
layout: page
title: "[etc] branch predictors and the spectre vulnerability"
date: 2023-10-27

---

<pre>
Recently, I studied some topics related to CPU-level branch predictors, even though they have nothing to do with my actual work. As I moved past the theory and got into deeper material, I also came across the parts connected to Spectre attacks, so I thought I would introduce them together.

To be honest, I had been putting this off because there are limits to organizing it only in text. But when I thought about it, even organizing it in a way that at least I can understand seemed more meaningful than not doing it at all, so I decided to start. I do not know it perfectly either, but if there is anything you do not understand, ask me and I will answer as best I can.


- Overview
Spectre is a vulnerability disclosed in January 2018 together with Meltdown. In short, it is a vulnerability that provides a way to access arbitrary addresses inside a program by using memory addresses stored during branch prediction.

This post is based on chapter 1, CPU performance, from the YouTube link below, with additional information gathered from various places.
https://www.youtube.com/playlist?list=PLAwxTw4SYaPmqpjgrmf4-DGlaeV0om4iP
https://spectreattack.com/spectre.pdf
https://blog.cloudflare.com/branch-predictor


- Basics
First, you need to understand the concept of CPU pipelining, so I will explain it briefly.
When a single instruction enters the CPU, that instruction is divided and executed through a pipeline made up of several stages.
The more stages there are, the more instructions can potentially be processed per second.

An extreme example of a CPU that pushed this very far was Intel's Pentium 4 Prescott model, which reportedly had a pipeline with as many as 31 stages.
Intel made a big bet on it to be the first to break the 4 GHz barrier, but in the end, it could not solve the heat issues from launch through the end of its life, and the product was discontinued.
It even earned the disgrace of being slower than the previous generation of CPUs.
For reference, modern generations usually have around 12 to 20 pipeline stages.

Pipelines evolved into super-pipelined, superscalar, super-pipelined superscalar, and so on. In simple terms, you can think of this as increasing the number of pipelines that execute simultaneously.
In the explanation below, I will use the following four stages as the baseline.

IF (instruction fetch) - ID (instruction decode) - EX (Execute) - WB (write back)

IF: fetch instruction
ID: decode instruction
EX: execute
WB: return result

Let's look at a quick example. (CL.=clock)

CL.|IF|ID|EX|WB
1   A
2   B  A
3   C  B  A
4   D  C  B  A
5   E  D  C  B
...

This is the pipeline execution result from clock 1 to 5 when five instructions, A through E, are in the queue.
If you simply executed these five instructions, it would take 4*5=20 clocks, but with a pipeline, it takes k+(N-1)=4+(5-1)=8 clocks, so using the pipeline lets you get the result 2.5 times faster.
If the pipeline were split into smaller pieces so that each stage took less time to execute, it would be even faster because more instructions could be executed at once.

Here, I will also briefly go over three concepts called pipeline hazards.

1. structural hazard
2. data hazard
3. control hazard


- structural hazard
This happens when different stages access the same resource. For example, IF and WB might access memory at the same time, or ID and WB might access registers at the same time.
These structural problems were each solved by changing the hardware structure.

First, for register access, the clock was split in half so that register reads happen during the first 0.5 clock and register writes happen during the second 0.5 clock. That way, even when they execute at the same time, each uses a different half of the clock, so register access does not overlap.

If you look closely at the memory access problem, IF accesses memory to fetch instructions, while WB accesses memory to store data. So separating those would solve the issue, right?
If you look at L1 cache specifications, L1 is divided into L1i (instruction) and L1d (data), and this is the reason.
IF accesses L1i to fetch instructions, and WB accesses L1d to write data.


- data hazard
This refers to a situation where the next instruction has a dependency on the value from a previous instruction. For example, if there is logic like this, c has to wait until b is written back.

b=a+1;
c=b+1;

For reference, this is a RAW (read after write) situation, which is called a true dependency. I will not go into WAR and WAW, which are false dependencies.
To resolve this dependency, you can either wait for two stages or use forwarding.
The actual operation result is known when the EX stage completes, so if you register the RAW instruction for forwarding, it can read the result immediately after EX completes instead of waiting until WB, minimizing the waiting delay.

If you look at the architecture in the link below, you will see a forwarding unit at the bottom, and the data received from there is fed into a Mux (Multiplexer) and then goes into the ALU.
https://i.stack.imgur.com/1KmO5.png


- control hazard
When a branch instruction is encountered and execution moves to another address, all subsequent instructions that were being executed sequentially are invalidated, and the instruction at the branch target address is read from the beginning. Let's look at pipelining again.

CL.|IF|ID|EX|WB
1   A
2   B  A
3   C  B  A
4   D  C  B  A

Here, if B is a branch statement and the instruction at address Q is executed, the fifth clock will look like this.

5   Q  X  X  B

C and D, which had been calculated earlier, have been invalidated. Since there are only four stages here, it may not look like a big deal, but if the pipeline has 10 or even more than 30 stages, then when a branch statement jumps to another address, all the pipeline work in between gets thrown away, and the cost caused by branching becomes enormous.

For control hazards, this is usually as far as ordinary books go.
What I was really curious about was how branch prediction actually evolved, and the video I introduced at the beginning explains this in detail.
I am not at the point where I can explain it fluently, but I will summarize it as best I understand it.


- branch predictor
To summarize branch prediction in one sentence, it means fetching the address of the next instruction that is often executed after a branch statement.

In general, the CPU fetches the address of the next instruction for IF (Instruction fetch) through the PC (Program Counter) register in assembly, and the CPU sequentially reads the PC+4 address because addresses are 32 bits.
What would happen if, when a branch statement is encountered, the PC value is changed so that the instruction address that was executed previously by that branch statement becomes the next instruction address? Then during IF, it would fetch the instruction that will actually execute next, instead of the sequential instruction address.

This buffer is called the BTB (Branch Target Buffer).

However, storing the next instruction address exactly for every branch instruction that executes wastes a lot of resources. That is because the locations jumped to by branch statements usually move only at the lower-bit level.
Also, branch prediction has to be fast enough to provide a result within one cycle, so it uses as little data as possible, compressed like a hash table.

For example, suppose we are storing BTB indexes on a 32-bit CPU. If we have addresses like this, the upper bits are almost the same anyway, so let's store only the lower 12 bits.

(32-bit)       (lower 12 bits)
0x00000010 -> 0x010
0x00000014 -> 0x014

If you look at the branch instruction indexes here, 0x010 exists, but 0x011, 12, and 13 are empty, and 0x014 is used again. That is because instructions are 32 bits. So if you store them this way, when the index has 1024 consecutive storage slots, you would actually be able to store only 256 entries.

Then, since the lowest 2 bits are guaranteed to always be 00 (binary), if we remove the last 2 bits from the lower 12 bits and store only the 10 bits from the 12th bit through the 3rd bit, would we not be able to use all 1024 slots?

(address)    (binary)            (lower 2 bits removed)  (final address)
0x010 -> 0000 0001 0000 -> 00 0000 0100 -> 0x004
0x014 -> 0000 0001 0100 -> 00 0000 0101 -> 0x005

Of course, address values beyond 12 bits will cause hash collisions, but the goal in the first place is not to store the next instruction addresses for all branch statements. The goal is to store only the local branches currently being executed, so this is not considered.
The purpose is not to guarantee the pipeline even for faraway functions that are only occasionally executed, but to avoid breaking the next pipeline as much as possible in local loops.

The BTB stores the instruction address executed by a previous branch. If it also stored the result history of previously executed branch instructions and used that when jumping, it would become more accurate, right? A table that stores branch results like this is called a BHT (Branch History Table).

The stored values are the two values N (not taken) and T (taken). If BHT uses 1 bit, it stores only the immediately previous result, so it has the drawback that prediction will fail 100% for a pattern that alternates like NTNTNT. Because of that, it is usually stored using 2 bits.

A 2-bit BHT moves state to the left when the branch result is N, and to the right when the branch result is T.
SN(strong not taken) - WN(weak not taken) - WT - ST

But with this kind of simple prediction, it is hard to detect many patterns. So another method called PHT (Pattern History Table) appears, and this records actual history patterns.
If the results alternate as NTNTNT, the first two predictions will fail, but after that, it can predict the repeating pattern with 100% accuracy. That pattern uses only a 2-bit counter, but if you use a 3BC, patterns like NNTNNT or NTTNTT can also be predicted. For example, in a loop, it would be able to accurately predict a statement like this.

if (i%3) ~~

What I have explained so far is about PShare (Private History, Shared Counters). In general, it is useful for small loops or branches that follow odd/even patterns.
In contrast, the method that looks at things globally is called GShare (Global History, Shared Counters). This one emphasizes the patterns and correlation between branches, and it requires more memory for records than PShare.

A Tournament Predictor stores the results of the two predictors described above in a Meta Predictor table, then chooses which predictor's result to use the next time it executes.

There is also a similar approach called a Hierarchical Predictor. It has a simple 2-bit-counter predictor, a Local History predictor, and a Global History predictor. If a branch instruction exists in Global History, it fetches from there. If not, it goes to Local History, and if it is not there either, it goes down to the 2BC predictor and fetches from there.

If the 2BC predictor predicts incorrectly, the result is promoted to Local History and managed there. If the branch is also wrong in Local History, it is promoted to Global History. This is a method that spends more cost on parts that can be mispredicted.

Finally, I will briefly summarize RAS (Return Address Stack).
A function call can also be seen as a kind of branch statement. That is because, when it is called, execution moves to another address. However, there is a part that needs to be approached a little differently.

0x1230: call func1
..
0x1250: call func1
..
func1:
..
0x2004: ret

Suppose there is roughly some assembly code like this. The 0x1230 and 0x1250 instructions can go into the BTB. But if you look at the 0x2004 ret part that returns from func1, the return address changes depending on where it was called from. Then storing it in the BTB here has a high probability of failing.

So in the case of function calls, as an exception, the address to return to after the call is stacked separately in the RAS, like a call stack, and when returning, the address at the top is fetched. If calls are nested as func1 -> func1-1 -> func1-2, the stack will be built like this.

func1-2 <- now
func1-1
func1

Of course, since it pops each time it is read, the next time it encounters ret, it will fetch func-1-1.


- spectre attack
Only now can we talk about the Spectre attack. The Spectre attack begins by running my application on the same core as the target and repeatedly executing it so that it branches to the code I want to run, thereby training the BTB. This is because the BTB is a device shared per core.

After that, when the target tries to execute a branch through the predictor, based on the BTB contents that I trained, my code enters the target's pipeline and executes. Of course, it does not execute all the way to the end, but information left in the cache line after reading memory in the middle can reportedly be read by using the access speed difference between cache and ordinary memory.

As you can tell from this complexity, there are a lot of preconditions. The two programs have to run on the same core, the branch instruction address and the address to read must be known, there must be an address space that both programs can access, and so on. In practice, it is almost impossible.


- Conclusion
1) Overcoming structural, data, and control hazards contributed greatly to improving CPU performance.
2) Branch predictors are much more complex and efficiently structured than I expected.
3) For more information, search using the keywords below. (BTB, BHT, PHT, PShare, GShare, Tournament/Hierarchical Predictor, RAS)
4) Spectre attacks have many preconditions, so they are not easy to exploit.

It made sense when I was listening to it, but now that I have actually written it out, I guess I do not understand it deeply enough to explain it easily. The post is a bit all over the place, but I think it is fine if you can at least take away some keywords.

Previous post: https://frogred8.github.io/
#frogred8
</pre>
