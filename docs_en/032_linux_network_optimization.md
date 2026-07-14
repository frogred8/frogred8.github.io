---
layout: page
title: "[network] tcp optimization in linux kernel 6.8"
date: 2024-03-10
---

<pre>
I happened to come across an article saying that the Linux kernel 6.8 update improved TCP performance by up to 40%, so I got curious about what changed and looked into it in detail.

- Overview
Before getting into the details, let me briefly talk about kernel versions.
Linux releases minor kernel updates two or three times a year, and I’ve heard that the point where it moves to a new major version is simply whenever the minor number gets large enough. Looking at the history of the transitions from major versions 4 and 5, it seems to happen roughly around minor versions 19 or 20.

The site below has a well-organized summary of Linux kernel releases, and you can see that for some versions, a long CIP (Civil Infrastructure Platform) period is added after LTS (long-term support).
https://www.wikiwand.com/en/Linux_kernel_version_history

CIP was newly added around 2017. It introduced the concept of SLTS (super long-term support), aiming to support specific industrial use cases for 25 to 50 years. Looking at the platforms supported by CIP below, you can tell that it is not intended for general developers.
https://wiki.linuxfoundation.org/civilinfrastructureplatform/ciptesting/cipreferencehardware

And with the 6.x versions, the LTS period was sharply reduced from 6 years to 2 years. I was curious about this too, so I looked it up, and a kernel developer explained two reasons: 1. people don’t really use LTS versions much even when they are updated, and 2. the development workforce is becoming increasingly insufficient, so they decided to shorten the period.
https://www.zdnet.com/article/linux-kernel-6-6-is-the-next-long-term-support-release/

What I mentioned above is the Linux kernel version, but we’re more familiar with versions like 18.04 and 22.04, right? That’s because we usually don’t use the Linux kernel directly; instead, we use a Linux distribution built with that kernel. If you’re a developer, you probably use Ubuntu, and looking only at market share, Red Hat and CentOS also seem to be used often.

So this Ubuntu distribution is actually closer to what we think of as the OS version. Ubuntu releases an LTS version every 2 years, and that version is supported for up to 10 years. I saw that Ubuntu 24.04 LTS, coming out this April, decided to use the Linux 6.8 kernel, so while looking through the changes, I found something interesting and analyzed it.


- Main points
Looking at the 6.8 update below, there is a note that performance for TCP connections improved by up to 40%. In particular, it shows a very large improvement on AMD architectures compared to Intel.
https://www.phoronix.com/news/Linux-6.8-Networking

The broad direction of the optimization was to keep the cachelines for variables accessed during network usage small, while making changes that improve cache coherence.
So in this post, I’ll look at three things: reducing cachelines, increasing cache coherence, and why the improvement was larger on AMD architectures.

- Reducing cachelines
The most important thing in optimization work is to first measure and evaluate the current state, and as expected from a kernel developer, the investigation was done very thoroughly. This is a commit analyzed based on the 6.5 kernel, and it lists whether each variable in the network code is read_mostly or write_mostly, so take a look.
https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=14006f1d8fa24a2320781ad503ca1cba92e940d2

If you look closely at that commit message, you can see that the following items were improved based on the investigation, and the number of cachelines was reduced quite a lot.
name        cacheline
---------------------
tcp_sock     12 -> 8
net_device   12 -> 4
netns_ipv4    4 -> 2

Why this matters is that every CPU has cache memory, and whether it’s for networking or anything else, before performing computation it first checks the L1 cache to see whether the required data is there. If it isn’t, a cache miss occurs, and the lookup goes to L2, L3, and then memory, increasing latency along the way. So cache hits inevitably play a very important role in performance.
(For detailed examples and explanations of this, see the post I wrote before below.)
https://frogred8.github.io/docs/014_cache_line/

So to get cache hits, the data has to always be in the L1 cache. But L1 is usually only around 64 KB per core, and that is split into L1i and L1d, so the actual data cache is 32 KB. Since a single cacheline is 64 bytes, that means only 512 cachelines can be stored. On top of that, these days two threads often run through hyperthreading, so the cache capacity occupied by a single process becomes even smaller.

In this situation, if you reduce the number of cachelines that need to be kept, the probability of cache hits should become much higher. Just counting the total number, it went from 28 before to 14 after the improvement, so the cache footprint was cut in half. This is the first major improvement.

- Increasing cache coherence
If even one variable among the data contained in a single cacheline changes, that entire cacheline is invalidated and a cache update is requested. Imagine a struct like the one below.

struct {
  int id;
  int lv;
  int exp;
  char name[20];
  ...
}

Which field here would most often break cache coherence? Since exp changes every time you kill one monster, it would probably be that value, right?
Then in the L1 cache, this small struct is held in a single cacheline, but every time exp changes, a cache update becomes necessary, so we can expect performance to get worse.

Then how can cache coherence be increased?
The best strategy would be to organize cachelines separately according to how frequently values change. That’s why the kernel developer first classified all network variables into read_mostly and write_mostly at the beginning. If only read_mostly variables are grouped together, that cacheline can be maintained in a state where cache coherence is almost never broken, greatly increasing the probability of cache hits.

This would be especially advantageous for TCP information shared across multiple threads. Cache coherence is particularly vulnerable when shared resources are involved. Below is one of the commits modified in this direction.
https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=18fd64d2542292713b0322e6815be059bdee440c

There are two or three more commits besides this one, and after briefly analyzing them, I saw that parameter min/max values and values set at initial creation were grouped as read_mostly, while accumulated socket recv/send data sizes, sequence numbers, update times, and so on were neatly separated as write_mostly.

- Why the improvement was larger on AMD
The detailed cache policy is hard to know anyway, but assuming the broad direction is similar, I compared CPUs in roughly the same class.

Intel Core i7-12700
L1 Instruction Cache: 8 x 32 KB
L1 Data Cache: 8 x 48 KB
L2 Cache: 8 x 1280 KB
L3 Cache: 25 MB
https://www.cpubenchmark.net/cpu.php?id=4669

AMD Ryzen 7 5800
L1 Instruction Cache: 8 x 32 KB
L1 Data Cache: 8 x 32 KB
L2 Cache: 8 x 512 KB
L3 Cache: 32 MB
https://www.cpubenchmark.net/cpu.php?id=4188

You can see that Intel has more than 50% larger L1d and L2 caches per core than AMD, while having a smaller L3 capacity. So I strongly suspect that the optimization in the first item, reducing the number of cachelines, had a larger impact on performance improvement for AMD, which has relatively smaller cache capacity.

As a side note, this commit was led by an internal Google team. Google is an active AMD vendor to the point that it has adopted AMD EPYC CPUs at large scale in its cloud, so maybe that’s why it also takes the lead on kernel changes like this. Developers like me are already busy enough barely looking at the changes and just thinking, "a higher version is probably better," before using it... It’s a relief that there are so many smart people in the world.


- Conclusion
1) In Linux kernel 6.8, major performance improvements were achieved in situations with many TCP connections through cacheline/cache coherence optimizations.
2) Compared to a simple change with no side effects, the performance improvement you can get from it is extremely good.
3) That said, changes in this direction are a concept that becomes harder to maintain as updates continue, so I’m a bit worried, but since they’re kernel developers, I’m sure they’ll handle it...
4) Linux kernel 6.8 will be included right away in Ubuntu 24.04 LTS coming out next month, so it would be worth applying and measuring at the product level.
5) Always ㄱㅅ to the open-source developers for their hard work

Previous post: https://frogred8.github.io/
#frogred8 #linux #network
</pre>
