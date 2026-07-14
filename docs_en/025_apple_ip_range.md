---
layout: page
title: "[network] How many IP addresses does apple use?"
date: 2023-06-07
---

<pre>
While watching Apple’s announcement yesterday, I started wondering how many IP addresses a global company like that has been allocated and uses. I looked around a bit, found a lot of interesting information, and put together a quick summary. Read it casually.


- Overview
Before getting into the details, let’s briefly go over something everyone already knows.
IP issuance was originally handled by an organization called IANA (Internet Assigned Numbers Authority). As things grew, it was transferred to ICANN (Internet Corporation for Assigned Names and Numbers), and from there it was split again among RIRs (Regional Internet Registries). There are currently five in total: Africa, Asia, North America, South America, and Europe.
https://www.arin.net/about/welcome/region/

So if you count the number of IP addresses allocated to each RIR, it looks like this. Since most of the mega-corporations are in the United States, ARIN, the North American RIR, has as many as 1.66 billion.

AFRINIC(Africa)	115,739,648	(2.7%)
APNIC(Asia)	887,005,696	(20.7%)
ARIN(North America)	1,662,226,432	(38.7%)
LACNIC(South America)	189,931,520	(4.4%)
RIPENCC(Europe)	831,209,096	(19.4%)

And I can’t leave out CIDR (Classless Inter-Domain Routing) notation. In the past, IPs were divided into A through E classes, called IP Classes, but CIDR is a notation that lets you specify ranges at the bit level. The concept is simple enough that you can understand it just from the examples.

1.0.0.0 ~ 1.255.255.255 -> (1.0.0.0/8)
1.30.0.0 ~ 1.30.255.255 -> (1.30.0.0/16)
1.30.128.0 ~ 1.30.255.255 -> (1.30.128.0/17)
1.30.238.0 ~ 1.30.238.255 -> (1.30.238.0/24)
1.30.238.32 ~ 1.30.238.35 -> (1.30.238.32/30)


- Main Content
First, articles about Apple’s IPs say that it has 17.0.0.0/8, so I searched based on that and found that there’s a separate wiki page for /8 blocks. (From here on, for convenience, I’ll write CIDR ranges with the lower zero addresses omitted.)
https://en.wikipedia.org/wiki/List_of_assigned_/8_IPv4_address_blocks

AT&T has 12/8, Apple has 17/8, and other private companies such as Ford, Prudential, Mercedes-Benz, and Comcast have /8 blocks, which used to be called Class A. For reference, a single /8 block contains 2^24 = 16.77 million IP addresses. Some companies later split them up and sold them. (More on that later.)

But did you know that the entity that owns as many as 14 of these /8 blocks is the U.S. Department of Defense? In fact, the original purpose of developing the internet was for the United States to create a safeguard during the Cold War against central server failure caused by nuclear war. To do that, it built a distributed network, and that was ARPAnet, the origin of the internet.

Looking at the wiki page above, the DOD (United States Department of Defense) occupies 14 Class A blocks. If you calculate that, the DOD has a staggering 230 million downstream IP addresses. Since IPv4 can theoretically hold 4.2 billion addresses, that’s 5% of all IPs, and if you exclude pre-reserved IP ranges (0/8, 10/8, 127/8, 240/4, and so on), the practical ratio would be even larger.

I happened to find some interesting material, so I talked about it briefly. Returning to the main topic,
if you search for an IP on the ARIN (American Registry for Internet Numbers) site, you can see which company owns that IP range. If you search for 17.0.0.0, you can confirm that it is registered under the name APPLE-WWNET.
https://search.arin.net/rdap/?query=17.0.0.0

From that link, you can go to the link below, which shows all IPs owned by Apple by company. There are three registered ranges there (one with 16.77 million addresses and two with 256 each), so we can tell that Apple owns about 16.77 million IP addresses through ARIN.
https://whois.arin.net/rest/org/APPLEC-1-Z/nets

But a multinational company like this would also own IP ranges in Europe or Asia outside ARIN, right? Tracking all of those one by one would be very tedious, so I searched further and found a site that retrieves company-owned IP ranges worldwide.
https://networksdb.io/ip-addresses-of/apple-inc

Apple has 376 IPv4 ranges, and the site only shows 100 of them, but it was nice because it also showed IP ranges registered in various countries such as the UK and Germany. However, you have to pay to see the full list. Fortunately, the list is sorted by network size, so I was able to get the rough information I wanted. I figured that the ranges after the first 100 are small blocks anyway, so they wouldn’t affect the overall trend much.

