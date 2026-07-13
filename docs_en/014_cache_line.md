---
layout: page
title: "[etc] Why is i,j faster than j,i in loops over two-dimensional arrays?"
date: 2022-08-14
---

<pre>
A little while ago I saw a good question, and I wanted to dig into it a bit more deeply, so I put this together. First, let's look at the example code.

int a[20][20] = {1,};
for (int i=0; i<20; i++) {
  for (int j=0; j<20; j++) {
    sum += a[i][j];
  }
}

The original question was which dimension of that two-dimensional array should be iterated first to make it faster. The question is simple, but it is actually hard to answer casually. That is because you need to properly understand how the memory cache works in order to answer it.

To give the simple answer first, for that code, iterating from the lowest dimension is the fastest. That way, cache hits occur almost all the time. However, depending on the data structure, it may not be faster and may be identical. I will explain these counterexamples slowly below.

Since we cannot avoid talking about the CPU, let's take a somewhat longer look. Modern CPUs have L1, L2, and L3 cache memory on the CPU chip, while actual memory uses external RAM (16, 32GB, etc.). I heard that long ago, before Pentium-era single-core processors, CPU cache was sometimes added on the motherboard, but these days it is included in the CPU without exception.

Below is the cache memory specification table for an actual CPU, the AMD 5600X.

Cores	6
L1 Cache	64K (per core)
L2 Cache	512K (per core)
L3 Cache	32MB (shared)

As shown above, the L1 and L2 caches exist once per each of the 6 cores(!) with that capacity, and L3 is cache memory shared by all cores. CPU cache memory is made with SRAM, while external RAM is made with DRAM. So CPU cache memory is faster than regular RAM, but it is also that much more expensive.

To add a little more that is not in the spec table, the L1 cache is further divided into data and instruction caches, with 32KB allocated to each and used to cache data suited to each type. These are usually abbreviated as L1d/L1i. There is also something called the TLB (Translation Lookaside Buffer), which acts as a translation table between virtual memory addresses and physical addresses. If a TLB miss occurs, the received address is translated and written into the TLB, and the next request uses it.

Then is cache always better the bigger it is? Could L1 just be as large as L3? You might wonder about that, but this is a very subtle issue. From the perspective of cache access, it does not search with a loop anyway and can be accessed directly with O(1) complexity, so the larger the capacity, the higher the cache-hit ratio, which is good. But as it gets larger, there is a downside: cache latency grows due to contention with other CPUs' caches or the cache costs that must be paid when cache write operations require updates. Also, from the cache management perspective, the larger the capacity, the more efficiency can drop depending on the algorithm (LRU, LFU, etc.). Well, in general, a cache being appropriately large is good, but the Intel and AMD architecture people will handle what size is efficient, so it is not really our concern. (Actually, if not for the price increase, I feel like they would just make them really big...)

Something else just came to mind: I heard that the unfortunate processor "Bulldozer," which brought AMD to the brink of collapse, was so slow because its cache policy was designed poorly. They increased both the L2 and L3 capacity to 8MB, but because of that, the cache latency when accessing L2 and L3 was twice as slow compared with Intel CPUs released around that time. It landed near the bottom in every benchmark, and since its CPU clock was high, it was also famous for poor performance per watt. Looking at that, it is also a reason why architecture is as important as CPU clock in the multiprocessor era.

Recently, AMD released models with something called 3D V-Cache, where memory is stacked on top of the CPU. There is a CPU called the 5800X3D, and its L3 cache capacity is said to have increased threefold compared with the previous model. (5800X:32MB, 5800X3D:96MB) Looking at benchmarks against the previous CPU, it is a little higher in general areas, but the difference is not huge. However, in games that lean heavily on the CPU, the improvement is really meaningful. (20~30% frame improvement in Lost Ark or PUBG)


That was too much digression. Anyway, we briefly looked at CPUs and caches, so now let's go back and look once more at the example code that may have faded from memory.

int a[20][20] = {1,};
for (int i=0; i<20; i++) {
  for (int j=0; j<20; j++) {
    sum += a[i][j];
  }
}

