---
layout: page
title: "[network] The secrets of the dns root signing ceremony"
date: 2026-01-18
---

<pre>
Every now and then, you may have wondered how the world's Internet is structured. The authentication and renewal of the topmost root DNS layer is not very widely known, and when I looked into it, I found a lot of interesting material, so I organized it here.


- Brief overview
First, you need a basic understanding of DNS to make sense of what follows, so I'll briefly explain the process of obtaining an IP address for the domain auth.xxx.com.

1. Send the domain to the DNS server configured on the network
- ISP DNS, 8.8.8.8(Google), 1.1.1.1(Cloudflare)...
2. The DNS server that receives the client's request is also called a recursive resolver(RR). As the word "recursive" suggests, it is responsible for sending requests down the DNS hierarchy in order, then repeatedly making new requests based on the responses it receives, and finally delivering the DNS query result back to the client.
3. Query the root name server(root server)
- Returns the address of the next-layer TLD server, categorized by .com, .net, and so on, to the RR
- Example) [a-m].root-server.net (13 servers)
4. Query the TLD(Top-Level Domain) server
- Returns the address of the name server where the xxx.com domain is registered to the RR
- Example) gTLD, ccTLD..
5. Query the authoritative name server
- Returns the IP address connected to auth.xxx.com within the xxx.com domain to the RR
- Example) route53, cloudflare, google dns..
6. The RR returns the final IP to the client

The topic of this post is how the DNSSEC signing keys and signature renewals are handled for the root servers and TLD servers that appear in steps 3 and 4. 
Usually, when an individual or company creates a domain certificate, they use the tools provided by the company where they purchased the domain(ex. Gabia, GoDaddy..) to connect and register the domain and IP. Then let's briefly imagine how root and TLD servers are handled. 
Does some Internet address management organization(ICANN, IANA, etc.) simply set a schedule, say, "Oh, time to renew it now," click a button, and call it done? How far does distribution go? And so on..
I'll go through that one by one now.


- Key Signing Key (KSK)
The KSK is the signing key with the highest authority. It is used to sign and authenticate the ZSK(Zone Signing Key), which I'll explain next.

It was first applied in 2010, when they created and used what was called KSK-2010. Then, in 2018, it was renewed to KSK-2017, which is still in use today. They say it will be renewed to KSK-2024 at the end of 2026. Roughly speaking, it gets renewed once every 7 or 8 years. But looking at the 2025 meeting minutes, after this renewal they are now planning a KSK rollover every 3 years, so it will happen more often than before. 

ICANN calls this work a KSK rollover, and it takes more than a year from the initial planning to actual application. That's because when this root key is renewed, the new root key must already be applied in advance to every root and TLD server, as well as to DNS servers that perform DNSSEC validation(Cloudflare, Route 53, etc.).
If there is a DNS server that continues to use only the old key even after the rollover, DNS responses from that server will fail validation. That could lead to what people might call an Internet meltdown. So preparation by major DNS servers around the world is essential, and during the first rollover(KSK-2017), there must have been all kinds of issues, because the actual application was delayed by almost a year from the originally planned date. 


- Zone Signing Key (ZSK)
The ZSK, created with a signature from the KSK, is generated and used for each specific TLD(.com) server. The role of the ZSK is to serve as a core key responsible for data integrity in the DNSSEC(Domain Name System Security Extension) hierarchy. In other words, DNS records registered on TLD servers are signed with the ZSK.
That said, the ZSK alone does not form the chain of trust(also called the trust anchor). For final authentication, a chain of trust that uses both the KSK and ZSK is applied. 


- Overview of the root signing ceremony
If you think of the root signing ceremony simply, it is just a task for renewing cryptographic keys, so why use such a grand expression as Key Signing Ceremony?
The reason is that this is not a task carried out on a single secure computer. 
The signing ceremony is held under strict physical security, alternating between data centers in the eastern United States(Virginia) and the western United States(California). Needless to say, those data centers have top-tier security. (fingerprint recognition, multiple gates, and so on)


- Members of the root signing ceremony
Various people are needed for the signing ceremony, but the core participants are 21 carefully selected Internet security experts from around the world called Trusted Community Representatives(TCRs). Since these people handle the Internet's master key, the selection criteria are extremely strict. A separate committee selects them after carefully examining not only deep infrastructure knowledge, which is a given, but also political neutrality, past criminal history, ethics, and more.

Not all 21 people have the same role. For each data center(eastern and western United States), 7 people are assigned the role of Crypto Officers(COs), and the data centers take turns holding the signing ceremony. The remaining 7 people serve as Recovery Key Share Holders(RKSHs).
RKSHs are people who hold fragments of a recovery master key in preparation for a catastrophe in which both data centers are destroyed. They are selected from security experts around the world. For reference, at least 5 of them must gather to recover the root key.


