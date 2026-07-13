---
layout: page
title: "[etc] Taking a look at deepseek's network library"
date: 2025-11-28
---

<pre>
A while ago, I briefly wrote up deepseek from its origins to how it used PTX and what PTX roughly is.
https://frogred8.github.io/docs/038_ptx_in_deepseek

To briefly summarize what I wrote then, PTX (Parallel Thread Execution) is an intermediate language made by NVIDIA specifically for GPUs. You can think of it as a kind of GPU assembly language, and the deepseek team used it for low-level optimization.
There was a lot about this in the paper, interviews, and so on, but since there was no actual code, I could only stay curious. Then, not long after I wrote that post, in late February, the deepseek team released the actual code on GitHub.
This post is my analysis and personal summary of the network library part that deepseek released. I’ll try to explain it with as little code as possible.


- Introduction to deepEP and why it matters
deepEP (expert parallelism) is one of several libraries released by the deepseek team. Its main role can be seen as a network parallel communication library for MoE (mixture of experts) and PTX.
https://github.com/deepseek-ai/DeepEP/

The reason I found this interesting is that companies like OpenAI (chatGPT), Anthropic (Claude), xAI (grok), and Google (Gemini) have never released their internal development tools or code.
Meta and Qwen, too, basically only release base models after training is complete, and they have never released the detailed development tools actually needed to build those models. So it feels quite ironic that China was the first to release a broad set of development tools for large-scale models.


- deepEP optimization
First of all, deepEP itself is a network library specialized for China-only NVIDIA graphics cards like the H800. In other words, it is the result of trying to overcome the performance limits of the H800 (300GB/s), whose bandwidth is half that of the H100 (600GB/s).
https://www.hyperbolic.ai/blog/h100-vs-h800
So, to make maximum use of the bandwidth, it wraps bottleneck-prone instructions or operations in direct GPU control code (=PTX) and uses them that way.

It is easy to misunderstand CUDA as something that runs only on the GPU, but in reality, commands starting with cudaXXX are sent by the CPU to the GPU kernel, and the GPU kernel places them in a queue, where GPU workers (Streaming Multiprocessors, SMs) pick them up and process them.
If you control this directly with PTX, you can skip the part where commands are passed through CPU-CUDA kernel-GPU queue.

For example, GPU memory copying can be handled simply with the cudaMemcpyAsync command, but in deepEP, PTX is wrapped to directly control TMA (Tensor Memory Access). The function below is just an example of using PTX for memory copying, so you can just skim it as “so this is roughly what it looks like.”

void tma_load_1d(...) {
  ...
  asm volatile("cp.async.bulk.shared::cluster.global.mbarrier::complete_tx::bytes.L2::cache_hint [%0], [%1], %2, [%3], %4;\n"
    :: "r"(smem_int_ptr), "l"(gmem_ptr), "r"(num_bytes), "r"(mbar_int_ptr), "l"(cache_hint) : "memory");
}

cudaXXX functions are designed to be easy to use in a general-purpose way, and if you can control everything, directly calling PTX inside the GPU like this should be faster. After all, it can reduce GPU waiting time to an extreme degree.
This is the first optimization method used in deepEP. (There are quite a few other places where PTX instructions are wrapped and used besides this function.)


The second optimization method is the use of L2 memory read instructions that bypass cache allocation and coherence control. What this means is that when reading a value, the normal flow is to search the L1 cache first and then proceed downward, but this bypasses that and reads directly from L2 global memory.
The NVIDIA guide explicitly says, “Global data is coherent at the L2 level, but multiple L1 caches are not coherent for global data.”
https://docs.nvidia.com/cuda/parallel-thread-execution/index.html#cache-operators
However, this does not mean the L1 cache is always broken. It is talking about cache coherence for the texture cache. The nc qualifier provides higher bandwidth in exchange for giving up cache coherence.

So by directly controlling access through the L2 cache, it can fetch data with high bandwidth. As an additional effect, the data does not overwrite the L1 cache and remains as-is, which increases the chance of cache hits during execution. In deepEP, this is implemented as follows.

uint8_t ld_nc_global(uint8_t *ptr) {
  ...
  asm volatile("ld.global.nc.L1::no_allocate.L2::256B .u8 %0, [%1];" : "=h"(ret) : "l"(ptr));
}

The PTX instruction ld.global.nc.L1::no_allocate is converted, depending on the chipset, into the SASS (Streaming ASseMbler) instruction LDG.E.NA.[width].CONSTANT. You don’t need to know this in that much depth, so if you’re interested, you can search for that keyword.


As the third optimization method, deepEP allocates and uses 20 SMs (Streaming Multiprocessors) dedicated to network communication.
Since an SM is the unit that executes code, it does not matter who runs the work anyway, but because the L1 cache is shared per SM, if the SM that previously handled network code continues doing the same work, cache hit efficiency improves. And if network processing becomes faster in this way, the limited bandwidth of the H800 can be used as fully as possible.
Also, because requests need to be sent to multiple MoEs (Mixture-of-Experts) and then gathered back together, deepEP allocates 20 out of 132 SMs exclusively for networking, which reduces compute performance by about 15%. My guess is that they ran a lot of internal tests and settled on 20. If hardware with 200 SMs appears someday, this value would probably be adjusted accordingly.
Let’s take a direct look at how this part is implemented in the actual code.


- Implementation of SMs dedicated to network communication
Looking at the deepEP code, there are files named internode.cu and intranode.cu. The internode file is the implementation used for communication between nodes, meaning communication with GPUs on other machines, while the intranode file is the implementation used for internal communication among multiple GPUs on the same machine.

