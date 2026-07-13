---
layout: page
title: "[javascript] Analyzing the keepAlive implementation"
date: 2022-06-01
---

<pre>
Previously, I looked into how to test APIs for each command, and while using that, I got curious about how alive is implemented. The reason is that I tried changing keepAliveTimeout on the server side, and one post said that keepAliveTimeout and headersTimeout have to be changed together. But when I actually tried it on Node 18, changing only keepAliveTimeout was applied just fine.

So I looked a bit more into that "rumor," and it turned out to be workaround code written when there was a bug in 2019 that has kept being passed down like a legend. https://github.com/nodejs/node/issues/27363#issuecomment-603489130

Separately from that, I figured an automatic connection close would probably use timer objects, but I also wondered whether it might be handled by some other specialized system, so I dug into it a little this time.


First, I need to get the Node code, right? I simply cloned it with git clone https://github.com/nodejs/node.git and compiled it as shown below, following the guide.

> xcode-select --install
> ./configure
> make -j4
> sudo ./tools/macos-firewall.sh

That completes the Node build~ It looks like you can also build in debug mode with ./configure debug, but I did not need to go that far, so I just went with a release build.

Since the project is large, make takes quite a while. On an M1 Air, it took more than 20 minutes. Anyway, once it is built, you can run it with ./node. (After doing all that, I realized just following the code by eye was enough, so it was not really necessary..)

Anyway, now that the preparation is done, shall we look at the code? Node's http module is mostly written in JS, and the parts that connect to libuv functions are mainly implemented as internal functions. The Server class is in the _http_server.js file.

function Server(options, requestListener) {
  storeHTTPOptions.call(this, options);
  if (requestListener) {
    this.on('request', requestListener);
  }
  this.on('connection', connectionListener);
  ....

This code applies the options received by the constructor through the storeHTTPOptions function, and sets it up so that connectionListener is called when a connection is completed.

If you follow that listener function, there are also parts that initialize event handlers on the socket and set up the parser, but they do not affect the main flow, so I will skip them and look only at the important parts.

function connectionListenerInternal(server, socket) {
  if (server.timeout && typeof socket.setTimeout === 'function')
    socket.setTimeout(server.timeout);
  socket.on('timeout', socketOnTimeout);
  ....

Here it calls setTimeout on the socket. This is set as a prototype function in the net.js file, and the connected function is declared in the stream_base_commons.js file.

Socket.prototype.setTimeout = setStreamTimeout;

function setStreamTimeout(msecs, callback) {
    ....
    this[kTimeout] = setUnrefTimeout(this._onTimeout.bind(this), msecs);
    if (this[kSession]) this[kSession][kUpdateTimer]();
  }

That kTimeout is a unique key registered as a symbol, and since this is the socket object, in the end you can think of it as registering one timer per socket under the kTimeout key using setUnrefTimeout. Here it binds the _onTimeout function, which will be called at the very end, so let's keep that in mind for now. Then we should look at the connected function, right?

function setUnrefTimeout(callback, after) {
  const timer = new Timeout(callback, after, undefined, false, false);
  insert(timer, timer._idleTimeout);
  return timer;
}

Here it creates a Timeout object and receives a timer. The Timeout class constructor only does some value initialization, so I will skip that. This time, I will look at the insert function and the global variables used there, and this part is a bit long. It is the most important part of timer registration.


let nextExpiry = Infinity;
const timerListQueue = new PriorityQueue(compareTimersLists, setPosition);
const timerListMap = ObjectCreate(null);

function insert(item, msecs, start = getLibuvNow()) {
  let list = timerListMap[msecs];
  if (list === undefined) {
    const expiry = start + msecs;
    timerListMap[msecs] = list = new TimersList(expiry, msecs);
    timerListQueue.insert(list);

    if (nextExpiry > expiry) {
      scheduleTimer(msecs);
      nextExpiry = expiry;
    }
  }
}

timerListMap is a map whose key is milliseconds and whose value is a linked list, and timerListQueue is a priority queue data structure sorted by milliseconds. The reason there is a linked list inside the map is that if multiple timers run at the same time, they are added to the list, and when that time comes, the list is traversed and the timers are called.

And every time insert runs, it compares the previously registered global variable nextExpiry with the current input expiration time and decides whether to shorten the timer's run time. The scheduleTimer function called at that point is an internal function in the timer.cc file, and it uses the libuv function uv_timer_start to call RunTimers as shown below.

void Environment::ScheduleTimer(int64_t duration_ms) {
  if (started_cleanup_) return;
  uv_timer_start(timer_handle(), RunTimers, duration_ms, 0);
}

That is the timer registration part. Now I will look at the RunTimers function, where the timer registered like that is actually executed.

void Environment::RunTimers(uv_timer_t* handle) {
  ....
  Local&lt;Function> cb = env->timers_callback_function();
  do {
    ret = cb->Call(env->context(), process, 1, &arg);
  } while (ret.IsEmpty() && env->can_call_into_js());

The timer callback is called here, and the part that sets that callback is in the node.js file(!), which performs Node initialization.

{
  const { nextTick, runNextTicks } = setupTaskQueue();
  process.nextTick = nextTick;
  process._tickCallback = runNextTicks;

  const { setupTimers } = internalBinding('timers');
  const {
    processImmediate,
    processTimers,
  } = internalTimers.getTimerCallbacks(runNextTicks);
  setupTimers(processImmediate, processTimers);
}

The function set by setupTimers is ultimately the processTimer function, and if you look at this code, you can see that it pulls items in order from the priority queue that was previously a global variable and passes them to the listOnTimeout function. (See below.)

  function processTimers(now) {
    let list;
    while ((list = timerListQueue.peek()) != null) {
      if (list.expiry > now) {
        nextExpiry = list.expiry;
        return refCount > 0 ? nextExpiry : -nextExpiry;
      }
      listOnTimeout(list, now);
    }
    return 0;
  }

Then let's look at listOnTimeout, the end of this long journey.

  function listOnTimeout(list, now) {
    while ((timer = L.peek(list)) != null) {
      try {
        timer._onTimeout();
      } 
    }
    ....
    if (list === timerListMap[msecs]) {
      delete timerListMap[msecs];
      timerListQueue.shift();
    }
  }

Here it finally calls the _onTimeout function, which was the callback passed in when the timer was first registered. You can see that it loops through the list of multiple timers registered for the current time, calls them one by one, and at the end deletes the corresponding list object and removes it from the priority queue.

Conclusion)
1) Node's KeepAlive is implemented with timers
2) When KeepAlive is enabled, one timer is registered for each connected socket
3) Node's timers are composed of a priority queue and a map, and they run sequentially at the next expiration time

I originally wanted to compare the implementation parts of nginx and others too, but just getting this far took quite a while and it seemed like it would get too long, so I will wrap it up here. I should look into it a bit more later.

Ah. And in the end, I made a GitHub blog.
https://frogred8.github.io/

Until a few days ago, I had no intention of making one at all, but 1) since these are IT engineer posts, there was no way to share the content with people who are not signed up for Blind, and 2) the fact that I cannot edit/delete old posts after changing my email felt a bit off. (Wrong information would just remain there..) 3) Most of all, I was tempted by a post saying that you can quickly create a self-hosted blog in 10 minutes, but after configuring this and that and changing options, it ended up taking well over a full day.

Anyway, nothing has changed from before, and that blog is just for sharing & backup, so please keep that in mind.


#javascript #node