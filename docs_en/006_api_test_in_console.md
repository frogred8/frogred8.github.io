---
layout: page
title: "[etc] How to test APIs from the console (nc, telnet, curl, httpie)"
date: 2022-05-22
---

<pre>
This time, we’ll go through a few simple ways to test APIs with a web server running. You can test from your own computer using libraries you’re familiar with, but sometimes you need to do it directly on the server, so let’s start with the basics. Here, I’ve started a simple JS server on port 3000 that returns {msg:'hello'}.

1) nc (netcat)
I’ll introduce netcat first because it’s the most basic library. It can do most things that involve connecting by IP and port. Port listening, scanning, and so on. Taking a quick look at the features:

nc -l localhost 3001 (listening on port 3001)
nc localhost 3001 (connect to port 3001)

If you open a port like that and connect from another shell, the cursor just blinks like telnet, and you can send messages there. Another useful feature is port scanning. You can also do it over a range like this.

nc -zvv localhost 2998-3002

localhost [127.0.0.1] 2998 (realsecure): Connection refused
localhost [127.0.0.1] 2999 (remoteware-un): Connection refused
localhost [127.0.0.1] 3000 (hbci) open
localhost [127.0.0.1] 3001 (redwood-broker): Connection refused
localhost [127.0.0.1] 3002 (exlm-agent): Connection refused

-z is used when you only want to check whether a connection is possible, and -v is an option for seeing more detailed output. (vv is even more detailed.)
For reference, the hbci shown next to port 3000 is the application registered for that port in IANA, so just keep that in mind.
https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml

Anyway, since we’re testing a connection to a web server, if you connect, the cursor will just blink. Type GET / and press Enter twice, and you’ll get something like this. (If you look at the HTTP RFC, you know that’s how the interface protocol is defined, right?)

root@4b9330a3e502:/# nc 192.168.0.6 3000
GET /

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:21:53 GMT
Connection: close

{"msg":"hello"}

But typing that by hand every time you connect is annoying, right? So you can automate it with echo and a pipe.

root@4b9330a3e502:/# echo -e "GET /\r\n\r\n" | nc 192.168.0.6 3000
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
...


2) telnet
Telnet is somewhat similar, but with this one you can also connect from its internal shell. Once you connect with telnet, you can type GET / just like with nc.

root@4b9330a3e502:/# telnet 192.168.0.6 3000
Trying 192.168.0.6...
Connected to 192.168.0.6.
Escape character is '^]'.
GET /

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:25:47 GMT
Connection: close

{"msg":"hello"}Connection closed by foreign host.

However, because the default is HTTP/1.0, the connection is one-time only. If you send it as HTTP/1.1, it changes to keep-alive, but the default is 5 seconds, which is a bit short for typing the next command, so it closes quickly.

root@4b9330a3e502:/# telnet 192.168.0.6 3000
Trying 192.168.0.6...
Connected to 192.168.0.6.
Escape character is '^]'.
GET / HTTP/1.1

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:31:04 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"msg":"hello"}Connection closed by foreign host.

If you exit with ^] while using telnet, you enter the telnet command line, where you can connect to web pages again or do various other things, but we won’t use that, so you can just exit. (^c or quit)

I also learned something new while doing this. I thought keep-alive was a client-side spec, but it turns out it was server-side. If you think about it just a little more deeply, it’s obvious, but anyway. You can configure keep-alive like this. (Here, JS and Express)

const express = require('express');
const app = express();
const port = 3000;
const server = app.listen(port);
server.keepAliveTimeout = 60 * 1000;


Now let’s send a POST.

root@4b9330a3e502:/# telnet 192.168.167.76 3000
Trying 192.168.167.76...
Connected to 192.168.167.76.
Escape character is '^]'.
POST /accounts
Content-Type: application/json
Content-length: 24

{"name":"pupu","age":11}
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 26
ETag: W/"1a-jJ7tWy+vDtgdXAlx0uVXP3y0y4g"
Date: Sun, 22 May 2022 12:55:22 GMT
Connection: close

"added (pupu/11)"

POST is a bit tricky. First, you need to add json to the content-type header and specify content-length. If you don’t specify the length, it gets sent the moment you press Enter twice. But if you set the length shorter than the actual body, parsing fails on the server, and if you set it longer, it won’t send until you input that much, so having to count the exact number of characters is a little annoying. The usage is the same with nc, so I won’t write it again.


3) curl

But nc and telnet are too primitive, right? Typing everything every time is tiring, and counting the length is even more annoying. So let’s look at curl, which is commonly used. We’ll look at GET / and POST /accounts together.

root@4b9330a3e502:/# curl 192.168.167.76:3000
{"msg":"hello"}

root@4b9330a3e502:/# curl 192.168.167.76:3000/accounts -X POST -H "Content-Type: application/json" -d '{"name":"pupu","age":22}'
"added (pupu/22)"

Looking mainly at the commonly used options, for GET you can just type it like in a browser and it fetches the response automatically, but for POST you need to specify the method with the -X option. For PUT, it would be -X PUT. You add headers with -H "~~" and fill the body with -d. Here, you don’t have to set the length, which is really nice.

4) httpie

This isn’t a default command, so you need to install it separately, but I mostly use this in my local terminal. Let’s look at GET and POST together here too.

root@4b9330a3e502:/# http 192.168.167.76:3000
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 15
Content-Type: application/json; charset=utf-8
Date: Sun, 22 May 2022 13:18:49 GMT
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Keep-Alive: timeout=60
X-Powered-By: Express

{
    "msg": "hello"
}

root@4b9330a3e502:/# http 192.168.167.76:3000/accounts name=pupu age=33
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 17
Content-Type: application/json; charset=utf-8
Date: Sun, 22 May 2022 13:19:04 GMT
ETag: W/"11-QHZiqu8kcX+/YIBoCd9o5mMlTUk"
Keep-Alive: timeout=60
X-Powered-By: Express

"added (pupu/33)"

Here, even without setting POST separately, if you add variables after the request like that, it sends them as JSON automatically, which is convenient. If you want to send it in JSON format, you can use the --raw option and send it like curl. The response is also colored, so it’s easy to read.


Usually from the command line I only do something like a ping check, but sometimes I want to send a POST from the terminal, so I wrote this all up. I also occasionally use the nc -l feature to check a server’s ACL in advance.

When working, I usually use Postman for testing, and its automation features are pretty good. If you group requests like login, account creation, and data input into one collection and add a little script, you can save the login token with one click, set up the basics, and send the request you want. This is on the Postman site and all over the place, so look it up. You can probably automate testing for most things with it.


Conclusion)
1) nc has more features than you might think
2) httpie is awesome
3) I recommend studying Postman automation


I was a bit busy this week because I went traveling. Gongju Fortress was bigger and taller than I expected. My legs were shaking the next day.
There isn’t much left of it, but have a great weekend!

#javascript #api_test #httpie
</pre>
