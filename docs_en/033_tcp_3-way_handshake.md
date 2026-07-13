---
layout: page
title: "[network] tcp 3-way handshake"
date: 2024-04-27
---

<pre>
Not long ago, while using Wireshark, I opened up TCP 3-way handshake packets. There were more interesting things in there than I expected, so I put together what I learned.

- Overview
The 3-way handshake comes up a lot in network interview questions, right? At a textbook level, you could describe it as "the first three packets exchanged between a client and server to establish a connection." People who know a little more may explain it as SYN->SYN/ACK->ACK type packets.
So what information exactly is exchanged in this client-server handshake? It is not just a quick ping-pong to check whether the other side is alive, right? I will go through that one by one.

- packet? segment?
First, we need to understand this concept before packet fragmentation can be explained, so I will cover it briefly.
In the TCP/IP we commonly talk about, TCP refers to an OSI layer 4 protocol, and IP refers to an OSI layer 3 protocol. (NIC is layer 2)
At this point, as information is encapsulated according to the rules of each OSI layer, the final form arrives as a single piece of data like the one below, and the actual information for each layer can be retrieved by decapsulating it through header information.

[l2 content][l3 content][l4 content]..

OSI layer 1 is the physical layer, so I will leave it aside. Starting from layer 2, the unit of information used at each layer has a different name. This can get confusing later, so you should remember the names used across layers.

l2 (data link): frame
l3 (network): packet
l4 (transport): segment
l5~7 (app.): data

Here I will only look at IP and TCP, which are l3 and l4, and their rough information is structured like this.

ip: src/dest ip, fragment flags, time to live, length, checksum..
tcp: src/dest port, seq/ack number, flags, window, options (mss, sack..)

To briefly explain the basic concepts of the two protocols, IP contains information for path finding, meaning which route the composed packet should take, and TCP contains the information needed to validate and order received segments so the data can be reconstructed.

You may be wondering why I am explaining IP when the handshake happens at the TCP level. I included this bit of background because it is needed later when explaining MSS among tcp.options. I will first explain IP information, and then look at the TCP handshake.


- IP (packet)
I will skip the fields that are obvious to anyone and look at just two major IP fields.

* fragment flags
This is a flag value that indicates whether a packet should be fragmented when it is larger than a router's MTU (maximum transmission unit). If DF (don't fragment) is set, fragmentation is not performed.
If a router receives a packet that exceeds the MTU, it drops the packet and sends the sender the current router's MTU along with a can't fragment error using ICMP (internet control message protocol). In other words, it is telling the sender to send it again using that value.

However, this does not happen automatically; it depends on the sender that received the error and how it handles the ICMP DF error policy. So when using a VPN, the reason you sometimes cannot connect to a specific server or packet transmission fails may be that DF is set on a packet exceeding the MTU and that server has a policy of not sending ICMP errors, or even if it did send one, the VPN-side server that received it does not reprocess it.
In that case, if you lower the MTU on your host, speed may drop a little, but the connection may work, so try that as a workaround.

You can find a lot of related material by searching for path MTU discovery, and this page explains it well.
https://packetlife.net/blog/2008/aug/18/path-mtu-discovery

* time to live (TTL)
This is what is commonly called a hop. It is usually set to 64, and decreases by 1 each time it passes through a path (router). When it reaches 0, the packet is discarded and an ICMP time exceeded error is returned to the sender.
This is a bit of a separate topic, but the traceroute command is implemented using this. If it sends ICMP echo requests sequentially starting with TTL 1, then when it receives a time exceeded error, it adds one to the TTL and sends the request again. In this way, it scans the route and measures router response times. However, if a firewall or internal router configuration is set not to respond to external ICMP, some paths time out and show up as *.
If you only want to check the route briefly, it is a little better to reduce the three queries to one and set the timeout to 1 second.
traceroute -q 1 -w 1 [url]


- TCP handshake (Segment)
Now we are finally at the main topic. In the 3-way handshake, the client and server exchange SYN -> SYN/ACK -> ACK in that order, and I will check one by one what information is exchanged sequentially.


- SYN
This is the first segment the client sends to the server when establishing a TCP connection. It sends information about the client requesting the connection.

* sequence number (seq number from here on)
This is a 32-bit random number issued by the client to synchronize packet order. It has a range of 0~2^32-1, and if it exceeds that range later, it wraps around to 0. The acknowledgement number that comes later follows the same rule.
Example) Sequence Number: 751742043

* acknowledgement number (ack number from here on)
In a SYN request, nothing has been received from the server yet, so this is set to 0 and sent.
Example) Acknowledgement Number: 0

* header length
You can tell what this is just from the name, right? One unusual thing is that the actual calculated value is the corresponding bit value * 4, so although only 4 bits are allocated, it can represent up to 60 bytes. The example below is binary.
Example) header length: 1011 (44byte)