Ever since deepseek first disclosed its design, I had wondered how they separated out the 20 SMs dedicated to networking, and the answer was in the deepEP implementation. When deepEP runs, it creates only as many SMs as the num_sms argument specifies, rather than using the entire GPU, and the network implementation runs on those. In the code, this is configured using the SETUP_LAUNCH_CONFIG macro.

In this way, 20 SMs are allocated and used per GPU, but the actual number of channels is 10, with roles divided according to whether the running sm_id is odd or even. Even sm_id values act as senders and forwarders of data, while odd sm_id values act as receivers. This is the Producer-Consumer pattern that you often see elsewhere as well.
At this point, GPUs on the same machine communicate through NVLink, and this role is assigned to warps where the sm_id is even and the warp_id is 8 or below. The function that obtains the role assigned to the current SM based on these various conditions looks like this. (This is a heavily shortened version of the original code.)

#define NUM_MAX_NVL_PEERS 8
auto role_meta = [=]() -> std::pair&lt;WarpRole, int> {
  if (sm_id % 2 == 0) {
    if (warp_id < NUM_MAX_NVL_PEERS) {
      return {WarpRole::kNVLSender, warp_id};
    } else if (warp_id < kNumForwarders) {
        return {WarpRole::kRDMAReceiver, warp_id - NUM_MAX_NVL_PEERS};
    } else {
        return {WarpRole::kCoordinator, 0};
    }
  } else {
    if (warp_id < kNumForwarders) {
      return {WarpRole::kNVLAndRDMAForwarder, warp_id};
    } else {
      return {WarpRole::kCoordinator, 0};
    }
  }
}();

Depending on each WarpRole obtained through the role_meta function, the lower-level execution branches and runs the detailed code. But from here on, it really enters “expert” territory, so analyzing the code was very difficult. I’m not capable of understanding it perfectly, so I mostly just skimmed through it..


- RDMA (Remote Direct Memory Access)
I briefly mentioned intranode and internode above, but this part is pretty interesting, so I organized it a little more.
intranode uses NVLink for internal communication within a single machine, while internode uses RDMA (Remote Direct Memory Access) to communicate with GPUs on other machines, so internode bandwidth is relatively much slower. Even in the specs, NVLink bandwidth is listed as 900GB/s, whereas RDMA is listed as 50GB/s.

Because of this, deepseek is said to keep frequently referenced fixed data duplicated two or three times across other machines, rather than storing it on only one machine even in a clustered setup. Why? If a piece of data exists only in one machine’s GPU memory, then whenever that data is needed, access must go through RDMA, and that can become a bottleneck. So they try as much as possible to check whether the data exists on the same machine through NVLink. You could call it a kind of cache-hit concept.

In any case, RDMA refers to a method of accessing memory on another machine, and it can be divided into two types: IBRC (InfiniBand Reliable Connection) and IBGDA (InfiniBand GPUDirect Async).

With the IBRC method, when the GPU asks the CPU to “send this data over there,” the data is copied from GPU memory to DRAM, and then the CPU sends that data to the NIC (Network Interface Card, LAN card) for transmission. In a machine with several GPUs, if copying to DRAM happens every time and the CPU receives the commands, bottlenecks occur, and efficiently handling responses becomes difficult.
That is why IBGDA came about. It uses NVIDIA’s GPUDirect technology so that the GPU directly transfers data to a dedicated NIC for processing. Because the data is sent directly from the GPU to the connected NIC instead of going through GPU->RAM->CPU->NIC, zero-copy is possible, making it much more efficient.
However, to configure IBGDA, a normal Ethernet NIC is not enough. It is only possible with InfiniBand products or NICs that support RoCE (RDMA Over Converged Ethernet).

I had only vaguely known InfiniBand as a standard specification in the high-performance computing industry, but apparently, after NVIDIA acquired Mellanox, the number one company in that industry, InfiniBand has effectively been developed almost like NVIDIA’s own proprietary standard. Since it is technically a standard, in theory anyone can make it, but in a situation where it keeps improving in ways specialized for NVIDIA, there probably isn’t much reason for other companies to jump into production..


- An interesting commit
While browsing the deepEP commit list, I happened to see a PR from Tencent’s network department.
The main improvement in that PR was changing all the parts that previously communicated using the IBRC method described above to IBGDA, and adding support for parallel data transfer.
https://github.com/deepseek-ai/DeepEP/pull/130
This improvement reportedly increased bandwidth between internodes by up to 30% compared with the previous logic.

And two months ago, the main deepseek developer added something called HybridEP, a method that uses SM resources more efficiently. A PR was also merged that improves performance by 30-70% with the same number of SMs through more efficient SM operation.
https://github.com/deepseek-ai/DeepEP/pull/420

Seeing not only AI models but also these development tools continue to evolve makes me feel that deepseek open source is being run well in line with its purpose, and it is impressive to see this kind of steady progress..
Looking at things like this reminds me once again that no matter how much better hardware gets, low-level optimization is always necessary to push performance to the limit.


- Conclusion
1) deepEP is a network library tool created to overcome the low bandwidth limitations of China-only NVIDIA chips.
2) It performed low-level optimizations through PTX usage, direct L2 cache access, and allocation of SMs dedicated to network communication.
3) deepseek open source is being actively maintained.
4) There are quite a few parts I still don’t understand even after looking at the code, but surely I’m not the only one..

Previous post: https://frogred8.github.io/
#frogred8 #deepseek #deepep