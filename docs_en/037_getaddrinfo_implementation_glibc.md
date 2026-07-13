---
layout: page
title: "[network] Detailed analysis of getaddrinfo implementation details (2)"
date: 2024-11-17
---

<pre>
In the previous post, we looked at the part where Node is bound all the way to the getaddrinfo system function call. Here, I’ll go over the getaddrinfo system function, the nsswitch system, and the overall flow of a DNS request. It got pretty long because I cover some side information too, so feel free to skip any paragraphs you don’t know well.
Previous post: https://frogred8.github.io/docs/035_getaddrinfo_implementation_node/

The POSIX implementation of the getaddrinfo function is in the GNU C Library, and after downloading the glibc project, I was able to find it easily.
Before going further, I’ll first look at the structure, allocation, and usage of two key structs here.


- addrinfo and sockaddr structs
struct addrinfo
{
  int ai_flags;
  int ai_family;
  int ai_socktype;
  int ai_protocol;
  socklen_t ai_addrlen;
  struct sockaddr *ai_addr;
  char *ai_canonname;
  struct addrinfo *ai_next;
};

The value finally returned from the function is made up of addrinfo structs. It contains various fields such as socket type, protocol, and IPv4/6 family, and it also has a pointer to the next addrinfo struct in case DNS results are composed as a list.
For reference, the ai prefix before variables is short for AddrInfo. The gaih prefix in functions we’ll look at later is short for GetAddrInfoHelper, and at is short for AddrTuple, so it’s worth keeping those in mind. All error names created by this function start with EAI_*. Knowing what these prefixes mean makes code analysis much easier.

Next is the sockaddr struct, where the actual IP information in addrinfo is constructed.

struct sockaddr
{
  __SOCKADDR_COMMON (sa_);  // unsigned short int sa_family; (2byte)
  char sa_data[14];
};

Here, it felt strange that sa_data is just 14 bytes with no other information. If it contained IP information as a string, then '123.123.123.123' would require 15 bytes, or 16 bytes including the null character.

But while searching through its usages, I learned that the sockaddr struct actually only serves as a place to store pointer information. Depending on the family type (IPv4 or IPv6), glibc allocates additional memory equal to the size of the corresponding struct, makes it point there, and when using it, force-casts it according to the type. The actual stored address value uses 4 bytes for IPv4 and 16 bytes for IPv6.

// IPv4 (16byte)
struct sockaddr_in {
  __SOCKADDR_COMMON (sin_);
  in_port_t sin_port;
  struct in_addr sin_addr;
  unsigned char sin_zero[8]; // padding
};

// IPv6 (28byte)
struct sockaddr_in6 {
  __SOCKADDR_COMMON (sin6_);
  in_port_t sin6_port;
  uint32_t sin6_flowinfo;
  struct in6_addr sin6_addr;
  uint32_t sin6_scope_id;
};

When actually allocating structs like the ones above, the allocation size differs by branching on the family type, and the idea here is interesting.

if (family == AF_INET6) {
  socklen = sizeof (struct sockaddr_in6);
} else {
  socklen = sizeof (struct sockaddr_in);
}
struct addrinfo *ai;
ai = malloc (sizeof (struct addrinfo) + socklen);
ai->ai_addr = (void *) (ai + 1);

It allocates memory for addrinfo + socklen all at once, stores the starting address in the addrinfo variable, and sets ai_addr to point, via pointer arithmetic, to the memory of size socklen allocated after sizeof(addrinfo), which is the result of ai + 1. In the end, memory is arranged like this.

| addrinfo(32byte) | sockaddr_in(16byte) |
| addrinfo(32byte) | sockaddr_in6(28byte) |

In the part that uses this, memory is accessed by force-casting the pointer according to the type, as shown below. If you’re not familiar with pointers, this might not make sense right away, but if you look through it slowly, you’ll get it.

