---
layout: page
title: "[etc] Delivering trump’s tweet to 100 million followers"
date: 2026-02-11
---

<pre>
A while ago, I was reading the book Designing Data-Intensive Applications, and one of the examples was about "How are tweets from someone with a massive number of followers delivered to those followers?"
The book briefly mentioned only the solution at the data flow level and moved on, but I wanted to unpack it in a bit more detail from a design and implementation perspective.
It does seem like a common system design interview question, but since there is no single correct answer anyway, please just take this as one possible direction I thought through.


- Constraints
When you think of a celebrity, one name that comes to mind right away is Trump. I looked up his follower count and found he has 110 million followers, while Elon Musk has 230 million.
Here, I will use Trump with 100 million followers as the baseline to make the math easier.
So the design will assume the following constraints: the maximum number of followers is 100 million, messages are at most 140 characters (I hear X now allows up to 280 characters), and every follower must receive the message within a certain amount of time.
I will split the design into two broad parts: the flow for delivering a post to followers, and the optimization design for the actual delivery.
(Since tweets were renamed to posts after the change to X, I will use "post" from here on.)


- Initial design
First, let's assume that when Trump writes a post, it is saved in postDB like this.

postDB
{
  id: "trump",
  num: 1237,
  msg: "Make America Great Again"
}

And let's say information about people who follow Trump is stored in followDB like this.

followDB
{
  id: "maga_fan1",
  follow_id: "trump"
}

If we design the feature for writing a post and notifying followers in about one minute, the rough flow that comes to mind would be something like this.

1. Record the post in the DB.
2. Get the list of IDs that follow the author's ID.
SELECT id FROM followDB WHERE follow_id="trump"
3. Send the post by push to the people in the ID list.

If the follower ID list has 10,000 entries, a single instance could probably handle it, but if it has 100 million entries, that becomes a different story. Just fetching a list of 100 million IDs at once would consume a huge amount of resources. So the first goal of the design will start with "fetching an enormous list of IDs."


- Fetching the ID list
If we think about DB queries that fetch IDs from followDB 10,000 at a time, we could either use pagination with limit and offset, or create an index on id, store last_id, and use cursor pagination to fetch the next n rows from there.
But the first pagination technique has O(N) complexity, so the larger the offset gets, the slower the operation becomes linearly. The second approach based on last_id is disadvantageous for scale-out because it cannot operate across multiple instances.

It would be nice if we could split IDs into n groups of up to 10,000 each, and let multiple workers take one group at a time and process them concurrently... With that idea in mind, I will redesign the follower structure around this requirement.


- Redesigning the follow operation
First, I changed the followDB schema so that a user's group_id is added when they follow someone.

followDB
{
  id: "maga_fan1",
  follow_id: "trump",
  group_id: 1
}

There are two ways to create this group_id: sequential assignment and hash assignment. Sequential assignment literally means registering the first 10,000 follow requests into group 1, then assigning the 10,001st follower onward to group 2. Hashing means hashing the user's own ID into a unique number and distributing based on that.
Putting 100 million records into a single DB is extremely inefficient, so the first thing the structure needs is horizontal partitioning with follow_id and group_id as the partition keys, so that an actual query only accesses a single instance.

Sequential assignment has the advantage that even the 99% of small-scale influencers can maintain the same follow structure under the same rule, but it has the drawback that when deleting, the group_id I belong to must be sent along. Otherwise, the query has to be sent to every horizontally partitioned DB instance.
The hashing approach is convenient for registration and deletion because group_id can be calculated from the ID itself, but it has a much bigger drawback: even IDs with a small number of followers end up having small groups spread across every DB instance, which makes queries inefficient.
So here I will choose sequential assignment and refine the structure a bit more.

