---
layout: page
title: "[network] IPv4? what happened to IPv3?"
date: 2023-05-27
---

<pre>
This post started from the question, "If IPv4 exists, was there ever an IPv3? And why did we move from IPv4 to IPv6?"


- Content
If you're a developer, you're probably familiar with IP addresses. I mean addresses made up of 4 bytes (32 bits), like 23.20.150.20.
That kind of IP address is defined in IPv4, but 32 bits can only provide about 4.2 billion addresses. Because of that limitation, the IPv6 specification was created, and since it uses 128 bits, it can provide a practically almost infinite number of addresses (about 340 trillion*1 trillion^2).

From here on, when I say IP, I'm not talking about that kind of IP address. I mean Internet Protocol, which refers to the network layer, layer 3 of the OSI 7-layer model.

In the beginning, before OSI was agreed upon, systems were built and used with only TCP, without IP. Or rather, IP did not exactly not exist; the functionality of IP was included inside TCP.
After TCP versions were developed up to v3, it seemed better to separate the IP layer from TCP, right?

That was because TCP was built around high reliability, so the cost of packet transmission and verification became excessively high, but not every network needed that functionality.

So the network layer was separated from the existing TCP as IP, and TCP was separated out as the transport layer. Then, with the creation of User Datagram Protocol, or UDP, a protocol that does not require transmission reliability, the final structure became IP at layer 3 and TCP and UDP at layer 4.

If you think about it, UDP, which is a transport layer protocol, also uses IP as its network layer, so technically it would make sense to write UDP/IP. But since nobody writes it that way, TCP/IP does feel like it is treated as a proper noun.

Anyway, after separating things this way and creating the specification, it would have made sense to call it IPv1. But since it was separated from TCP after TCP had already reached version 3, it felt natural to follow the TCP version number, so it was released under the name IPv4. That is why the first version of IP started at 4.

Then, in 1998, a new IP specification called IPv6 was released. The reason version 5 was skipped is that after IPv4, an experimental protocol called Internet Stream Protocol (ST) version 2 was published, and version 5 was assigned to IP at that time to distinguish it from regular IP packets. So the next version started at 6. In practice, IPv5 is a protocol that is barely used.


- Conclusion
1) At first, IP was implemented together inside TCP, but when the functionality was separated, it inherited the TCP version number as-is, making the first version of IP IPv4.
2) IPv5 was a specification created while building the experimental Internet Stream Protocol, but it is barely used today.
3) Because of this, the version after IPv4 became IPv6.

Previous post: https://frogred8.github.io/
#frogred8 #network #ipv4
</pre>
