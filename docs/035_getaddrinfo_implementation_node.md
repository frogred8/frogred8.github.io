---
layout: page
title: "[network] getaddrinfo 세부 구현 분석 (1)"
date: 2024-10-04
---

<pre>
getaddrinfo는 도메인 주소를 IP로 변환시켜주는 시스템 함수 중에 하나야. 그런데 여기서 도메인 주소에 대한 로컬 캐시를 어떤 식으로 저장하고 만료하는지 궁금해서 node 구현체를 시작으로 코드 레벨로 분석해봤어.
다만 한번에 쓰기엔 내용이 지나치게 많아서 여기서는 node에서 시스템 함수로 연결되는 부분까지만 볼거고, 그 다음 글에서 실제 시스템 함수 구현부를 정리해 볼 예정이야.
편의상 세부 코드까지 그대로 옮기진 않고 의사 코드로 축약했는데(변수 타입, define문 역슬래시 생략 등) 원본 코드를 보고 싶은 사람은 해당 파일에서 함수 이름으로 찾아보면 될거야.


- 초기 접근
일단은 단순하게 node 프로젝트에 있는 dns부터 살펴보기 시작했어.
node에서는 dns 패키지를 통해 lookup 함수를 아래처럼 사용할 수 있거든.

const dns = require('dns');
dns.lookup('www.google.com', (err, ip) => {...});

그럼 저기부터 시작하면 되겠다 싶어서 node 코드에서 lookup 함수까진 쉽게 찾았는데 실제 구현부까지 찾는게 간단하진 않더라고.