* flags
This value sets the type of the segment, such as PUSH, RESET, SYN, and so on. In the 3-way handshake, the SYN flag is enabled only in the first two segments. If you want to see this in Wireshark, put tcp.flags.syn==1 in the filter, and only SYN and SYN/ACK will appear, making them easy to find.
Example) flags(bit): 0000 0000 0010 (SYN)

* window
This is the client window value used by the sliding window algorithm. I will look at this a little more in window scale later.
Example) window: 65535

* checksum
A checksum value for checking the integrity of the TCP segment.
Example) checksum: 0xf580

* urgent pointer
Apparently this is a parameter that indicates the location of urgent data only for segments where the URG flag is turned on. I had not seen it before, so I wondered what it was, and it seems it is not commonly used.
Example) urgent pointer: 0

* options
TCP options are composed using the common schema below, and the number of data fields read differs depending on the type.
Kind: option type
Length: the total size of the option
Data1(,Data2..): sequential data depending on the type

Usually four major options are sent. This can differ depending on network configuration, but I will look at the common case.

* option - MSS
This is the Maximum Segment Size value. It is slightly different from MTU (maximum transmission unit): MTU refers to the maximum packet size at the network layer (usually 1500), while MSS refers to the maximum segment size after subtracting the IP header (20) + TCP header (20) from the MTU (usually 1460).

If this value arrives unset, it may be set to the IPv4 specification default of 536 bytes, which can lower transmission efficiency. That is because communication uses the lowest MSS value configured between the connecting hosts. (The IPv6 default is 1220)

Example)
Kind: 2
Length: 4
MSS Value: 1460
(From here on, even for options, I will only write the value)

* option - Window Scale
The window size in the TCP specification supports only up to 64kb, so an extension was needed. But changing an already-defined field is quite difficult. So it was proposed in RFC 1072, and the window scale option was added to the TCP extension options. The window value is applied by multiplying it by 2^n according to this value. (A typical shift operation)

window size = tcp.window << option.window_scale

Example) Window Scale: 6

If the window is 64kb and the scale value is 6, you can see that it means the window size has been expanded to 4mb.
64kb << 6 = 4096kb

* option - TSval, TSecr
These are used to measure RTT (Round trip time) and RTO (Retransmission timeout) between connections, and you can think of them as data used as a basis for congestion control and various decisions. Here, only the Timestamp value of the client that requested the connection was sent, and the server will fill in the Timestamp echo reply when it sends its response.

Example) 
TSval: 12191741
TSecr: 0

* option - SACK permitted
If you have studied TCP a bit, you will know this option: it controls whether selective acknowledgement is enabled. In TCP, when one large piece of data is split into multiple segments and arrives, if a segment is lost in the middle, the basic implementation receives again starting from that part. A feature was added in RFC 1072 that sends information about already received segments along with the retransmission request so that only the missing segments are received, and that is SACK.
Since this is sent only when the feature is enabled, it is also an option that has only Kind and Length.


- SYN/ACK
Whew. We are finally at the second segment. The first segment contains client information, and the second segment, which is the response to it, contains server information. You can think of it as both sides exchanging connection information. The information sent is almost the same as before, so I will look a little more at the meaning of the added values.

* flag
Previously only syn was turned on, but here the ack flag is also turned on and sent.
Example) flags(bit): 0000 0001 0010 (ACK,SYN)

* seq number / ack number
The client only sent seq, but when the server responds, that value goes into ack, and the server also fills seq with a random number and sends it. At this time, the rule for increasing the value is to add the segment size before sending it, but as an exception, in the initial 3-way handshake, values increased by +1 are sent.

Example)
Sequence Number: 3055224127
Acknowledgement Number: 751742044

* option - TSval, TSecr
Previously the echo reply was filled with 0, but here the received client timestamp value is set in the echo reply, and the server value is filled into the timestamp value before sending.

Example) 
TSval: 330256684
TSecr: 12191741


- ACK
The final third segment sends only the timestamp option (TSval, TSecr), with only the flag changed in the basic header.

* flag
syn is turned off and only ack is turned on.
Example) flags(bit): 0000 0001 0000 (ACK)

* option - TSval, TSecr
The latency between the first and second segments was 17ms, and you can see that this is reflected in the timestamp changing in the third segment.

Example)
TSval: 12191758 (previous: 12191741)
TSecr: 330256684


- Conclusion
1) During the 3-way handshake, the main purpose is exchanging information between the connected peers.
2) TCP is not a protocol that was completed all at once, but the result of continuous improvement through added extensions.
3) Wireshark is an almost perfect tool.

Actually, path MTU discovery is a topic worth covering separately, but while organizing it together, I think I ended up adding too many extra notes. The readability did not improve much, but it will probably help someone.

Previous post: https://frogred8.github.io/
#frogred8 #network #tcp #handshake