For assigning group_id sequentially, the ideal approach would be to fetch the most recently used group_id, check whether the number of people in that group_id has exceeded 10,000, and if it has, return the next group_id. But if we think about it from another angle, when a user who followed long ago unfollows, the number of IDs in a group that used to be filled up to 10,000 will only keep decreasing, right?
This can use a solution similar to memory fragmentation. We could create a new DB that manages group_member_count, put that group_id back into it on unfollow so it can be reused, or use a strategy where a cron job runs periodically and merges/reorganizes groups that have fallen below a certain size. Here, I will briefly include only the additional DB schema used for the former approach. Since the order does not matter and only the number of IDs is needed, it should not get more complicated than this.

group_member_countDB
{
  id: "trump",
  group_id: 5,
  count: 9433
}

Whenever someone follows or unfollows Trump, we can increment or decrement the count field in this record. Since the raw data already exists and the value does not necessarily need to be exact, it would also be fine to implement this as a cache, though using a cache has the downside that you need to define a separate recovery strategy.

Going back to the case where someone follows Trump again, that user must either use an empty group_id or the most recently used group_id, so it would be useful to record the most recent group_id somewhere. Since we only need one of these per follow_id, I will create one more table.

recent_groupDB
{
  id: "trump",
  recent_group_id: 5,
  max_group_id: 20
}

Now. To summarize the improved follow operation so far: fetch the recently used group_id, check the count for that group_id in group_member_countDB, use it as-is if it has not exceeded 10,000, and if it has, fetch another group_id whose count is below 10,000. If no such group exists, increment max_group_id and create the 21st group, then use that. Afterward, recent_groupDB also needs to be updated.

I wrote it roughly above, but in actual code, you should not simply fetch any group_id whose count is below 10,000. If one user unfollows and a group_id with 9,999 members gets returned, you would fill one slot and then immediately have to switch again. So for values like this, it is better to use a threshold rather than keeping it equal to the maximum. Personally, I would probably set the threshold around 7,000.


- Summary of the design for delivering a post to followers
Through this follow structure design, we created sequential groups assigned 10,000 users at a time, and now we can use that to fetch a list of 10,000 IDs from a DB horizontally partitioned by group_id.
Once the design reaches this point, the next step is the usual service broker pattern: put as many jobs into the worker queue as there are group_ids, then let push workers take those jobs, fetch the ID list for the corresponding group_id, and send push notifications.

I also thought about a few other improvements that are not applied here. One is to split group_ids by SNS usage frequency into enthusiastic users, active users, and dormant users, then increase push processing priority depending on that type.
Enthusiastic users (people who visit around five times a day) are probably sensitive to notification speed, so you would give them higher priority and deliver the notification even a few seconds faster. Dormant user groups could be processed gradually when workers have a little more spare capacity.
And since followers are all over the world, if push messages are grouped and sent by zone based on the country where users connected from, latency would decrease and failure correlation would also be reduced, which would be good.

However, the design would become more complicated than it is now, so I will leave those at the idea level for now and next look at the optimization design for the delivery method.


- Optimizing the delivery method
If we think through what data needs to be sent to followers one item at a time, there is the follow ID, the post, the follower ID, the time, and then the remaining numeric data (views, replies, retweets, likes, bookmarks).
Among the data to send, the post is the longest string, and there are many string compression methods (basic Huffman coding or LZW, which uses a dictionary of registered words, and so on), but here I will assume that an English 140-character post is delivered as-is without compression.

If the data is serialized as binary, the packet size shrinks a lot, but it requires dedicated decoding logic, so it is not general-purpose. Therefore, it is ideal to deliver it in JSON format, which can be interpreted anywhere. In that case, it is better to force-convert the text in the post so that it consists only of visible characters.
For example, ASCII code 22 is the SYN transmission control character, and because JSON is sent after serializing strings (JSON.stringify), the size can end up being very different from what I expected. Let's look at the code below.

var a = "ab\x16cd";  // char: 22
var b = JSON.stringify(a);
console.log(a, a.length, b, b.length)
// abcd 5 "ab\u0016cd" 12