- How the root signing ceremony proceeds
The COs' role is simply to manage the master keys needed to authenticate the HSM(Hardware Security Module) that contains the KSK. The actual preparation of the signing ceremony's foundation, communications, and so on are led by IANA. In addition to the COs, 20 to 30 people participate, including internal/external witnesses, the ceremony administrator, vault(HSM) managers, and security teams. It is literally a Ceremony, a ritual.

The signing ceremony usually takes 2 to 4 hours, and from the moment the participants enter the special meeting room(Ceremony Room), every step begins to be recorded on video. The actual proceedings are led by IANA's ceremony administrator, who reads through a checklist-style procedure document one step at a time. These documents and other materials are all published on the web, including command logs from the computer. They even livestream the proceedings on YouTube, record them, and later upload the recorded video file so that anyone can watch it. (link attached at the end)
https://youtu.be/K590t6szNLI

Now I'll take a detailed look at how the signing ceremony proceeds, step by step.


1. When the signing ceremony begins, the double safe is first opened through verification by IANA operations committee members. Inside this safe are a laptop-sized metal box machine called an HSM(Hardware Security Module), storage boxes for the smart cards needed for signing, and the laptop that will be used for renewal during the signing ceremony.
In particular, the laptop stored here is not an ordinary product; it was built strictly for the signing ceremony. When a laptop gets old, the battery can swell or break, right? To eliminate those factors, it operates only through wired power, with no battery. To prevent external communication, it has no modem at all. It also has no internal storage device, and instead boots from a USB prepared separately for each signing ceremony. The hash value of the connected USB is verified once more, and if even 1 byte is different, it reportedly will not boot.
They are so careful that, after a certain period or when equipment is renewed, the storage media used here are physically destroyed so that no operational data can leak outside.

2. Among the things that come out when IANA opens the double safe is a smart card storage box. Each CO has their own key(a real physical key), which they use to open their own box and take out the smart card inside. All the tools needed for authentication are physically isolated through the safe, and when those tools are used, authentication is distributed across multiple people to maintain security in several layers. After the signing ceremony ends, the cards are placed back into the storage boxes, sealed with single-use seals, stored in the safe, and used again at the next signing ceremony.

3. Once a CO has properly retrieved their smart card from the card storage box, they insert the card into a slot on the HSM machine and enter their unique PIN to authenticate to the HSM machine. Once three COs successfully authenticate, the HSM machine is finally ready to carry out the signing work. 
If one CO suddenly cannot attend that day or fails PIN authentication, another CO has to fill the empty spot and proceed, so several backup COs usually attend as well. 
But since people are people, someone could forget their PIN, right? In that case, at the next signing ceremony, they add a procedure to register a new smart card on the HSM and set a PIN. This process is part of the Key Ceremony, and it too is carried out under strict procedures. If I were the person involved, just imagining it makes me dizzy, haha..

4. In any case, once all preparations up to this point are complete, they proceed with the highlight of the signing ceremony: signature renewal.
A KSK rollover is a special situation that happens every 7 or 8 years. In the regular signing ceremonies that usually take place every 3 months, they renew the signatures for TLD(.com, .net, etc.) servers, which are lower in the hierarchy than the root servers.
The HSM, which was prepared through the card authentication mentioned earlier, stores the KSK(root key) private key. As you know, private keys must absolutely be prevented from leaking outside. So when the ZSK request to be renewed is sent from the laptop to the HSM, the HSM authenticates it with the KSK private key and returns only the result containing the signature value back to the laptop. They say that even after a single signing operation finishes, the HSM machine immediately erases and initializes the KSK information that had been loaded into memory. If they want to start another signing operation, they have to go through card authentication on the HSM machine again.

5. The renewed signed certificates are then copied to multiple USB drives, each used for distribution, backup, and archival purposes.
Of course, even this copying is not done by simply issuing a command. Each time something is copied through the laptop, a checksum value is printed, and the witnesses visually check, character by character, that the checksum of the original and the USB copy are identical, confirming that it has not been tampered with.
Among these, the distribution USB is taken by the person in charge and connected to the IANA distribution system. Then the renewed certificates are finally propagated to the 13 root name servers around the world.

6. Once the certificate copies are complete, the log files recorded on the HSM and laptop are backed up, the system is initialized for the next signing ceremony, and the double safe is sealed again.
Then, when the key people(COs, administrators, external observers, etc.) leave their final signatures on a document stating that this process was not manipulated, the long, long root signing ceremony finally comes to an end.