if (family == AF_INET6) {
  struct sockaddr_in6 *sin6p = (sockaddr_in6 *) ai->ai_addr;
  memcpy (&sin6p->sin6_addr, at->addr, sizeof (in6_addr));
  ...
} else {
  struct sockaddr_in *sinp = (sockaddr_in *) ai->ai_addr;
  memcpy (&sinp->sin_addr, at->addr, sizeof (in_addr));
  memset (sinp->sin_zero, '\0', sizeof (sinp->sin_zero));
  ...
}


- Structure of the getaddrinfo function
Now that we’ve looked closely at the basic addrinfo and sockaddr structs, let’s look at the actual function.

// posix/getaddrinfo.c
int getaddrinfo (char *name, char *service, struct addrinfo *hints, struct addrinfo **pai);

This system function can usually be called like this.
getaddrinfo("www.google.com", "80", NULL, &result);

Now let’s go through what the function does step by step.

First, there is simple logic of about 100 lines that validates parameters and analyzes hints. Then, after initializing a scratch_buffer struct, it calls the main function, gaih_inet. (As mentioned above, gaih is short for GetAddrInfoHelper.) The IP of the domain can be obtained from the return value of this function.

// getaddrinfo.c
struct scratch_buffer tmpbuf;
scratch_buffer_init (&tmpbuf);
gaih_inet (name, pservice, hints, pai, &naddrs, &tmpbuf);
scratch_buffer_free (&tmpbuf);

Let’s briefly look at that mysterious struct here.


- scratch buffer
struct scratch_buffer {
  void *data;
  size_t length;
  union { max_align_t __align; char __c[1024]; } __space;
};

This buffer is unusual in that it can be used after being initialized with a separate scratch_buffer_init function. If you look at the init, free, and grow functions, you can see why.

scratch_buffer_init (struct scratch_buffer *buffer) {
  buffer->data = buffer->__space.__c;
  buffer->length = sizeof (buffer->__space);
}

scratch_buffer_free (struct scratch_buffer *buffer) {
  if (buffer->data != buffer->__space.__c)
    free (buffer->data);
}

__libc_scratch_buffer_grow (struct scratch_buffer *buffer) {
  size_t new_length = buffer->length * 2;
  scratch_buffer_free (buffer);
  buffer->data = malloc (new_length);
  buffer->length = new_length;
}

When the scratch.buffer variable created from the struct calls the init function, the scratch_buffer.__space.__c pointer is connected to the scratch_buffer.data variable, allowing the 1024 bytes allocated inside the struct to be used. With the grow function shown there, it can allocate heap memory twice as large as the current size, or another function (set_array_size) can reallocate the size.
This data structure is mainly used in the glibc project so that functions can satisfy reentrancy. getaddrinfo also creates and passes this kind of buffer in advance through its function call parameters so it can be reentrant. Reentrancy is similar to thread-safety but slightly different; there is plenty of material if you search for it, so I’ll skip the explanation.

The gaih_inet function is called with the scratch variable (tmpbuf) created this way. From this point on, there are so many branches and functions that going even one more step deeper makes it hard to understand because of quite a lot of abstraction and define statements, so I’ll omit the code as much as possible and explain it in prose.


- nsswitch (Name Service Switch)
I mentioned this in the previous post too, but most books or articles about DNS describe the order as searching the hosts file -> searching the DNS cache -> requesting the DNS server. However, that order can be changed depending on the nsswitch.conf configuration. For example, if you remove files from the hosts entry and put dns first, it can request the DNS server directly without searching the file.
nsswitch has many services besides DNS, and for each service it can specify the priority order to search when a request is made. The configuration file roughly looks like this.

// etc/nsswitch.conf
passwd:         files systemd
group:          files 
hosts:          files dns
...

Each service event requested through the OS is searched and returned in that order.

But if you look at the hosts line there, there’s no cache layer, right? Correct. By default, there is no explicit DNS cache layer, and a cache layer can be selected separately. One of them, nss-resolve, can add a DNS cache layer through the resolve keyword.
(ex. hosts: files resolve dns)