The commented part is the actual output. A 1-byte control character that does not appear even when printed in a string expands to 6 bytes after being unfolded by JSON serialization.
One reason it is changed like that is that if control characters appear inside non-binary text, a firewall or proxy may treat the packet as a hacking attempt or abnormal data and block it. So the JSON standard converts control characters into Unicode sequences (\uXXXX). If you do not want that, the common approach is to convert to base64 before storing and transmitting.

If those control characters are allowed, the client may count it as 140 characters, but after actual serialization it can grow by up to 6x (720 bytes). So when limiting the number of characters, whether special characters such as line feeds are included can have a sensitive impact on the maximum character count.
That said, these days 2-byte Unicode is usually treated as the default, so in most cases storage space will be allocated as roughly character count * 2 bytes.

Going off on a tangent for a moment, while testing JSON serialization, I found something interesting: ordinary non-display control characters are converted into Unicode form, but some control characters are converted into a slightly shorter form.
The example below tests with a carriage return character, and you can see that unlike the previous value b, this control character does not come out in Unicode form.

var c = JSON.stringify("ab\x0Dcd");  // char: 13
console.log(c, c.length);
// "ab\rcd" 8
var b = JSON.stringify("ab\x16cd");  // char: 22
console.log(b, b.length);
// "ab\u0016cd" 12

So I looked at the related RFC document, and specific control characters have a separate conversion table rather than being converted to Unicode. Tab characters, line feeds, backspace characters, and so on.
https://datatracker.ietf.org/doc/html/rfc4627.html#section-2.5
Since they are often used and are essential for displaying the entered text as-is, it makes sense that they are handled separately, but I thought it was a small yet very detailed point.


Anyway, returning to the main topic, one of the main reasons the overall packet, including the maximum string length, should not be variable is to prevent packet fragmentation.
We need to send 100 million messages, and if the size slightly exceeds the router's MTU, packet fragmentation will occur, doubling the number of transmissions and adding split/reassembly cost. The bigger problem is that this is a hidden cost that only becomes visible after deep monitoring.
So at the design stage, we should set the maximum usable capacity within the MTU and decide the number of fields, whether to compress, and so on based on that.

Most network equipment uses 1500 as the MTU (Maximum Transmission Unit), though I have heard that very old systems or some embedded systems use values in the 500 range.
MTU is a value at the layer 3 IP layer, so at the actual TCP layer, you need to subtract the 40 bytes used by the IP header + TCP header and fit within 1460.
This value is called MSS (Maximum Segment Size). During the TCP handshake, the client receives it from the server and automatically splits data accordingly, which helps minimize fragmentation at the IP layer. (For more details on the TCP handshake, see here.)
https://frogred8.github.io/docs/033_tcp_3-way_handshake/

However, it is better to leave some margin from that value. Previously it was just IP header + TCP header, but with a VPN connection, the system header capacity grows to IP header + VPN header + (original IP header + TCP header), so fragmentation can occur at the IP layer in a VPN environment.
For reference, UDP does not use MSS, so if you send a payload larger than the MTU, fragmentation occurs at the IP layer. For UDP, it is better to reduce the payload size more conservatively.

You can easily test the MTU of public equipment with ping. Just add the data size to the ICMP message and enable the unfragment option.

$> ping google.com -D -s 1472

The reason this MTU test uses 1472 instead of 1500 is that ICMP messages are at the IP layer, and the IP header + ICMP header size is 28 bytes.
You can test by increasing that value little by little, but usually anything larger than that will fail with a Message too long message. Since traffic on the public Internet passes through so much equipment, you can assume every device is effectively fixed at 1500.

That said, a technology called jumbo frames can use an MTU of 9000 or more, but this is only possible when both sending and receiving equipment support it. So it is usually only possible on internal networks.
I heard that AWS EC2 applies jumbo frames by default, so instances in the same group can use them. If you exchange a lot of internal data, it may be worth checking the MTU once with ifconfig.
https://aws.amazon.com/ko/blogs/tech/aws-mtu-mss-pmtud/


