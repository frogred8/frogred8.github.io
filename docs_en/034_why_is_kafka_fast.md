---
layout: page
title: "[java] Why is kafka so fast?"
date: 2024-05-18
---

<pre>
In an event-driven architecture, you need a messaging service at the center of it, and technologies like Kafka, RabbitMQ, and Redis (pub/sub) are commonly used. Kafka is especially common in large-scale services because its throughput is far better than other services. To summarize the characteristics of each service in one line:

kafka: high throughput
rabbitmq: low latency
redis: relatively easy to use

For more details, the benchmarking links below should help a bit more when making a choice. Personally, I tend to think Redis' strength is usability rather than speed or throughput.
https://www.confluent.io/blog/kafka-fastest-messaging-system/
https://aws.amazon.com/ko/compare/the-difference-between-kafka-and-redis/

But while looking at Kafka, I started wondering how Kafka can produce that much throughput even though it is written in Java and runs on top of a VM. So I looked into a few things, organized my thoughts to some extent, and am writing them up briefly.


- General reasons Kafka is fast
If you search for this topic, there are many articles, and most of them say roughly the same thing, so here I will briefly explain based on the page below.
https://www.geeksforgeeks.org/why-apache-kafka-is-so-fast/

1. Uses low-latency I/O
Received messages use RAM to reduce latency and minimize DISK usage.

2. Uses a sequential I/O data structure (log)
Messages are appended at the end, and message reads use a data structure called a "log," where each consumer has its own separate pointer to avoid seek time. For more detail, see the link below.
https://medium.com/rate-labs/11513af8b998

3. Applies zero-copy
Improves efficiency by passing data directly to the kernel without copying data in the application area. (The main topic of this post)

4. Horizontally scalable system
A system that can distribute a single topic across multiple consumers.

5. Data compression and batch processing
A structure that improves transmission/management efficiency by managing data in batches, then compressing and storing/transmitting it. The troubleshooting post below was interesting.
http://happinessoncode.com/2019/01/18/kafka-compression-ratio/

The other parts were roughly intuitive, but I had trouble understanding how zero-copy would be implemented. Is it possible to pass data directly to the kernel? So in this post, I will take a deeper look at zero-copy.


- Before getting started..
How does memory allocation happen? I don't mean allocation with malloc or new, but the "real" memory allocation process.

Actually, it is not strange if you don't know it well. Unless you have dug deeply into kernel books, it is not easy to know. Thinner books often cover it briefly and then move on vaguely.

Roughly writing it out as far as I know:

1. Request memory from user space to the kernel
2. The kernel allocates memory in page units (32bit=4kb, 64bit=8kb)
3. Register a mapping table between the allocated page's physical memory address and virtual memory address (PMT, Page Map Table)
4. Return the virtual memory address

To compensate for the drawback of fragmentation when allocating memory smaller than one page (4kb), the unallocated portion can be recorded and then, on the next memory request, the current allocated page can be searched for free space, or released blocks can be merged with techniques like the Buddy system. When the same size is frequently allocated/freed, various memory management techniques such as small/large bins and SLAB are also used to minimize fragmentation.

There are also things like kmalloc for physically contiguous memory allocation and vmalloc for memory allocation that is only virtually connected. With vmalloc, performance can degrade in some cases due to excessive changes to the TLB (Translation Lookaside Buffer), and so on... (This content may also correspond to some part of the process in recent versions, so treat it only as a reference, and I recommend looking it up separately for details.)

Anyway, the important point there is that memory allocation passes control to the kernel once. That means a context change has to happen at the CPU level, and that is a fairly expensive operation. For reference, depending on the algorithm, freeing memory can also impose an even larger load.

The reason I suddenly wrote about this is that zero-copy ultimately starts from the requirement to minimize context changes in the kernel area. Memory allocation is the easiest example to encounter, so I wrote about it briefly. Now below, I will properly look into zero-copy.


- What is zero-copy?
I will start by introducing a good article you inevitably come across when looking this up.
https://www.linuxjournal.com/article/6345

Zero-copy is a feature created with the goal of minimizing the overhead that occurs when copying a file to a socket. I will explain based on Linux here, but I heard the final interface is supported the same way on Windows too. I will go through the zero-copy improvement approaches introduced in the article above in order.


1. Initial implementation
If you implemented a feature that copies a file to a socket and sends it using existing commands, it would look like this.

char *tmp_buf = malloc(len);
read(file, tmp_buf, len);
write(socket, tmp_buf, len);

Looking at it in detail, when read is called, data is copied from DMA to a kernel buffer in order to read the file, and then copied again to the user buffer (tmp_buf). In write, this user buffer is copied back to the kernel buffer (= socket buffer), and then copied again to the protocol engine.

This is an expensive operation with a total of 4 copies and 4 context changes because each operation requires executing a command in the kernel area. The next approach improves this a bit by using mmap.

2. Applying mmap
tmp_buf = mmap(file, len);
write(socket, tmp_buf, len);

mmap is a command that creates a memory buffer that can be shared between the user/kernel areas. Because of this, there is no need to copy the file into a user buffer, and copying can happen only in the kernel area.

When using mmap, data is copied from DMA to the kernel buffer, and in write, this mmap buffer is copied to the socket buffer and then to the protocol engine. This reduces it to 3 copies and 4 context changes.

3. sendfile command
With a method where at least one kernel command is involved each time, you cannot reduce the number of context changes, so a new command was created altogether.

sendfile(socket, file, len);

Using this copies data from DMA to the kernel buffer, then directly to the socket buffer, and then to the protocol engine, so the number of copies is still 3, but the number of context changes is reduced to 2.

4. sendfile improvement
Initially, the kernel buffer was copied to the socket buffer, but to reduce this cost, the socket buffer interface was changed so that it could receive the data's location and length information instead of the entire data. This also eliminated the copying cost within the kernel area. Since the external interface did not change, you can use it the same way as before.

sendfile(socket, file, len);

With this, data is copied from DMA to the kernel buffer, and only the location and length information for that kernel buffer is recorded in the socket buffer, allowing the protocol engine to directly reference it and copy from it. Strictly speaking, it is not zero-copy, but it is meaningful in that it reduces duplicate data copying between the user/kernel areas. In fact, there is probably no way to reduce it further than this.


- So how did Kafka become faster because of zero-copy?
Kafka is written in Java. Since it runs on top of the JVM, in addition to user-kernel context changes, user-space memory allocation/copying costs and so on are inevitably burdensome. (And GC on top of that.)

But if you use the sendfile interface provided by the kernel, you can send data directly without copying it into user space every time you read it, right? So Kafka uses this to implement a method where, whenever a consumer requests data, accumulated messages are sent directly over the network using sendfile, instead of being copied into user space and then sent out.

In Java version 4, a package called nio (New IO) was added, and you can think of the transferTo function there as a wrapper around this sendfile. In IBM documentation, there is an example comparing the existing method with a method using transferTo, and it showed results that were 65% faster.
https://developer.ibm.com/articles/j-zerocopy

I also wanted to briefly introduce the related Kafka source code, so I looked at it a bit, but most of it was typical usage of Channel and Selector from the nio package, so the story is that I just analyzed it on my own and left it at that.


- Conclusion
1) Kafka was able to dramatically improve throughput because of zero-copy.
2) Zero-copy is a feature supported by the OS that reduces context changes in the kernel area and data copying into user space.
3) In an initial general implementation, 4 copies and 4 context changes occurred, but changing this to zero-copy can optimize it down to 2 copies and 2 context changes.


Previous post: https://frogred8.github.io/
#frogred8 #kafka