- lookup 함수 구현부
// dns.js
function lookup(hostname, options, callback) {
  ...
  const matchedFamily = isIP(hostname);
  if (matchedFamily) {
    process.nextTick(callback, null, hostname);
    return {};
  }

함수 초기에는 각종 파라미터의 유효성 체크 로직이 있고, 이 부분에서 hostname이 IP면 nextTick을 이용하여 microtask의 다음 tick에 콜백을 호출해주고 있어.
이제 바로 아래 부분부터 dns 로직이라고 예상했는데 여기서 다른 객체 함수를 호출하는 간단한 로직뿐이었어.

const req = new GetAddrInfoReqWrap();
req.callback = callback;
req.family = family;
req.hostname = hostname;
req.oncomplete = all ? onlookupall : onlookup;
const err = cares.getaddrinfo(req, hostname, ...);

req객체를 생성해서 채워주고 cares.getaddrinfo 함수를 호출하는데, 저 cares객체 생성 시점을 찾아보니 아래처럼 loaders.js 파일의 클로저를 이용하여 모듈이 최초 한 번만 생성되도록 구성하고 있었어.

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

getInternalBinding 함수를 보기 전에 cares 객체의 초기화 함수를 먼저 살펴보면, dns.lookup 함수에서 호출하던 getaddrinfo 함수의 바인딩을 찾을 수 있었어. 

// cares_wrap.cc
void Initialize(target, unused, context, priv) {
  Environment* env = Environment::GetCurrent(context);
  env->SetMethod(target, "getaddrinfo", GetAddrInfo);
  ...

- cares_wrap 모듈 생성/등록
저 초기화 함수를 실제로 호출하는 부분은 아래처럼 define문으로 모듈 객체가 static 객체로 생성되며 별도 인자로 받은 초기화 함수를 함수 포인터로 저장하고 있었어. 객체 생성 시점에 이를 호출할거라 예상되는 부분이지. (곧 이건 틀렸다는걸 알게 됨)

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

여기서 _register_##modname 함수는 node 시작 시점에 모듈마다 호출되는데 살짝 까다로운 define문으로 되어 있어.

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

RegisterBuiltinModules 함수에 있는 define문이 전처리기를 통하면 이렇게 변환되겠지.

void RegisterBuiltinModules() {
   _register_async_wrap();
   _register_blob();
   _register_buffer();
   _register_cares_wrap();
   ...
}

저렇게 모듈 별로 호출되는 _register_##modname 함수 구현부에 있는 node_module_register 함수가 아까 모듈 생성 시 연결한 함수 포인터를 호출할거라 예상했는데 저 함수에서는 그냥 모듈 객체의 내부값만 바꾸는게 다였어.

void node_module_register(void* m) {
  struct node_module* mp = (node_module*)(m);
  if (mp->nm_flags & NM_F_INTERNAL) {
    mp->nm_link = modlist_internal;
    modlist_internal = mp;
  }
  ...

- cares_wrap 모듈 초기화
초기 예상과 달리 생성 시점에서 초기화가 호출되지 않았고, 다시 getInternalBinding 함수로 돌아가야했어.
node 시작 시점에 호출되는 BootstrapInternalLoaders 함수에서 node 함수인 getInternalBinding 과 c로 구현된 GetInternalBinding 함수를 연결해주고 있었고,

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

GetInternalBinding 함수의 구현부에서는 현재 로딩된 모듈 목록을 찾아보고 없으면 모듈을 로딩하는 로직이 있는데 여기 InitModule 함수에서 아까 static 모듈 객체를 생성하며 등록시킨 함수 포인터를 호출하게 돼. 실제 cares_wrap::Initialize 호출은 여기서 일어나게 되는거지.

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

여기서 의문점이 모듈 등록 시점이 명확한데 왜 여기서 초기화를 하지 않고 최초 모듈 사용 시점으로 미뤘을까?

node에서는 내부 구현된 모듈 개수가 30여개쯤 되는데 개별 모듈마다 외부 노출되는 함수 바인딩을 초기화 시점에 진행하고 있어. (복잡한 모듈은 함수 바인딩만 수십개)
그런데 매번 모든 내부 모듈을 다쓰진 않는단 말이지? 예를 들어 파일 처리 역할만 담당하는 node 프로그램에서는 crypto나 inspector, socket 관련된 모듈을 사용할 일이 없잖아? 괜히 프로그램의 최초 기동시간의 지연과 함께 메모리 사용만 늘어나겠지. 
그래서 모듈의 초기화를 최초 사용 시점으로 지연시킨거고, 이 전략은 node 기동시간의 감소와 동시에 효율적인 메모리 사용을 할 수 있게 만들어주고 있어.


- GetAddrInfo 함수 구현부
여기까지 cares_wrap 모듈 객체의 생성과 초기화, 함수 등록 시점을 봤고, 이제 구현체인 GetAddrInfo를 볼 차례야.

void GetAddrInfo(args) {
  ...
  req_wrap->Dispatch(uv_getaddrinfo, AfterGetAddrInfo, *hostname, ...);

req_wrap에서 Dispatch 함수로 호출 함수와 콜백을 전달하는데 여기서 넘겨주는 파라미터 중에 uv_getaddrinfo 를 보면 어디서 많이 보던 prefix가 붙어있지? 맞아. 바로 libuv에 있는 함수야.
node에서는 c로 구현된 크로스 플랫폼 라이브러리인 libuv를 사용하여 비동기 I/O 모델을 처리할 수 있게 제공하고 있어. node 비동기의 핵심 라이브러리라고 볼 수 있지. 파일 입출력, 네트워크 등의 비동기 처리는 모두 libuv로 감싸져있다고 보면 돼.

어쨌든 다시 호출되는 함수를 보면 실제 동작은 uv__getaddrinfo_work 함수에 있는데 여기서 os함수인 getaddrinfo를 호출하고 있어. 혹시나 windows 함수는 별도로 구현했나 싶어서 찾아보니 posix와 동일했어.

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

posix의 구현부를 보면 netdb.h 파일을 포함하고 있는데 여기부터는 시스템 함수로 넘어가게 돼. 
사실 posix 함수 분석만 정리해도 되는데 node에서 libuv를 통해 시스템 함수와의 연결이 어떻게 되어있는지 정리하는 것도 의미있어보여서 이 부분의 분석으로 시작해봤어.

실제 구현체인 posix의 getaddrinfo 함수 분석도 어느 정도 끝났는데 당장 글로 쓸만큼 머릿 속에 완벽히 정리되진 않아서 다음 글의 주제로 천천히 올려볼게.


- 결론
1) node 내부 모듈은 생성/등록 시점이 아닌 최초 사용 시점에 초기화를 진행하는 전략으로 사용하는 모듈만 초기화하는 전략을 쓰고 있다.
2) libuv에서 호출하는 비동기 I/O 함수들은 자체 구현부가 크지 않고, 플랫폼에 따른 함수 호출부를 연결해주는 역할이 대다수이다.
3) node의 모듈 loader는 추상화가 참 잘되어 있다. (=분석이 어렵다..)


이전글: https://frogred8.github.io/
#frogred8 #network #getaddrinfo