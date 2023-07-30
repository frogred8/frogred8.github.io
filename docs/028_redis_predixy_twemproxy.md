---
layout: page
title: "[redis] proxy의 multikey 구현"
date: 2023-07-30
---

<pre>
많이 알다시피 redis는 key-value 구조로 사용하는 in-memory cache storage 중 하나야. redis는 클러스터를 구성할 수 있는데 사실 proxy 객체를 앞에 두고 사용하는 경우가 많아. 로드밸런싱이나 acl, 커넥션 관리 등 이점이 많거든.

이런 redis proxy 객체 중에서 가장 많이 쓰이는 게 predixy와 twemproxy인데, proxy의 역할은 단순히 키를 해싱해서 명령을 실행시킬 인스턴스로 그 명령을 보내는 것 뿐이야. 샤딩 개념이라고 보면 돼.

여기서 단순한 의문이 들었어. predixy와 twemproxy 문서를 보면 mset, del 같이 여러 개의 키를 하나의 명령에 실어서 보낼 수 있는 명령도 지원하거든. 왜 이 부분이 이상했냐면, 아래 명령을 보낸다고 해봐.

del a1 a2 a3 a4

a1, a2, a3, a4키를 지우는 간단한 명령이지만 저 키들은 여러 인스턴스에 흩어져있기 때문에 다른 명령처럼 단순히 하나의 인스턴스로 전달한다고 완료되지 않는 명령이잖아? 이걸 각 proxy 구현체들은 어떻게 풀어냈을까 하는게 궁금했어.

- predixy
일단 predixy를 먼저 볼거야. 얘는 c++로 이루어져 있고, redis sentinel/cluster에 대한 지원을 하고 있어. 초기화나 기타 로직이 간결한 편이야.
https://github.com/joyieldInc/predixy

worker thread 개수를 설정 파일에서 조정이 가능한데 이런 식으로 Handler 클래스가 실제 스레드에서 돌아가는 로직을 구현하게 돼

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

여기서 run() 함수를 확인해보면 일반적인 worker thread loop 구성으로 되어 있어.

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

저기 mEventLoop 객체가 이벤트 처리하는 객체인데 보통은 추상클래스로 인터페이스 일반화해서 다형성을 구성하는데 여기서는 컴파일 시에 Makefile 에서 이벤트 핸들러를 아예 지정하더라고.

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

그리고 개별 클래스마다 typedef로 동일하게 Multiplexor 클래스 명으로 설정해서 Makefile 옵션에 따라 실제 클래스의 구현이 달라지게 되는 방식을 썼어.

# EPollMultiplexor.h
...
typedef EpollMultiplexor Multiplexor;

다시 스레드 함수로 돌아가서 아까 스레드에서 돌던 mEventLoop 변수는 Multiplexor* 로 선언되어 있는데, epoll 기준으로 보면 이런 식으로 wrapping되어 있어.

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

결국 모든 이벤트는 handler->handleEvent() 호출로 받게 되는데 저 함수에서는 세 가지 타입으로 나눠서 처리하고 있어.

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

첫번째는 연결 요청이고, 두번째인 AcceptType은 이 proxy에 접속한 클라이언트와 연결된 곳에서 보낸 이벤트, ConnectType은 proxy와 연결된 redis cluster 서버 이벤트를 말해. 이미 연결된 상태에서 일반적인 명령은 이런 순서로 진행이 돼.

1. proxy에 접속한 클라이언트에서 AcceptType 이벤트 전달 (get, set..)
2. 키를 해싱하여 어느 redis로 갈 지 판단한 후에 그 redis로 명령 전달
3. redis로 보낸 명령에 대한 응답을 ConnectType 이벤트로 수신
4. 처리 결과를 보낼 request 이벤트를 찾고 해당 클라이언트와 연결된 소켓으로 전달

그럼 multikey가 허용되는 명령은 어떻게 분기하고 있을까? 그건 predixy에서 선언된 redis 함수별 타입에 따라 달라져. get이나 ttl 등은 Read 타입만 선언되어 있는데 mget은 Read|MultiKey 타입으로 선언되어 있거든. del도 키를 여러개 받을 수 있으니 Write|MultiKey 로 되어있고.

이제 저 MultiKey 속성 기준으로 찾아보면 될 것 같아서 열심히 찾았는데 타고가는 로직이 너무 길어서 여기서는 이벤트가 도착했을 때의 대략적인 플로우만 설명해볼게.