After scraping the webpage, doing some processing, and adding things up, I found that Apple ultimately owns 16.83 million IP addresses. Since the calculation was easy, I got curious about other large companies too and summarized them using the same method.

Apple: 16.83 million
Google: 19.41 million
Amazon: 65 million
Microsoft: 58.3 million
Comcast: 82.9 million
Verizon: 80.01 million

[Domestic]
SKT : 8.71 million
KT : 47.17 million
LG : 7.5 million


But Amazon serves all the ranges it uses in an ip-range.json file. I opened that file to cross-check, and it was structured like this. It was a large file with more than 7,300 IP ranges.
https://ip-ranges.amazonaws.com/ip-ranges.json

{
  "syncToken": "1686021789",
  "createDate": "2023-06-06-03-23-09",
  "prefixes": [
    {
      "ip_prefix": "3.2.34.0/26",
      "region": "af-south-1",
      "service": "AMAZON",
      "network_border_group": "af-south-1"
    },
    ...

Anyway, when I added up this information based on CIDR, it came out to 135 million. Why is the discrepancy so large? I wondered, so I went back to the search site and found that what I had searched for was Amazon, Inc., but in reality there are also Amazon Data Service, Amazon EU, and so on. In other words, I wasn’t able to track IPs that Amazon registered separately due to country-specific subsidiaries or other business needs.

So treat the information summarized here as just for fun. If you want to use it as official data, you’ll need to include everything registered by other related entities too. (Or find an IP range API that kindly tells you, like Amazon does.)


- Price
While collecting the counts, I ended up reading various articles, and IPs were more expensive than I expected.
There aren’t many articles, but if you summarize only the major transactions, they look like this.

2011: When Canadian telecom company Nortel went bankrupt, it sold 660,000 IP ranges to Microsoft for 7.5 million dollars, or 11.25 dollars per IP.
2017: MIT sold 8 million to AWS. (The transaction price is unknown, but based on the timing, it is estimated at 13 dollars per IP.)
2018: General Electric sold a /8 block, 16.77 million addresses, to AWS. (Estimated at 15 dollars per IP based on the timing.)
2019: Amateur Radio Digital Communications (ARDC) sold a /10 block, 4.19 million addresses, to AWS for 1.08 million dollars. 25.74 dollars per IP.

The current price per IP is between 40 and 55 dollars based on APNIC (Asia), but there isn’t much information for other regions. I put the price graph at the very bottom, and the original link is here.
https://blog.apnic.net/2023/01/23/ip-addressing-through-2022/


As I was organizing things to wrap up, I got curious about where the raw data for these transactions is, so I looked that up too. It turns out each RIR manages it as JSON. Inside the yearly folders, there are daily JSON files. In fact, since the data has been continuously appended since 2012, the recent entries are so large that Chrome may crash if you open them, so be careful.
https://ftp.arin.net/pub/stats/arin/transfers/

The data inside looks like this. I found it interesting that Merck (the pharmaceutical company) also had a record of selling IPs, so I brought it here.
{
  "type" : "RESOURCE_TRANSFER",
  "ip4nets" : {
    "original_set" : [ {
      "start_address" : "054.000.000.000",
      "end_address" : "054.255.255.255"
    } ],
    "transfer_set" : [ {
      "start_address" : "054.224.000.000",
      "end_address" : "054.239.255.255"
    } ]
  },
  "source_organization" : {
    "name" : "Merck and Co., Inc.",
    "country_code" : "US"
  },
  "recipient_organization" : {
    "name" : "Amazon Technologies Inc.",
    "country_code" : "US"
  },
  "transfer_date" : "2012-03-01T18:48:00Z",
  "source_registration_date" : "1992-03-17T05:00:00Z",
  "source_rir" : "ARIN",
  "recipient_rir" : "ARIN"
},

Merck originally held the entire 54/8 range, and you can confirm that in March 2012 it transferred the 54.224/12 range (1.04 million addresses) to Amazon. It’s a bit disappointing, though, that because this is data for management by the issuing authority, it doesn’t include prices.


- Conclusion
1) Apple uses 16.83 million IP addresses.
2) The U.S. Department of Defense has 14 /8 blocks. (230 million addresses)
3) If you had been issued IP ranges 20 years ago, you could have made quite a lot of money. (Back then, when a company applied for an IP range, it would be allocated after a “relatively lenient” review. Today, it’s common to buy them on the secondary market.)
4) Today, the IP ranges a company owns make up a non-trivial part of its corporate assets.


Previous post: https://frogred8.github.io/
#frogred8 #network #apple #ip
</pre>
