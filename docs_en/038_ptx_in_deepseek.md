---
layout: page
title: "[etc] A look at deepseek's optimization techniques"
date: 2025-02-15
---

<pre>
DeepSeek, which came out last month, is getting a lot of attention for performance comparable to top-tier AI, training costs less than one-tenth as high, and the use of inexpensive hardware.
I had only known about DeepSeek in passing, but then I came across a good article explaining how it was technically optimized, so I put together some of that content along with what I learned about those parts.
The original articles below contain a lot of information beyond optimization, including actual AI training strategies and other details, so they are worth reading.
https://stratechery.com/2025/deepseek-faq/
https://dev.to/datamonk_/how-deepseek-is-making-high-performance-ai-accessible-to-all-26fp


- Background
As everyone knows, the reason DeepSeek had no choice but to use inexpensive hardware is that, due to tensions between the U.S. and China, the U.S. began imposing export restrictions on China. The targets included not only semiconductor manufacturing equipment but also high-performance GPUs. As a result, exports of Nvidia's A100, H100, and similar GPUs, which are essential for AI training, were restricted starting in August 2022. This was a major issue for China, but it also meant a large revenue loss for Nvidia.
So Nvidia created and exported the H800, a lower-end model of the H100 (= China-only), but even that was blocked in October 2023. Now Nvidia is making and exporting the H20, which has even lower performance, but who knows when that will be blocked too. You can roughly think of the performance as being cut in half each time. (According to one article, the H20 has about one-fifth the performance of the H100...)
I was curious how much China imported during that period, so I looked up a few articles. China's revenue was $5 billion in 2022, but reached $10 billion in 2023. The 2024 figures have not been announced yet, but apparently they are at least higher than the previous year.

From China's perspective, when trying to develop AI, low-performance GPUs were a problem, but bandwidth being cut in half was also a major issue. That is because AI training involves hundreds of billions of parameters, so a single GPU's memory is not enough and multiple GPUs need to be tied together. The performance was already slow, and with bandwidth also halved, AI development was not easy under those conditions.
To overcome this limitation, they changed their AI strategy and attempted low-level optimization. By applying various optimizations with PTX, they ended up developing DeepSeek.


- What is PTX?
PTX stands for Parallel Thread Execution, and it is an ISA (Instruction Set Architecture) created by Nvidia. Just as code written in any language on a CPU is compiled into assembly before use, GPUs also do not use CUDA code (C, Python, etc.) directly. When CUDA code is compiled, it is converted into the PTX intermediate language, and when the GPU reads that, the driver converts it into machine code for execution. (However, PTX is tied to Nvidia GPUs, so it does not work on AMD.)
In other words, just as you can use inline assembly while writing C/C++, you can also insert PTX code into CUDA code while using it.


- PTX Optimization Methods
Now that we have looked at the background that forced low-level optimization and what PTX is, let's take a closer look at what the DeepSeek team did with it.

1. While compiling CUDA code, they fine-tuned parts where inefficient computation occurred and restructured them so they would be used efficiently
2. They restructured tensor operations to reduce memory bottlenecks and increase throughput
3. They rewrote key PTX kernels to increase throughput

Let's say items 1 and 2 make sense, and take a deeper look at item 3.


- GPU Structure and Optimization Method
First we need to understand how a GPU is structured, so if we interpret the H800 specs below line by line:

* Shading Units: 16896
  The number of cores that handle parallel computation
* TMUs: 528
  Texture Mapping Unit. Acceleration cores that apply images to models
* ROPs: 24
  Raster Operations Processor. Performs tasks such as depth testing on the final rendered image and writing to the frame buffer
* SM Count: 132
  Streaming Multiprocessor. An independent compute unit that includes Shading Units, TMUs, L1 Cache, and so on
* Tensor Cores: 528
  Acceleration cores for matrix operations specialized for deep learning
* L1 Cache: 256 KB (per SM)
  Cache memory allocated to each SM
* L2 Cache: 50 MB
  Secondary cache memory shared by all SMs

What we usually call the number of CUDA cores is the Shading Unit (SU from here on), but those 16,896 units do not operate individually. Instead, each SM (Streaming Multiprocessor) is a component that includes SUs (128), TMUs (4), and Tensor Cores (4).
The H800 is made up of 132 SM units, and each SM can execute multiple warps. Each warp can execute 32 threads. On the H800, one SM can execute 64 warps, and up to 2,048 threads can run per SM, so in theory a single H800 can run more than 270,000 threads simultaneously.

If you have a rough picture of this in your head, the rest should be easier to understand.
I said the H800 has low bandwidth, right? So the DeepSeek team separately configured 20 of those 132 SMs to manage communication with external chips, overcoming the low bandwidth by optimizing things so computation results could be transferred without delay. This is a feature that is impossible in CUDA and was an optimization only possible through PTX.