1. 클라이언트에서 이벤트가 들어오면 RequestParser 객체가 파싱
2. 파싱으로 얻은 명령의 속성에 MultiKey가 있으면 현재 req 객체에 leader로 선언
3. preset으로 만들어진 GenericRequest를 사용하여 각 redis 클라이언트에 인자 개수만큼 이벤트를 생성
ex) mget a1 a2 a3 -> mget a1, mget a2, mget a3 세개 생성
4. 각 키에 맞는 redis cluster로 해당 이벤트 전달
5. 이벤트 응답으로 온 내용을 2번에서 선언한 leader 객체에 쌓음
6. 모든 응답이 왔으면 이를 요청한 클라이언트로 결과 반환

따라서 predixy는 저런 multikey 명령을 받으면 인자 개수만큼 명령을 생성해서 개별 redis cluster로 전달하는 방식인걸 확인할 수 있었어.


- twemproxy
nutcracker라는 예전 이름으로 불리기도 하는데, c로 구성되어 있고 memcached, redis를 지원하고 있어. twitter에서 사용하는 것으로 더 널리 알려진 proxy야. 2015년 이후로 계속 업데이트가 없길래 predixy로 넘어왔는데 2년 전에 뭔가 릴리즈되긴 했네.

twemproxy는 대-기업에서 공개한 라이브러리라 그런지 문서의 양이나 질도 좋고, 코드나 구조도 매우 깔끔한 편이야. 특히 c++처럼 template 떡칠이 없어서 코드 따라가기도 수월한게 장점이야. 이제 코드를 보면,

void req_recv_done(...)
{
  ...
    /* do fragment */
  status = msg->fragment(msg, array_n(&pool->server), &frag_msgq);

저 fragment는 함수 포인터로 초기화할 때에 memcached, redis에 따라 연결되는 함수가 달라지도록 되어있어. 여기서는 redis니까 그 연결되는 부분을 보면,

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

이제 다시 호출되는 redis_fragment_argx 함수를 볼건데 저 함수는 파싱과 req 생성 두 부분으로 나누어져 있어. 파싱을 먼저 볼게.

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

로직은 간단해. 전달받은 파라미터를 분해해서 해당 명령이 전달될 서버 인덱스를 찾고, 그 파라미터를 redis_append_key 함수를 이용하여 sub_msgs에 순차적으로 쌓고 있어. 이렇게 각 서버로 전달될 sub_msgs를 쌓았으면 이제 loop 돌면서 request 생성해야지.

for (i = 0; i < nserver; i++) {
  struct msg *sub_msg = sub_msgs[i];
  if (r->type == MSG_REQ_REDIS_MGET) {
    status = msg_prepend_format(sub_msg, "*%d\r\n$4\r\nmget\r\n", sub_msg->narg + 1);
  } else if (r->type == MSG_REQ_REDIS_DEL) {
    status = msg_prepend_format(sub_msg, "*%d\r\n$3\r\ndel\r\n", sub_msg->narg + 1);
  } ...

msg_prepend_format 함수 안을 보면 vsnprintf를 wrapping한 함수일 뿐이고, 이런 식으로 각 서버마다 전달할 명령셋을 생성하게 돼. 이렇게 생성된 명령으로 아래에서 전송하면 끝.

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

sub_msg 개수만큼 돌면서 해당 명령이 전달될 redis 연결을 얻고, 여기에 각 sub_msg마다 쌓인 명령을 전달하여 response 함수를 통해 응답을 확인하고 모두 다 수신받았으면 클라이언트에 전달하게 돼. (이건 predixy랑 동일)

아까 predixy와의 차이를 보면 아까는 mget a1 a2 a3일 때에 mget a1, mget a2, mget a3를 각각 만들어서 보냈잖아? twemproxy는 조금 더 똑똑하게 각 서버마다 보낼 명령을 모아서 한번에 보내는 방식이야.
만약 a1과 a3가 같은 서버를 가리키는 해시라면 mget a1 a3, mget a2 두 개의 명령만 생성해서 보내겠지.


- 결론
1) predixy는 multikey 타입 명령에 전달된 키 개수만큼 명령을 재생성하여 전달한다.
2) twemproxy는 각 서버마다 보낼 명령을 하나의 명령셋으로 생성하여 보내는 방식으로 최대 서버 개수만큼의 명령만 생성된다.
3) multikey 명령에 대한 효율은 twemproxy가 좋을 수 있지만 일반적인 벤치마크는 predixy가 우위
https://github.com/joyieldInc/predixy/wiki/Benchmark
4) codis도 같이 분석해볼까 고민했는데 2018년 이후에 업데이트가 없길래 제외

이전글: https://frogred8.github.io/
#frogred8 #redis #predixy #twemproxy