Let's see what operation occurs when a[0][0] is accessed for the first time.
When a[0][0] is accessed, the CPU first checks whether that address is cached in the L1 cache. If not, it reads while going down step by step through L2 -> L3 -> RAM. Therefore cache misses can occur multiple times, but conventionally we call it a cache miss only when it is not in the L3 cache.

Because access proceeds sequentially like this, there are slight differences depending on which cache contains the data. In Intel CPU documentation, the cache and memory subsystem section lists access latency roughly as follows. (Based on i7)

L1: 4 (clocks)
L2: 10
L3: 35~40

Now, if we calculate briefly based on this, when the CPU is 2GHz, the L1 cache latency is 4 clocks, so 4 / 2GHz = 2ns, meaning the L1 cache latency is 2 nanoseconds. But when we access L2, we searched L1 first, did not find it, and then went to L2, so 10 / 2GHz + L1 = 5ns + 2ns = 7ns... Let me organize this all the way through.

L1: 4 / 2Ghz = 2ns
L2: 10 / 2GHz + L1 = 5 + 2 = 7ns
L3: 36 / 2GHz + L2 = 18 + 7 = 25ns
RAM: DRAM latency + L3 = 60 + 25 = 85ns

When I searched online, DRAM latency seemed to be roughly between 50 and 150, so I just used 60. In any case, you can see that every time a cache miss occurs and the access goes down a level, it becomes 2 or 3 times slower.

Returning to the example, assuming the cache is empty, the first access to array a will produce a cache miss, so the CPU will go all the way to memory and fetch the value. Then that value can be registered sequentially in the L3, L2, and L1 caches and used. (This policy can differ depending on the CPU.)

But if it fetched only exactly 4 bytes, that would be too small and inefficient, right? Considering how much it cost just to start the lookup... So it is designed to fetch a certain region starting from the accessed memory address. Recent CPUs are usually set to 64 bytes. This value is called the cache line size, and one fetched region is called a cache line.

Then if a CPU has a 32KB L1d cache and a cache line size of 64 bytes, how many cache lines does it have? The answer is 32 * 1024 / 64 = 512. So the cache operates by maintaining 512 cache lines and rewriting expired lines according to the cache policy.

Let's predict how far cache hits will occur in our example. Below are actual addresses from printing array a in hexadecimal.

a[0][0]:7fff8981c830
a[0][1]:7fff8981c834
a[0][2]:7fff8981c838
a[1][0]:7fff8981c880
a[1][1]:7fff8981c884
a[1][2]:7fff8981c888

You can see that the lowest-level array increases by the size of the array's type (int), and the upper-level array increases by 0x50, that is, by 80 in decimal. Since the cache line size is 64 bytes, when a[0][0] is first read and registered in a cache line, cache hits occur up to a[0][15]. Then when a[0][16] is accessed, it becomes a cache miss and the cache is written anew, and when a[0][17] is read, a cache hit occurs due to the cache that was just added. In the end, a cache miss occurs once every 16 accesses, so as it stands, this logic has a cache miss rate of 6.25%.

Then what about a[j][i], which iterates in the upper dimension instead? Starting with a[0][0] and going through a[j][0], every access in the first iteration will produce a cache miss. And in the next iteration, it will read a[0][1], but will a[0][0] still be in the cache? We do not know. Earlier I said the L1 cache has 512 cache lines, right? In the example, there are only 20 arrays, so the probability of a cache hit is high, but if there were 1000 arrays, naturally it would not be in L1 cache. Only the 512 entries from a[488][0] to a[999][0] would exist in L1 cache.

Would it be in L2 cache? That also depends on the number of L2 cache lines, but it is probably more likely to be in L3. L3 cache is so large, and the data is very small compared with the number of arrays. If it exists in L3, then even if it is not a full cache miss, the data can be received after paying the 25ns cost of accessing L3 through the L1 and L2 caches.

Here, let's briefly calculate how much performance degradation a cache miss causes. A 2GHz CPU runs one cycle every 0.5ns. Each instruction needs a different number of cycles, but if we say the average is 2 cycles, it can execute one instruction per 1ns. But if a cache miss occurs, we said earlier that the cost of fetching from RAM is 85ns, right? That means, theoretically, every single cache miss can cost you the opportunity to execute 85 instructions.