- Design specification
Based on this design, I will estimate the number of services and the traffic needed for one Trump post.
The data delivered to each individual follower includes an ID, message, time, and four or five other data fields (views, etc.). Taking into account the size increase during JSON serialization, I will roughly calculate this as 500 bytes.

Since Trump has 100 million followers, there would be 10,000 groups, each filled with around 10,000 people. If one push service has a TPS of 5,000, then to process 10,000 groups within 10 seconds, you would need 2,000 push service instances dedicated to Trump.
The total occupied time is 20,000 seconds, or about 5 hours and 30 minutes. In other words, if you processed it with a single push instance, that is about how long it would take.

Let's look at the traffic from the internal/external perspective.
Internally, this data has to be delivered for each group, so the amount of data an individual push service needs to take is 500 bytes * 10,000 groups, which produces around 5 MB of traffic.
For this, you need to calculate the maximum bandwidth based on the latency target defined above. If we use 10 seconds, then around 500 KB of internal bandwidth per second is needed.

For external traffic, if each push service sends the 500 bytes it received to 100 million people, the result is a large number: 50 GB. Converted into bits, the full transmission requires 400 Gbit.
A typical building backbone uses a 10 Gbps network, but AWS says that through LAG (Link Aggregation Group), one backbone line uses 400 Gbps by combining four 100 Gbps lines. They have many of these lines, and since this is from 2023 material, it is probably even more enormous now.
https://aws.amazon.com/blogs/networking-and-content-delivery/growing-aws-internet-peering-with-400-gbe/

Anyway, since the traffic required to deliver to all followers is 400 Gbit, even if you used an entire 10 Gbps line by yourself, it would take at least 40 seconds. At this point, it is at the level where you would need to lease a dedicated backbone line separately.
However, the external traffic here would not all leave from a single zone; it would be distributed globally. So if it were roughly distributed across 10 zones, it could be reduced to 4 seconds on 10 Gbps.
If the maximum notification latency were increased to 10 seconds, leasing only a 5 Gbps external bandwidth line might be enough. But if external bandwidth is limited to 1 Gbps, you should assume there is no way to transmit it within 40 seconds.

Once the design is roughly complete up to this point, when discussing the final document with other teams, you would provide scenarios for maximum notification latency such as 10 seconds, 50 seconds, and 500 seconds (including the number of push service instances and backbone bandwidth required for each time). The maximum value of the most expensive resource would then become the basis for deciding the latency.
If the planning team says, "It absolutely has to be delivered within 10 seconds!" you can immediately hand them the bill. (Yes, then we need to expand the backbone network, and it will cost this much more to maintain N instances, and blah blah blah.)


- Architecture actually in use
After finishing the whole post, I looked up how X actually implements this, and this article explains it the best.
https://medium.com/@kaur.exe/5239256c4234

To summarize it roughly, X uses a hybrid strategy. For ordinary users, posts are sent by push, but posts from heavy influencers are stored only in that influencer's own timeline. Then, when a follower views their timeline, X uses a pull approach that combines that person's own timeline with the timelines of the heavy influencers they follow.
If I receive a notification for a Trump post, I can assume it is probably because the background process pulled my timeline and discovered that Trump's timeline had been updated. (I do not use SNS, so I am not sure whether it actually works that way...)

And the paper below briefly describes the feed architectures of other SNS services (Facebook, Instagram, etc.), and it is interesting that their design goals differ slightly. I included a screenshot of just that page.
https://www.ijcaonline.org/archives/volume179/number48/sudhakaran-2018-ijca-917224.pdf


- Conclusion
1) Propagating posts from heavy influencers on SNS consumes enormous resources.
2) In a real service, a hybrid strategy that accounts for the user interface is more advantageous than attacking the problem head-on.
3) It would also be interesting to think more about ways to send as few messages as possible, reuse data, and use caching.
4) I thought I would just think about this briefly because I got bored while reading the book, but it ended up getting pretty long...

Previous post: https://frogred8.github.io/
#frogred8 #design

</pre>
<br>
<img src="https://i.imgur.com/HekAYTo.png">