- Sharing the results of the signing ceremony
All materials from the completed signing ceremony are uploaded to a single web page like the one below, where anyone can view them.
https://www.iana.org/dnssec/ceremonies/55

This includes the procedure sequence, HSM & laptop logs, recorded files from 3 cameras, and even the ISO file of the OS used to boot the laptop. All of this exists to prove the transparency of the signing ceremony. I didn't mention this separately above, but the day before the signing ceremony, some participants gather and manage things by checklist as well, including camcorder inspections and recording tests, safe checks, and even cleaning, to make sure the signing ceremony can proceed smoothly and to minimize unexpected situations.
The image attached below is part of a roughly 70-page procedure document for the signing ceremony. If you read the script closely, you can see records of details like who brings whom into the room, who explains what, and at what time.. It really gives the sense that the process is being operated transparently. 


- Checking the actual root key
You can check DNS signatures using the dig command. Below is the command that requests the DNSKEY signature for the root zone and its result. (I abbreviated meaningless values)

$> dig . dnskey +dnssec
...
;; ANSWER SECTION:
[1] .	38549	IN	DNSKEY	257 3 8 AwEAAa96...
[2] .	38549	IN	DNSKEY	257 3 8 AwEAAaz/...
[3] .	38549	IN	DNSKEY	256 3 8 AwEAAbNT...
[4] .	38549	IN	RRSIG	DNSKEY 8 0 172800 20260201 20260111 20326 . o5fb3sEB...

I arbitrarily assigned numbers to each record, so I'll explain using those.
Records 1 and 2 are type 257, meaning KSKs. Record 3 is type 256, a ZSK signed by the KSK. Record 4 is an RRSIG record signed by the KSK. The reason there are two KSKs here is that a rollover is currently in progress, so the KSK that will be renewed in the future is coexisting with the current one. Once the KSK rollover ends at the end of 2026, only one should be visible.

Let's look a little more at the result of RRSIG record 4. It contains an expiration time and a start time, and the value 20326 next to them is important. This value means the ID of the KSK that signed the RRSIG. It is not a unique value assigned when the KSK is generated, but a 16-bit value produced by running the KSK value through a specific hash algorithm. The algorithm is written in the RFC document. 
https://www.rfc-editor.org/rfc/rfc4034#appendix-B

But calculating it every time is hard, right? So if you add multiline to dig, you can also see the calculated ID value of the KSK.

$> dig . dnskey +dnssec +multiline
...
[1] .	42131 IN DNSKEY	256 3 8 (AwEAAbNT...) ; ZSK; alg = RSASHA256 ; key id = 21831
[2] .	42131 IN DNSKEY	257 3 8 (AwEAAaz/...) ; KSK; alg = RSASHA256 ; key id = 20326
[3] .	42131 IN DNSKEY	257 3 8 (AwEAAa96...) ; KSK; alg = RSASHA256 ; key id = 38696
[4] .	42131 IN RRSIG DNSKEY 8 0 172800 (8 0 172800 20260201 20260111 20326 . o5fb3sEB...)

If you look at KSK number 2 there, you can see that its ID is 20326, right? This confirms that the KSK used to sign the RRSIG is that key. The relationship is easier to see on the web, so I attached that as well. The site is here.
https://dnsviz.net/d/www.google.com/dnssec/


- Reflections
When I didn't know much about root key renewal, I only vaguely knew that a few people around the world gathered secretly to renew it, so I started with a light mindset, but there was a lot of material and this ended up getting quite long.
Thinking about it, I wonder how many discussions and how much groundwork must be happening in countless fields I don't know about in order to decide on something like this.
Even if I just briefly think about the IT field, there are all kinds of RFC documents, web standardization work, mirroring of root servers, and so on.. 
Thank you to the people who are contributing to the foundations of industry somewhere even now. Thanks to you, we live comfortably.


- Conclusion
1) The root key, where the Internet's trust chain begins, is renewed through multi-party authentication by experts around the world.
2) The KSK signing ceremony is held once every several years, while the ZSK signing ceremony is held every 3 months, alternating between data centers in the eastern and western United States.
3) The root key is physically isolated in a double safe, and authentication is separated across multiple people around the world, making tampering and theft impossible within the system.
4) It is ironic that the top-level certificate supporting the digital world is verified through the most analog-like procedures and oversight.

Previous post: https://frogred8.github.io/
#frogred8 #network #dns #ceremony

</pre>
<br><br>
참석자 명단과 서명<br>
<img src="https://i.imgur.com/CaY4R0R.png">

<br><br>
서명식 진행 스크립트<br>
<img src="https://i.imgur.com/Cqh3LUx.png">

<br><br>
도식화된 dns<br>
<img src="https://i.imgur.com/wtqnYkg.png">





