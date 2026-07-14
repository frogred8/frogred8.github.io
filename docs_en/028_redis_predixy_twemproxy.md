---
layout: page
title: "[redis] Analysis of implementing multi-key commands in a proxy"
date: 2023-07-30
---

<pre>
As many of you know, Redis is one of the in-memory cache storages used with a key-value structure. Redis can be configured as a cluster, but in practice it is often used with a proxy object in front of it. That is because it has many advantages, such as load balancing, ACLs, and connection management.

Among these Redis proxy objects, the most widely used are predixy and twemproxy. The proxy's role is simply to hash a key and send the command to the instance that should execute it. You can think of it as the concept of sharding.

That led me to a simple question. If you look at the predixy and twemproxy documentation, they support commands like mset and del, where multiple keys can be included in a single command. The reason this seemed strange is this. Suppose you send the command below.

del a1 a2 a3 a4

It is a simple command that deletes the keys a1, a2, a3, and a4, but those keys are scattered across multiple instances, so unlike other commands, it is not something that can be completed by simply forwarding it to a single instance, right? I was curious how each proxy implementation solves this.


- predixy
First, I will look at predixy. It is written in C++ and supports Redis Sentinel/Cluster. Its initialization and other logic are relatively concise.
https://github.com/joyieldInc/predixy

The number of worker threads can be adjusted in the config file, and the Handler class implements the logic that actually runs in each thread like this.

bool Proxy::init() {
  ...
  for (int i = 0; i < mConf->workerThreads(); ++i) {
    Handler* h = new Handler(this);
    mHandlers.push_back(h);
  }
}