That is why if you look at extremely optimized code that processes large data, there is code that prefetches the data to be used next in order to reduce cache misses as much as possible. It uses inline asm or the volatile specifier so the code does not disappear even during compiler optimization. In fact, when I was writing engine code in C++, I once improved speed by prefetching the 3D model to be calculated next.

Up to here, this has really been theoretical. Shall we try to predict what problems might occur when this is applied in practice?

First, CPUs use a time-sharing system, right? So what happens if the current operation briefly stops due to an interrupt and another program runs? Some of the L1~L3 caches will be overwritten by that program. After it does that work and returns, the cache will not remain intact. Then cache misses will occur, and because of that it will take longer than expected.

Then this time, let's think about multiprocessing. What happens if the operation that was running stops due to an interrupt, and then it is assigned not to CPU 1, where it was originally running, but to CPU 2? If context switching changes the CPU, register information will be loaded from the PCB (Process Control Block), but CPU 2 will not have the previous contents in its L1 and L2 caches. So even if it is not a full cache miss, it will have to pay the cost of fetching from L3. Of course, if it is not there either, it will go all the way to RAM.

To prevent this kind of situation, each operating system often keeps a program on the CPU it was first assigned to in most ordinary circumstances. However, control can be taken away due to multithreading or various other situations, so there are also commands that preferentially assign a specified CPU number. A representative example in Windows is the set affinity menu in Task Manager. But honestly, I have never done a performance test with this, so I cannot be sure how well it works.

Other scenarios worth thinking about include predicting the cache behavior of an array whose individual data elements exceed the cache line size and considering optimization directions, or thinking about what would happen if an asynchronous function were called inside a loop. There are probably many such cases. There are no answers to these, so I will leave them as thought experiments.

In the past, I spent a long time digging into this kind of optimization and then later cooled off a bit. Even if I do not think about it myself, compilers automatically rearrange instruction positions and data-load positions so pipelining works well, and they create inline functions so L1i cache hits are likely. CPUs have also become so smart that even if you write things roughly, for frequently executed functions the hardware branch predictor prevents prediction failures... It has advanced even further from there, so now I also feel like this is a good era where we can really focus only on the logic.


Conclusion)
1) For multidimensional arrays, iterating from the lowest dimension gives a higher probability of cache hits
2) Cache misses are considerably expensive
3) However, there are many differences between theory and actual behavior, so do not be certain before doing real benchmarking


Because the knowledge I studied for this post stopped a few years ago, the current behavior or numbers may be somewhat different. For example, the M1 presents itself as a system on chip and puts the RAM and GPU all into one CPU, right? Cache policy must have changed a lot accordingly. (But why does Apple not have any official detailed documents related to CPU architecture? Am I just not finding them...)

Anyway, I hope you understand only the broad context in this post, and if there is anything wrong or if you know new information about current trends, it would be nice to talk about it together in the comments.

Thanks for reading this long post. Have a good holiday.

#frogred8 #cache #cpu


Additional content)
Results of a cache miss test after changing only the array size in the example code to 1000*1000.
i,j =  0.8%
j,i = 12.5%

<< i,j >>
D   refs:      10,297,745  (8,032,396 rd   + 2,265,349 wr)
D1  misses:       127,434  (   64,197 rd   +    63,237 wr)
LLd misses:       127,011  (   63,850 rd   +    63,161 wr)
D1  miss rate:        1.2% (      0.8%     +       2.8%  )
LLd miss rate:        1.2% (      0.8%     +       2.8%  )

<< j,i >>
D   refs:      10,297,745  (8,032,396 rd   + 2,265,349 wr)
D1  misses:     1,064,939  (1,001,696 rd   +    63,243 wr)
LLd misses:       127,877  (   64,700 rd   +    63,177 wr)
D1  miss rate:       10.3% (     12.5%     +       2.8%  )
LLd miss rate:        1.2% (      0.8%     +       2.8%  )

