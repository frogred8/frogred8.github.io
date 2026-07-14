---
layout: page
title: "[network] The history of CIDR notation"
date: 2023-06-18
---

<pre>
I wrote up a bit more of what I learned about why CIDR notation came about. I hesitated a little because most of this is probably familiar, but I tend to remember things longest when I organize what I studied by explaining it to someone else, so this is a light write-up. Read it casually.


- The Starting Village
When the Internet was developed, IP addresses were given meaning by broadly dividing them into two areas. The front part was the network ID, and the rest was the host ID. What we commonly call a class is the network ID area, and the remaining bits are called the host ID. But whenever I looked at the explanations in books, the part I found hard to understand was the range of each class.

A: 1.0.0.0~126.255.255.255
B: 128.0.0.0~191.255.255.255
C: 192.0.0.0~223.255.255.255
D: 224.0.0.0~239.255.255.255
E: 240.0.0.0~255.255.255.255

D and E are said to be broadcasting and reserved areas, so only A, B, and C are actually used. But I couldn’t really get a feel for exactly what 1~126 meant in class A. (How is it different from the B range below?) These days, allocation using CIDR (Classless Inter-Domain Routing) feels so natural.

To understand this, we need to understand the situation in the past. The original design philosophy of IP prioritized speed over scalability. There were 4.2 billion IP addresses, so no one dreamed that they would run out. Computers at the time were only for academic use, so there was no real need to think about scalability.

In any case, because they pursued faster speed, they adopted a fixed interface that determined the network ID range of an IP address based on the position of the first 0 bit. With this method, there was no need to pass additional information to routers and no need for much calculation, so it was fast and easy for people to understand at a glance.

So they established a convention where if the first bit was 0, it was class A; if the second bit was 0, it was class B; and if the third bit was 0, it was class C. If we express the first octet of the four IP octets in bits, it looks like this.

A: 0xxx xxxx (0~127)
B: 10xx xxxx (128~191)
C: 110x xxxx (192~223)

So IP addresses whose first octet starts with 1~126 are called class A, 128~191 are class B, and 192~223 are class C. Routers then decide how many network ID bits to read based on that class: A uses 8 bits, B uses 16 bits, and C uses 24 bits as the network ID. The remaining bits are set as the host ID, allowing each class to have IP addresses within that range. If we express this by bit range, it comes out like this.

class: network id/host id (number of IPs)
A: 8/24 (16.77 million)
B: 16/16 (65 thousand)
C: 24/8 (256)

The ranges that each class has are as above, but how many of each class can be allocated in IPv4? Class A can use 126 networks, B can use 16 thousand, and C can use up to 2 million. As you know, this method quickly ran into limits.

If a company needs 5,000 IP addresses, which range should it receive? Or what if the same company needs to split and manage them in groups of 10 by department?

The answer to the first question is that B has 65 thousand addresses, so only about 10% of them would be used, but if it receives C blocks, it would need to receive around 20 of them. If the routing table grows, naturally it takes longer to find IP addresses, and management is not easy either.
The second question is not easy either. You would need to allocate the smallest allocation range, class C (256 addresses), for each department. That is a huge waste.

I will cover the correct answer to the first question later, and look at the second problem first.

- An Additional Hierarchy
In fact, receiving one large IP range was a matter of wasting IPs, but it was not the immediate problem. The more urgent problem was that large organizations had no way to specify IPs by range. They had to manage every host IP in the routing table each time.

So from the structure that used two layers, network ID and host ID, they split the host ID into two parts and started using a subnet ID and host ID. In the end, they began building internal networks with a three-layer structure: network ID, subnet ID, and host ID.

Of course, to use subnets, additional subnet mask information had to be entered into routers. This subnet mask was defined so that the network ID and subnet ID are written as 1, while the host ID is written as 0. Let’s look at an example of a B class network configured with a 7-bit subnet ID.

123.32.0.0 (B class)
255.255.254.0 (subnet mask)
11111111.11111111.11111110.00000000 (subnet mask bit)

Looking at this subnet mask, because it is class B, the first 16 bits are written as 1. Then, because there is a 7-bit subnet ID, seven consecutive 1s follow, and after that, nine bits are written as 0. Those bits are the host ID.

Therefore, just by looking at that subnet ID, you can tell that this is a routing table with a range of 512 hosts, which is the number of hosts represented by 9 bits.
By receiving one large address like this and distributing it to multiple routers through subnets, separate IP ranges could be managed, so the second problem was solved to some extent.

However, the first problem still remained: in IPv4, there are only 126 class A networks, and each class range is far too large for practical use in the real world. What came out to solve this is the CIDR notation currently in use.

- CIDR
The previous class-based method lacked flexibility, so this approach excluded classes entirely. That is why the name is Classless! Inter-Domain Routing. It was created to expand the concept of subnets to the entire Internet.

So now ranges could be specified at the bit level, and as a result, only the optimal range could be used without wasting large amounts of IP space. In the past, if you needed 7,000 IP addresses, you had to receive and manage either 28 class C blocks or a class B block, but now you can simply receive a /19 block and use it.

CIDR: 15.28.32.0/19 (8,192)
Range: 15.28.32.0 ~ 15.28.63.255


- Conclusion
1) IP is divided into a network ID and a host ID.
2) In the past, it was identified by class-based ranges according to the number of network ID bits.
3) Subnet masks were also used to compensate for the drawbacks of this.
4) Today, it is common to use CIDR, which extends the subnet concept.

Previous post: https://frogred8.github.io/
#frogred8 #network #ip #cidr
</pre>
