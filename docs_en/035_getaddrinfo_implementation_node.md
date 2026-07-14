---
layout: page
title: "[network] A deep dive into the getaddrinfo implementation (1)"
date: 2024-10-04
---

<pre>
getaddrinfo is one of the system functions that converts a domain address into an IP address. I was curious about how the local cache for domain addresses is stored and expired, so I analyzed it at the code level, starting with the Node implementation.
There is too much content to cover in a single post, so here I will only look at the path from Node to the system function, and in the next post I plan to organize the actual system function implementation.
For convenience, I did not copy every detail of the code as-is and instead shortened it into pseudocode (omitting variable types, backslashes in define statements, and so on). If you want to see the original code, you can search for the function names in the relevant files.


- Initial approach
I first started simply by looking at dns in the Node project.
In Node, you can use the lookup function through the dns package like this.

const dns = require('dns');
dns.lookup('www.google.com', (err, ip) => {...});

So I thought I could start from there. I was able to find the lookup function in the Node code fairly easily, but finding the actual implementation was not that simple.

- lookup function implementation
// dns.js
function lookup(hostname, options, callback) {
  ...
  const matchedFamily = isIP(hostname);
  if (matchedFamily) {
    process.nextTick(callback, null, hostname);
    return {};
  }

At the beginning of the function, there is validation logic for various parameters. In this part, if the hostname is an IP, it uses nextTick to call the callback on the next tick of the microtask queue.
I expected the DNS logic to start immediately below this, but it was only simple logic that called a function on another object.

const req = new GetAddrInfoReqWrap();
req.callback = callback;
req.family = family;
req.hostname = hostname;
req.oncomplete = all ? onlookupall : onlookup;
const err = cares.getaddrinfo(req, hostname, ...);

It creates and fills the req object, then calls cares.getaddrinfo. When I looked for the point where this cares object is created, I found that it uses a closure in loaders.js so that the module is created only once, as shown below.

// dns.js
const cares = internalBinding('cares_wrap');
...

// loaders.js
const bindingObj = ObjectCreate(null);
const internalBinding = function ib(module) {
  let mod = bindingObj[module];
  if (!mod) {
    mod = bindingObj[module] = getInternalBinding(module);
    ...
  }
  return mod;
};

Before looking at getInternalBinding, I first checked the initialization function for the cares object. There, I was able to find the binding for the getaddrinfo function that was being called from dns.lookup.

// cares_wrap.cc
void Initialize(target, unused, context, priv) {
  Environment* env = Environment::GetCurrent(context);
  env->SetMethod(target, "getaddrinfo", GetAddrInfo);
  ...

- cares_wrap module creation/registration
The part that actually calls this initialization function is written as follows: a module object is created as a static object through a define statement, and the initialization function received as a separate argument is stored as a function pointer. This is the part where I expected it to be called when the object was created. (Soon I found out this was wrong.)

// cares_wrap.cc
NODE_MODULE_CONTEXT_AWARE_INTERNAL(cares_wrap, Initialize)

// node_binding.h
#define NODE_MODULE_CONTEXT_AWARE_INTERNAL(modname, regfunc)
  static node::node_module _module = {
    ...
    (node::addon_context_register_func)(regfunc),
    ...
    };
  void _register_##modname() { node_module_register(&_module); }

Here, the _register_##modname function is called for each module when Node starts, and it is written as a slightly tricky define statement.

// node.cc
int InitializeNodeWithArgs(...) {
  // Register built-in modules
  binding::RegisterBuiltinModules();
  ...
}

// node_binding.cc
void RegisterBuiltinModules() {
#define V(modname) _register_##modname();
  NODE_BUILTIN_MODULES(V)
#undef V
}

#define NODE_BUILTIN_STANDARD_MODULES(V)
  V(async_wrap)
  V(blob)
  V(buffer)
  V(cares_wrap)
  ...

If the define statement in RegisterBuiltinModules goes through the preprocessor, it would be transformed like this.

void RegisterBuiltinModules() {
   _register_async_wrap();
   _register_blob();
   _register_buffer();
   _register_cares_wrap();
   ...
}

I expected the node_module_register function inside the implementation of _register_##modname, which is called for each module like this, to call the function pointer connected earlier when the module was created. But that function only changed an internal value of the module object.

void node_module_register(void* m) {
  struct node_module* mp = (node_module*)(m);
  if (mp->nm_flags & NM_F_INTERNAL) {
    mp->nm_link = modlist_internal;
    modlist_internal = mp;
  }
  ...

- cares_wrap module initialization
Unlike my initial expectation, initialization was not called at creation time, so I had to go back to the getInternalBinding function.
In BootstrapInternalLoaders, which is called when Node starts, the Node function getInternalBinding is connected to the C-implemented GetInternalBinding function.

// node.cc
Environment::BootstrapInternalLoaders() {
  params = {
    FIXED_ONE_BYTE_STRING(isolate_, "getInternalBinding")
  };
  args = {
    NewFunctionTemplate(binding::GetInternalBinding)
  };
  ExecuteBootstrapper(this, "internal/bootstrap/loaders", &params, &args);
  ...

The implementation of GetInternalBinding checks the currently loaded module list, and if the module is not there, it loads the module. In this InitModule function, the function pointer registered earlier when the static module object was created is called. The actual cares_wrap::Initialize call happens here.

// node_binding.cc
void GetInternalBinding(args) {
  node::Utf8Value module_v(env->isolate(), args[0]);
  node_module* mod = FindModule(modlist_internal, *module_v, ...);
  if (mod != nullptr) {
    exports = InitModule(env, mod, module);
    env->internal_bindings.insert(mod);
  }
  ...

void InitModule(env, mod, module) {
  mod->nm_context_register_func(...);
  ...

One question here is: if the module registration point is clear, why not initialize it there and instead defer initialization until the module is first used?

Node has about 30 internally implemented modules, and each individual module performs bindings for externally exposed functions at initialization time. (For more complex modules, there can be dozens of function bindings.)
But not every internal module is used every time, right? For example, a Node program that only handles file processing would have no reason to use modules related to crypto, inspector, or sockets. Initializing them unnecessarily would only delay the program's initial startup time and increase memory usage.
So Node delays module initialization until the point of first use, and this strategy reduces Node startup time while also enabling more efficient memory usage.


- GetAddrInfo function implementation
So far, I have looked at when the cares_wrap module object is created and initialized, and when functions are registered. Now it is time to look at the implementation, GetAddrInfo.

void GetAddrInfo(args) {
  ...
  req_wrap->Dispatch(uv_getaddrinfo, AfterGetAddrInfo, *hostname, ...);

In req_wrap, the function to call and the callback are passed to the Dispatch function. Among the parameters passed here, if you look at uv_getaddrinfo, it has a prefix that looks familiar, right? That's right. It is a function from libuv.
Node uses libuv, a cross-platform library implemented in C, to provide its asynchronous I/O model. You can think of it as the core library behind Node's asynchronous behavior. Asynchronous handling for file I/O, networking, and so on is all wrapped by libuv.

Anyway, going back to the function that gets called, the actual behavior is in uv__getaddrinfo_work, and this is where the OS function getaddrinfo is called. I wondered whether the Windows function might be implemented separately, so I checked, and it was the same as POSIX.

// uv/src/unix/getaddrinfo.c
#include &lt;netdb.h>
void uv__getaddrinfo_work() {
  ...
  err = getaddrinfo(req->hostname, req->service, req->hints, &req->addrinfo);
  ...
}

// uv/src/win/getaddrinfo.c
#include &lt;winsock2.h>
void uv__getaddrinfo_work(struct uv__work* w) {
  ...
  err = GetAddrInfoW(req->node, req->service, hints, &req->addrinfow);
  ...
}

Looking at the POSIX implementation, it includes the netdb.h file, and from here it moves into system functions.
In fact, I could have just organized the POSIX function analysis, but I thought it would also be meaningful to explain how Node connects to system functions through libuv, so I started with this part of the analysis.

I have also finished analyzing the actual POSIX getaddrinfo implementation to some extent, but it is not yet organized clearly enough in my head to write up right away, so I will slowly post it as the topic of the next article.


- Conclusion
1) Node internal modules use a strategy where they are initialized at first use, not at creation/registration time, so only the modules that are actually used are initialized.
2) The asynchronous I/O functions called from libuv do not have large implementations of their own; in most cases, they mainly serve to connect to platform-specific function calls.
3) Node's module loader is very well abstracted. (= it is hard to analyze..)


Previous post: https://frogred8.github.io/
#frogred8 #network #getaddrinfo #dns
</pre>