int Proxy::run()
{
  for (auto h : mHandlers) {
    std::shared_ptr&lt;std::thread> t(new std::thread([=](){h->run();}));
    tasks.push_back(t);
  }
  ...

If we check the run() function here, it has a typical worker thread loop structure.

void Handler::run()
{
  Request::init();
  Response::init();
  refreshServerPool();
  while (!mStop) {
    mEventLoop->wait(100000, this);
    postEvent();
    refreshServerPool();
    checkConnectionPool();
    ...
  }
}

The mEventLoop object there handles events. Usually this would be generalized through an abstract class interface and polymorphism, but here the event handler is specified directly in the Makefile at compile time.

# Makefile
...
ifeq ($(EV), epoll)
	multiplexor = EpollMultiplexor
	Opts += -D_EPOLL_
else ifeq ($(EV), poll)
	multiplexor = PollMultiplexor
	Opts += -D_POLL_
else ifeq ($(EV), kqueue)
	multiplexor = KqueueMultiplexor
	Opts += -D_KQUEUE_
endif

And each individual class uses typedef to set the same Multiplexor class name, so the actual class implementation changes depending on the Makefile option.

# EPollMultiplexor.h
...
typedef EpollMultiplexor Multiplexor;

Returning to the thread function, the mEventLoop variable running in the thread earlier is declared as Multiplexor*. Looking at the epoll case, it is wrapped like this.

template&lt;class T>
int EpollMultiplexor::wait(long usec, T* handler)
{
  int num = epoll_wait(mFd, mEvents, MaxEvents, timeout);
  for (int i = 0; i < num; ++i) {
    Socket* s = static_cast&lt;Socket*>(mEvents[i].data.ptr);
    ...
    handler->handleEvent(s, evts);
  }
}

In the end, all events are received through calls to handler->handleEvent(), and that function handles them by dividing them into three types.

void Handler::handleEvent(Socket* s, int evts)
{
  switch (s->classType()) {
  case Socket::ListenType:
    handleListenEvent(s, evts);
    break;
  case Connection::AcceptType:
    handleAcceptConnectionEvent(s,evts);
    break;
  case Connection::ConnectType:
    handleConnectConnectionEvent(s,evts);
    break;
  ...
}

The first is a connection request, the second, AcceptType, is an event sent from the connection to the client connected to this proxy, and ConnectType refers to events from the Redis cluster server connected to the proxy. Once already connected, a normal command proceeds in this order.

1. An AcceptType event is delivered from the client connected to the proxy (get, set, etc.)
2. The key is hashed to determine which Redis it should go to, and then the command is sent to that Redis
3. The response to the command sent to Redis is received as a ConnectType event
4. The request event to send the processing result to is found, and the result is delivered through the socket connected to the corresponding client

Then how are commands that allow multikeys branched? That depends on the type of each Redis function declared in predixy. Commands like get and ttl are declared only as the Read type, while mget is declared as Read|MultiKey. del can also receive multiple keys, so it is Write|MultiKey.

Now that it seemed enough to search based on that MultiKey property, I searched hard, but the logic path was too long, so here I will only explain the rough flow when an event arrives.

1. When an event comes in from a client, the RequestParser object parses it
2. If the parsed command's properties include MultiKey, it is declared as the leader in the current req object
3. Using a preset GenericRequest, events are created for each Redis client according to the number of arguments
ex) mget a1 a2 a3 -> mget a1, mget a2, mget a3 creates three
4. The corresponding event is delivered to the Redis cluster matching each key
5. The contents received as event responses are accumulated in the leader object declared in step 2
6. Once all responses have arrived, the result is returned to the client that made the request

So I was able to confirm that when predixy receives such a multikey command, it creates as many commands as there are arguments and forwards them to the individual Redis clusters.


- twemproxy
It is also known by its old name, nutcracker. It is written in C and supports memcached and Redis. It is a proxy more widely known for being used at Twitter. Since there had been no updates after 2015, I had moved over to predixy, but it looks like something was released two years ago.

Perhaps because twemproxy is a library released by a big tech company, both the quantity and quality of the documentation are good, and the code and structure are also quite clean. In particular, another advantage is that, unlike C++, it is not plastered with templates, so it is easier to follow the code. Now, looking at the code,

void req_recv_done(...)
{
  ...
    /* do fragment */
  status = msg->fragment(msg, array_n(&pool->server), &frag_msgq);

That fragment is a function pointer, and the connected function is set differently during initialization depending on whether it is memcached or Redis. Since this is Redis, if we look at the connected part,

rstatus_t redis_fragment(...)
{
  switch (r->type) {
  case MSG_REQ_REDIS_MGET:
  case MSG_REQ_REDIS_DEL:
  case MSG_REQ_REDIS_TOUCH:
  case MSG_REQ_REDIS_UNLINK:
    return redis_fragment_argx(r, nserver, frag_msgq, 1);
  case MSG_REQ_REDIS_MSET:
    return redis_fragment_argx(r, nserver, frag_msgq, 2);

Now we will look at the redis_fragment_argx function that gets called again. That function is divided into two parts: parsing and req creation. I will look at parsing first.

rstatus_t redis_fragment_argx(...)
{
  ...
  for (i = 0; i < array_n(keys); i++) {
    struct msg *sub_msg;
    struct keypos *kpos = array_get(keys, i);
    uint32_t idx = msg_backend_idx(r, kpos->start, kpos->end - kpos->start);
    if (sub_msgs[idx] == NULL) {
      sub_msgs[idx] = msg_get(r->owner, r->request, r->redis);
    }
    r->frag_seq[i] = sub_msg = sub_msgs[idx];
    sub_msg->narg++;
    status = redis_append_key(sub_msg, kpos->start, kpos->end - kpos->start);
    ...
  }

The logic is simple. It breaks down the received parameters, finds the server index to which the command should be delivered, and sequentially accumulates those parameters into sub_msgs using the redis_append_key function. Once the sub_msgs to be delivered to each server have been accumulated like this, it now needs to loop and create requests.

for (i = 0; i < nserver; i++) {
  struct msg *sub_msg = sub_msgs[i];
  if (r->type == MSG_REQ_REDIS_MGET) {
    status = msg_prepend_format(sub_msg, "*%d\r\n$4\r\nmget\r\n", sub_msg->narg + 1);
  } else if (r->type == MSG_REQ_REDIS_DEL) {
    status = msg_prepend_format(sub_msg, "*%d\r\n$3\r\ndel\r\n", sub_msg->narg + 1);
  } ...

If you look inside the msg_prepend_format function, it is just a wrapper around vsnprintf, and in this way it creates the command set to send to each server. Then sending the generated commands below is the end of it.

for (sub_msg = TAILQ_FIRST(&frag_msgq); sub_msg != NULL; sub_msg = tmsg) {
  tmsg = TAILQ_NEXT(sub_msg, m_tqe);
  TAILQ_REMOVE(&frag_msgq, sub_msg, m_tqe);
  req_forward(ctx, conn, sub_msg);
}

void req_forward(...)
{
  s_conn = server_pool_conn(ctx, c_conn->owner, key, keylen);
  status = event_add_out(ctx->evb, s_conn);
  ...

It loops over the number of sub_msgs, obtains the Redis connection to which that command should be delivered, sends the command accumulated in each sub_msg to it, checks the response through the response function, and once all responses have been received, delivers them to the client. (This is the same as predixy)

Looking at the difference from predixy earlier, when the command was mget a1 a2 a3, predixy created and sent mget a1, mget a2, and mget a3 separately, right? twemproxy is a little smarter and gathers the commands to send to each server, then sends them all at once.
If a1 and a3 are hashes that point to the same server, it would create and send only two commands: mget a1 a3 and mget a2.


- Conclusion
1) predixy recreates and forwards as many commands as the number of keys passed to a multikey-type command.
2) twemproxy creates the commands to send to each server as a single command set, so at most it creates only as many commands as the number of servers.
3) twemproxy may be more efficient for multikey commands, but in general benchmarks predixy has the advantage
https://github.com/joyieldInc/predixy/wiki/Benchmark
4) I considered analyzing codis as well, but excluded it because there have been no updates since 2018

Previous post: https://frogred8.github.io/
#frogred8 #redis #predixy #twemproxy
</pre>