If you want to use systemd-resolved as another DNS cache, you can set the DNS loopback IP (127.0.0.53) as the DNS server in resolv.conf so that all DNS requests are delivered to and processed by the systemd-resolved service. systemd-resolved works as a DNS cache even without separately configuring it in nsswitch.conf.

There are usually three kinds of DNS cache systems: nscd implemented in glibc, the separate program systemd-resolved, and nss-resolve, which uses the nss system. Covering all of them in this one post would make it too long, so I’ll write about DNS cache in another post. That post will probably cover topics like how requests are delivered from the system function to that system, and issues I ran into while testing actual DNS cache behavior.


- nsswitch initialization logic
The nss system checks whether a module has been initialized every time it fetches a function from an nss module. This is a design that takes a slight runtime cost in order to handle systems where the initialization timing is ambiguous or to keep initial boot as light as possible. In practice, since it’s just state branching, the cost is almost nothing.

If you look at the nss module initialization code, the branches are divided by the files and dns keywords like this.

bool module_load (struct nss_module *module)
{
  if (strcmp (module->name, "files") == 0)
    return module_load_nss_files (module);
  if (strcmp (module->name, "dns") == 0)
    return module_load_nss_dns (module);
  ...

If you keep following that function, you get a function containing define statements like this. The function.def file contains the pointers for the function list received from the module and the actual functions to bind.

// nss_files_functions.c
void __nss_files_functions (nss_module_functions_untyped pointers)
{
  void **fptr = pointers;
#define DEFINE_NSS_FUNCTION(x) *fptr++ = _nss_files_##x;
#include "function.def"
}

// function.def
/* This list must be kept sorted!!!  */
DEFINE_NSS_FUNCTION (gethostbyname3_r)
DEFINE_NSS_FUNCTION (getnetbyname_r)
...

Because the functions are bound sequentially to function pointers, there is even a comment saying that this order must be sorted. If you expand that define statement, the code generated at compile time will ultimately look like this.

void **fptr = pointers;
*fptr++ = _nss_files_gethostbyname3_r;
*fptr++ = _nss_files_getnetbyname_r;
...

This is how the function table related to the files type of the hosts module is constructed in the nss system. Modules for other services seem to be bound similarly too. (passwd, group, etc.)


- nss_action construction
The function table created during nss initialization above is constructed as an nss_action list when reading the nsswitch.conf file, and this is what lets it be used dynamically according to the configuration file.
If nsswitch.conf is set to "hosts: files dns", the nss_action_list first gets connected to the function binding table connected through files for the hosts module, and the next pointer gets connected to the function table connected through dns.
That function table is later called in the __nss_lookup_function function using __nss_module_get_function.


- Structure of the get_nss_addresses function
The reason I explained the nss system in depth above is that it is the core logic for fetching DNS data. The function chain goes getaddrinfo -> gaih_inet -> get_nss_addresses -> __nss_lookup_function.

Now returning to the main function, get_nss_addresses was a fairly difficult part to analyze because it starts calling the abstracted function implementations in earnest. If I roughly describe this function flow:

1. Check whether the nsswitch.conf file has changed, determine whether reloading is needed, and get the current configuration
2. According to the configuration, add nss_actions to a variable of type nss_action_list in the order listed in the configuration
3. Sequentially execute the nss_actions for the requested service entry (hosts here)
4. If execution of an nss_action succeeds, return immediately; if it fails, call the next nss_action (ex. files -> dns)

Since 1 and 2 are configuration-related, I’ll briefly explain only 3 and 4 with pseudocode.

nss_action_list nip;
__nss_database_get (nss_database_hosts, &nip);
while (1) {
  fct = __nss_lookup_function (nip, "gethostbyname2_r");
  result = gethosts (fct, AF_INET, name, ...);
  if (result == S_OK) return true;
  nip++;
  if (!nip->module) return false;
}

This code obtains nip, the nss_action_list for hosts in nss, retrieves the connected function pointer through it, calls that function pointer from the gethosts function, returns if there is a result, and if not, moves to the next nss_action and repeats.
In reality it is much more complex and has many branches, but at a high level it probably isn’t very different.

The implementation of that function pointer fct is in files-hosts.c for the hosts file, and the DNS implementation is implemented in dns-host.c as the _nss_dns_gethostbyname4_r function. Since the file side just parses and searches, I’ll look only at the DNS implementation last.


- DNS query implementation
If you follow the functions _nss_dns_gethostbyname4_r -> __res_context_search -> __res_context_querydomain -> __res_context_query -> __res_context_send, you can see the final branch for the DNS request. If it is TCP, it calls send_vc, and if it is UDP, it calls send_dg. By default, it sends through UDP.
At this point, if there is already an open socket to the current DNS server, it uses it as is. If it is not connected, it opens a new socket to the DNS server, stores it, and reuses it. Through this socket, it sends IPv4 and IPv6 request packets for the domain consecutively, waits until both responses come back, and then returns.
Using that, it creates and returns the addrinfo struct mentioned at the very beginning, and then the DNS request is finally complete.
The actual code uses goto statements for flow control, making it complex, and it is otherwise straightforward code without much beyond what I explained, so I’ll omit it here. If you want to look at it, you can search with those keywords.


- The secret of the DNS server list
I’ll summarize one more thing I learned while looking at the part that requests DNS servers above.
You can configure multiple DNS servers in /etc/resolv.conf, but when I looked at the code that reads that configuration file, DNS servers can only be used up to 3 entries.

// resolv_conf.c
size_t nserv = conf->nameserver_list_size;
if (nserv > MAXNS)
  nserv = MAXNS; // this value is 3
for (size_t i = 0; i < nserv; ++i) {
...

Usually, even if multiple DNS servers are configured, requests are sent only to the first configured DNS server. That’s because the default is set to use the first server, and requests are sent to the next DNS server only when connection to the DNS server fails.
If you add the rotate option to resolv.conf, the first server to request is also selected randomly, and each request is sent sequentially to a different DNS server.

// /etc/resolv.conf
nameserver 1.1.1.1
nameserver 2.2.2.2
nameserver 3.3.3.3
options rotate

But to do round-robin, you need to store the index of the server previously sent to, right? So I checked how it was done, and it simply stores it in a static variable inside the function. I rewrote it below as easier pseudocode. (In the original code, there are defines and some complexity for atomic operations.)

int nameserver_offset (struct __res_state *statp) {
  int nscount = statp->nscount;
  if (nscount <= 1 || !(statp->options & RES_ROTATE))
    return 0;

  static int global_offset;
  global_offset += 2;
  int offset = global_offset;
  if ((offset & 1) == 0) {  
    offset = random_bits ();
    offset <<= 1;
    offset |= 1;
    global_offset = offset;
  }
  offset =>> 1;
  return offset % nscount;
}

The lowest 1 bit of the global_offset variable stores whether it has been initialized, and when used, the value is shifted to the right. The nameserver_offset returned by this function can be used like this.

// res_send.c
int ns_offset = nameserver_offset (statp);
for (int ns_shift = 0; ns_shift < nameserver_count; ns_shift++) {
  int ns = ns_shift + ns_offset;
  sockaddr_in nameserver = statp->nsaddr_list[ns];
  ...

Even when rotate is configured, programs that make a one-off request and exit (host, dig) may still use the same DNS server, but services that stay alive and make DNS requests multiple times do request sequentially with round-robin. It seems like something you only need to think about when DNS load balancing is needed.


- Conclusion
1) Address information (the sockaddr struct) allocates different amounts of memory all at once depending on IPv4/IPv6 and uses it through pointer arithmetic.
2) The scratch_buffer data type is sometimes passed as an argument and used for function calls that have reentrancy.
3) In nsswitch, the request order for each service can be changed, and commonly used DNS cache systems on Linux include nscd, systemd-resolved, and nss-resolve.
4) Only up to 3 entries in the DNS server list are valid, and adding the rotate option makes requests go sequentially to different DNS servers.

Previous post: https://frogred8.github.io/
#frogred8 #network #getaddrinfo #dns