Also, because the H800 has lower compute performance and bandwidth, they used E4M3, an 8-bit FP8 format (4 exponent bits, 3 mantissa bits), which increased computation speed and reduced data size. The H800 is terribly slow at FP64 computation, while its FP8/16 performance is similar to the H100. For reference, E4M3 has a precision of 0.125 and can represent values from a maximum of 32768 down to a minimum of 0.000061.


- Looking at the Paper
Articles and news pieces had their limits, so I briefly looked at the PTX-related parts of the published paper, and it had more detailed content than I expected.
https://github.com/deepseek-ai/DeepSeek-V3/blob/main/DeepSeek_V3.pdf
The main chapter was Efficient Implementation of Cross-Node All-to-All Communication, and I will summarize only the parts needed here.

1. (The H800 has up to 8 NVLinks, and a set of that many graphics cards connected by NVLink is defined as one node) Intra-node communication is connected through NVLink. The bandwidth is 160GB/s
2. Cluster connections (between nodes) use IB (InfiniBand), and the bandwidth is 50GB/s
3. Because IB is relatively slower than NVLink, tokens are redundantly stored across up to 4 nodes so that queries do not leave the node as much as possible and searches happen inside the node whenever possible. Each token is immediately delivered to the target expert (this requires understanding DeepSeek's AI strategy, MoE, so I will skip it here)
4. 20 fixed SMs are divided into 10 communication channels to create a dual-pipelining structure
5. Dispatching and combining processes are handled through warp specialization, and the number of warps assigned to each communication task is dynamically adjusted
6. The dispatching and combining process is designed to overlap with the compute stream, minimizing idle time (feels like a CPU pipelining RAW hazard solution?)
7. Custom PTX instruction sets are provided for the data, and the communication chunk size is automatically adjusted to reduce L2 cache usage and interference with other SMs

I did not explain the concept of a warp, but there are plenty of explanations with diagrams if you Google it, so I will skip it here.


- Looking at PTX
I was curious what PTX instructions were actually used for optimization, so I took a quick look at the PTX instruction set.
Since PTX is an ISA created by Nvidia, the manual is quite well written. Take a look at the link below.
https://docs.nvidia.com/cuda/parallel-thread-execution/

At first glance, it feels quite similar to assembly language, but the instruction set is organized in a way that is easy to read. For example, if you look at mov, assembly language has separate instructions for each type being copied (movl, movq, etc.), but PTX appends the type after the instruction, such as mov.u8 or mov.f32. Other instructions such as add and sub work the same way (add.s32, sub.f16, etc.)

I looked through the instruction set to see whether there was an instruction that could run by separately specifying an SM id, which is the optimization technique DeepSeek applied, but there was no such thing. Come to think of it, if this code is already executing, it would already be inside an SM, so moving it to another SM to execute would not make sense.
So I looked more carefully and found that the current SM id can be obtained from a special register called %smid. Using that, it seemed possible to write code that controls only the top 20 of the 132 SMs.

If you write that roughly in PTX code:

// Define a 32-bit variable id
.reg    .s32 id;
// Copy the SM id into the id variable
mov.u32 id, %smid;
// If id is less than 20, store true in p (0-19)
setp.lt.u32 p,id,20
// If p is true, move to the L1 label
@p  bra L1
// At the L1 label, optimize the computed data according to the data for each SM id
L1:
...

I do not know whether they actually did it this way, but within the instruction set, I could not think of any other idea. DeepSeek said it released the code, so I went to that repo too, but there does not seem to be any PTX-related logic, so the core technology is probably private.
In addition to smid, you can also get warpid, tid, and gridid, and async instructions exist as well, making thread control possible, so I suspect they combined and used those. (The async code got excessively long as I was writing it, so I omitted it.)


- Miscellaneous Thoughts and Reflections
There were mostly reposts and not much information domestically, so I searched a lot using overseas sources. As I was wrapping up the post, I found a high-quality article on Naver.
https://naver.me/5mIoUqAX
According to that article, the DeepSeek team was previously a team that developed HFT (High-frequency trading) systems in the financial sector, so they had a lot of know-how in optimizing bandwidth and latency.
After learning that, I had a lot to think about: this was not a technology that appeared out of nowhere like a comet, but an achievement made possible by the technical ability of a skilled team. It made me think that these kinds of world-class achievements really do require technical capability at the team level, not just individual skill...
I also spent several days looking into AMD's ROCm and HIP in addition to Nvidia's CUDA, but I have not yet reached enough depth to write about them, so I guess I will write about them later.


- Conclusion
1) DeepSeek went through many optimizations to overcome an environment where it had no choice but to use lower-performance hardware
2) It overcame low bandwidth through low-level optimization using PTX, the intermediate language of Nvidia graphics drivers
3) PTX is similar to assembly language, and thread control is possible with async instructions
4) China's low-level technical capabilities really feel impressive


Previous post: https://frogred8.github.io/
#frogred8 #deepseek #ptx
</pre>
