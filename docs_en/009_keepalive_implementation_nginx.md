---
layout: page
title: "[nginx] An analysis of the keepAlive implementation"
date: 2022-06-05
---

<pre>
As I mentioned in the previous post, keepAlive in Node was implemented by putting timer objects into a priority queue and executing them. That made me curious about how nginx, which is written in C, implements it, so I took a look.

You can get the nginx code from GitHub, and it is written in C. (The first commit was all the way back in 2006...) When looking at a large codebase you do not know well for the first time, it is good to start with keyword searches. First, I searched for the `keepalive_timeout` keyword, which is configured in the config, and the most likely code stood out as below.

ngx_http_set_keepalive(ngx_http_request_t *r)
{
  ngx_connection_t* c = r->connection;
  ngx_event_t* rev = c->read;
  ngx_http_core_loc_conf_t* clcf = ngx_http_get_module_loc_conf(r, ngx_http_core_module);

  rev->handler = ngx_http_keepalive_handler;
  ngx_add_timer(rev, clcf->keepalive_timeout);
  ....

Here, it sets the timer and the handler to run when the timer fires. Let’s look at the handler first.

ngx_http_keepalive_handler(ngx_event_t *rev)
{
  if (rev->timedout || c->close) {
    ngx_http_close_connection(c);
    return;
  }
  n = c->recv(c, b->last, size);
  if (n == 0) {
    ngx_http_close_connection(c);
    return;
  }
  ....

When the handler runs, it checks various conditions besides these and closes the connection. And if you look at the close function that gets called,

ngx_close_connection(ngx_connection_t *c)
{
  if (c->read->timer_set) {
    ngx_del_timer(c->read);
  }
  c->read->closed = 1;
  ngx_reusable_connection(c, 0);
  ngx_free_connection(c);

  fd = c->fd;
  if (ngx_close_socket(fd) == -1) {
    ...
  }
  ....

Seeing that it deletes the timer when `timer_set` is true while closing, `ngx_add_timer` probably sets that value, right? Aside from that, you can see that it initializes various socket-related values and finally closes it with `ngx_close_socket`.

By the way, `ngx_close_socket` is declared in two places, separated into the `unix` and `win32` folders depending on the platform. The file linked during compilation with make differs based on the selected platform. When I went into the `win32` folder, I noticed little extras like `nginx.rc` and `nginx.ico` had been added too lol

// src/os/unix/ngx_socket.h
#define ngx_close_socket  close
// src/os/win32/ngx_socket.h
#define ngx_close_socket  closesocket

Anyway, now that we have looked at the handler, let’s look at the `add_timer` function.

ngx_event_add_timer(ngx_event_t *ev, ngx_msec_t timer)
{
  ngx_msec_t key = ngx_current_msec + timer;
  ev->timer.key = key;
  ngx_rbtree_insert(&ngx_event_timer_rbtree, &ev->timer);
  ev->timer_set = 1;
  ....

Here it sets the `timer_set` variable checked when closing the connection. It also puts the received timer object into the global object `ngx_event_timer_rbtree`. Just from the name, it seems pretty obvious that the data structure is a red-black tree. If you do not remember rbtree well, go to the site below and try it out. It is well made.
https://www.cs.usfca.edu/~galles/visualization/RedBlack.html

Coming back, `ngx_rbtree_insert` declares the usual coloring or rotation behavior of an rbtree, and the `ev->timer` object is passed in with a key in milliseconds.

But since operator overloading for the key inside the object is not implemented (because this is C), a comparison function has to be provided somewhere, right? Looking a bit further into the initialization part, I found that it is set through the initialization function below.

ngx_event_timer_init(ngx_log_t *log)
{
  ngx_rbtree_init(&ngx_event_timer_rbtree, &ngx_event_timer_sentinel, ngx_rbtree_insert_timer_value);

  return NGX_OK;
}

Looking at the arguments one by one, it passes the rbtree instance to configure, passes a sentinel node as well (you can think of this as a null node designated as a leaf node), and `ngx_rbtree_insert_timer_value` is a function. If you go into it, the key comparison logic for the object is implemented there. nginx is using this rbtree like Node’s priority queue.

Next, let’s find where the `ngx_http_set_keepalive` function that creates the timer is called.

ngx_http_finalize_connection(ngx_http_request_t *r)
{
  if (!ngx_terminate
    && !ngx_exiting
    && r->keepalive
    && clcf->keepalive_timeout > 0)
  {
    ngx_http_set_keepalive(r);
    return;
  }
  ngx_http_close_request(r, 0);
}

As you can see, in the handler at the point of connection finalization, it either calls `set_keepalive` depending on the `keepalive` property, or otherwise just closes the connection.


So far, we have looked at where keepalive is called when it is set, and how the timer object is created and inserted into the red-black tree. Now it is time to find where this is driven.

ngx_event_find_timer(void)
{
  if (ngx_event_timer_rbtree.root == &ngx_event_timer_sentinel) {
    return NGX_TIMER_INFINITE;
  }
  root = ngx_event_timer_rbtree.root;
  sentinel = ngx_event_timer_rbtree.sentinel;
  node = ngx_rbtree_min(root, sentinel);
  timer = (ngx_msec_int_t) (node->key - ngx_current_msec);
  return (ngx_msec_t) (timer > 0 ? timer : 0);
}

If `rbtree.root` is the sentinel, meaning there are no registered timers, it returns -1. Otherwise, it finds the smallest key (time) among the rbtree members with `ngx_rbtree_min` and returns that value minus the current time. This means the amount of time until the next timer fires.

The reason it gets the time until the next timer instead of the timer object itself becomes clear if you go to the call site of the `find_timer` function.

ngx_process_events_and_timers(ngx_cycle_t *cycle)
{
  timer = ngx_event_find_timer();
  flags = NGX_UPDATE_TIME;
  (void) ngx_process_events(cycle, timer, flags);
  ngx_event_expire_timers();
}

I shortened this a lot, but the important thing here is that it calls `ngx_process_events`. That function is defined with a define statement as below. (The call to `ngx_event_expire_timers` is also important, so keep it in mind for a moment.)

#define ngx_process_events   ngx_event_actions.process_events

`ngx_event_actions` sets event behavior by module, and under the `src/event/modules` folder there are files like `ngx_iocp_module.c`, `ngx_epoll_module.c`, `ngx_select_module.c`, and so on. The appropriate module gets connected depending on the configured module type. Here, I will look at it based on iocp.

ngx_event_actions = ngx_iocp_module_ctx.actions;

static ngx_event_module_t  ngx_iocp_module_ctx = {
  &iocp_name,
  ngx_iocp_create_conf,                  /* create configuration */
  ngx_iocp_init_conf,                    /* init configuration */
  {
    ngx_iocp_add_event,                /* add an event */
    NULL,                              /* delete an event */
    NULL,                              /* enable an event */
    NULL,                              /* disable an event */
    NULL,                              /* add an connection */
    ngx_iocp_del_connection,           /* delete an connection */
    NULL,                              /* trigger a notify */
    ngx_iocp_process_events,           /* process the events */
    ngx_iocp_init,                     /* init the events */
    ngx_iocp_done                      /* done the events */
  }
};

The function we need to look for is `ngx_iocp_process_events`. We are almost there.

ngx_int_t ngx_iocp_process_events(ngx_cycle_t *cycle, ngx_msec_t timer, ngx_uint_t flags)
{
  rc = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR) &key, (LPOVERLAPPED *) &ovlp, (u_long) timer);
  ovlp->event->handler(ev);
}

That `GetQueued...` function blocks until an I/O completion event comes in, and the last argument is `timer`, right? Its role is to wait for that amount of time and return if no event comes in. So the time obtained earlier from `find_timer` is used here.

Then where is the actual keepalive handler called? The answer is in the `ngx_event_expire_timers` function. This is the last function, so even though it is a bit long, let’s look at it closely.

ngx_event_expire_timers(void)
{
  sentinel = ngx_event_timer_rbtree.sentinel;
  for ( ;; ) {
    root = ngx_event_timer_rbtree.root;
    if (root == sentinel) {
      return;
    }
    node = ngx_rbtree_min(root, sentinel);
    if ((ngx_msec_int_t) (node->key - ngx_current_msec) > 0) {
      return;
    }
    ev = ngx_rbtree_data(node, ngx_event_t, timer);
    ngx_rbtree_delete(&ngx_event_timer_rbtree, &ev->timer);
    ev->timer_set = 0;
    ev->timedout = 1;
    ev->handler(ev);
  }
}

If the rbtree is empty or the smallest key is greater than the current time, it returns. Otherwise, it calls the event handlers of the registered timer objects one by one. The actual deletion from the rbtree also happens here, and the flag we saw earlier in the event handler gets set here too.


That covers nginx’s keepAlive implementation. In the previous post, Node’s keepalive registered timers in a priority queue and used them, right? nginx differs only in that it registers them in an rbtree, and we can see that the main structure, such as registration timing and execution, is similar.

Conclusion)
1) nginx’s keepAlive sorts timer handlers by time and executes them sequentially.
2) It uses a red-black tree for sorting and storing timers.
3) Overall, it has a structure similar to Node’s keepAlive.


Besides this, I also had fun analyzing the code because it generally uses techniques that were popular in the past. For example, wrapping the whole flow you want to control in a `for` loop and controlling it like `goto` with `continue` and `break`... (code below)

rc = NGX_AGAIN;
for ( ;; ) {
  if (rc == NGX_AGAIN) {
    n = ngx_http_read_request_header(r);
    if (n == NGX_AGAIN || n == NGX_ERROR) {
      break;
    }
  }
  rc = ngx_http_parse_request_line(r, r->header_in);
  if (rc == NGX_OK) {
    if (r->invalid_header && cscf->ignore_invalid_headers) {
      continue;
    }
    ngx_http_process_request_headers(rev);
    break;
  }
  ....
}

If you wrote code like that these days and sent a PR, you would get countless comments (=flames). Besides that, variables used as flags, unions, bitfields, and things like that show up here and there, so it really felt like old code.

Honestly, nginx is not even easy to use well, so I was not sure whether I could really read the code properly. But after actually doing it, it was not that difficult. In some ways, the low level of abstraction actually makes it easier to analyze.

Then I hope you enjoyed reading this, and I will see you next time.
</pre>
