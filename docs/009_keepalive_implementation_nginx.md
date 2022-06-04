---
layout: default
title: "[nginx] keepAlive 구현 분석"
---

## [nginx] keepAlive 구현 분석

<pre>
이전 글에서 말했듯 node에서의 keepAlive는 타이머 객체를 우선순위 큐에 넣어서 실행하도록 구현되어 있었는데 c코드인 nginx는 어떻게 구현되어 있을지 궁금해서 한 번 살펴봤어.

nginx코드는 github에서 받을 수 있는데 c언어로 작성되어 있어. (첫 커밋이 무려 2006년..) 이렇게 잘 모르는 대규모 코드를 처음 살펴볼 때에는 키워드 검색으로 시작해보는게 좋아. 일단 config에서 설정하는 keepalive_timeout 키워드로 검색하니 아래처럼 가장 유력한 코드가 눈에 띄었어.

ngx_http_set_keepalive(ngx_http_request_t *r)
{
  ngx_connection_t* c = r->connection;
  ngx_event_t* rev = c->read;
  ngx_http_core_loc_conf_t* clcf = ngx_http_get_module_loc_conf(r, ngx_http_core_module);

  rev->handler = ngx_http_keepalive_handler;
  ngx_add_timer(rev, clcf->keepalive_timeout);
  ....

여기서 타이머랑 타이머가 작동하면 실행할 핸들러를 설정하는데 핸들러를 먼저 볼게.

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

핸들러가 실행되면 이거 외에도 여러가지 조건을 확인해서 연결을 종료시키게 되어있어. 그리고 호출되는 종료 함수를 보면,

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

닫을 때 timer_set 값이 참이면 타이머를 삭제시키는걸로 봐서 아마 ngx_add_timer에서 설정하겠지? 그 외 소켓에 여러가지 값을 초기화하고 마지막에 ngx_close_socket으로 닫는걸 확인할 수 있어.

근데 ngx_close_socket은 두 곳에 선언되어 있는데 플랫폼에 따라 unix, win32폴더로 분리했더라고. make로 컴파일 시에 플랫폼 선택에 따라 linking되는 파일이 다르게 되어있는데 win32 폴더에 가보니 깨알같이 nginx.rc, nginx.ico도 추가되어 있음 ㅋㅋ

// src/os/unix/ngx_socket.h
#define ngx_close_socket  close
// src/os/win32/ngx_socket.h
#define ngx_close_socket  closesocket

어쨌든 핸들러를 알아봤으니 이제는 add_timer 함수를 살펴볼게.

ngx_event_add_timer(ngx_event_t *ev, ngx_msec_t timer)
{
  ngx_msec_t key = ngx_current_msec + timer;
  ev->timer.key = key;
  ngx_rbtree_insert(&ngx_event_timer_rbtree, &ev->timer);
  ev->timer_set = 1;
  ....

여기서 연결 종료 시 확인하는 timer_set 변수를 설정해. 그리고 받은 타이머 객체를 전역 객체인 ngx_event_timer_rbtree 변수에 타이머를 넣고 있어. 이름만 봐도 자료구조가 red-black tree인건 너무 자명해보이네. rbtree가 잘 생각나지 않는 사람은 아래 사이트가서 테스트해봐. 잘 만들었더라.
https://www.cs.usfca.edu/~galles/visualization/RedBlack.html

다시 돌아와서 ngx_rbtree_insert 함수에서는 rbtree의 일반적인 coloring or twist 동작이 선언되어 있고, ev->timer 객체는 밀리세컨드 단위의 key를 넣어서 전달하고 있어. 

근데 객체 내 key에 대한 operator overloading이 구현되어 있지 않으니 (c언어니까) 비교 함수를 어딘가는 넣어야 되겠지? 초기화 부분을 조금 더 찾아보니 아래 초기화 함수를 통해 설정하더라고.

ngx_event_timer_init(ngx_log_t *log)
{
  ngx_rbtree_init(&ngx_event_timer_rbtree, &ngx_event_timer_sentinel, ngx_rbtree_insert_timer_value);

  return NGX_OK;
}

넘기는 인자를 하나씩 보면 설정할 rbtree 인스턴스를 넘기고, sentinel node도 넘기고(얘는 leaf node로 지정되는 null 노드라고 보면 돼), ngx_rbtree_insert_timer_value 는 함수인데 들어가보면 객체의 key 비교문이 구현되어 있어. nginx는 이 rbtree를 이용해서 node의 우선순위 큐처럼 쓰고 있는거지.

다음으로 타이머를 생성하던 ngx_http_set_keepalive 함수를 어디서 호출하는지 찾아볼게.

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

이렇게 연결 종료 시점의 핸들러에서 keepalive 속성 여부로 set_keepalive 함수가 호출되거나 아니면 연결을 그대로 끊는걸 볼 수 있어.


여기까지 keepalive 설정 시 어디서 호출하는지, 그리고 타이머 객체의 생성과 red-black tree에 넣는 것까지 알아봤어. 이제 이게 어디서 구동되는지 찾아볼 차례야.

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

rbtree.root가 sentinel, 즉 등록된 타이머가 없으면 -1을 반환하고, rbtree 멤버 중에서 ngx_rbtree_min으로 가장 작은 key(시간)를 알아내고 여기서 현재 시간을 뺀 값을 반환하게 돼. 다음 타이머가 작동하기 전까지의 시간을 뜻하는거야.

왜 timer 객체가 아니라 다음 타이머까지의 시간을 구하냐면 find_timer 함수의 호출부로 가보면 알게 돼.

ngx_process_events_and_timers(ngx_cycle_t *cycle)
{
  timer = ngx_event_find_timer();
  flags = NGX_UPDATE_TIME;
  (void) ngx_process_events(cycle, timer, flags);
  ngx_event_expire_timers();
}

엄청 축약했지만 여기서 중요한 건 ngx_process_events를 호출한다는거야. 저 함수는 define문으로 아래처럼 지정되어 있어. (ngx_event_expire_timers 함수 호출하는 것도 중요하니 잠깐 기억해 놔.)

#define ngx_process_events   ngx_event_actions.process_events

ngx_event_actions는 모듈별 이벤트 동작을 설정하는데 src/event/modules 폴더 아래에 ngx_iocp_module.c, ngx_epoll_module.c, ngx_select_module.c 등등.. 설정된 모듈 타입에 따라 해당 모듈을 연결하게 돼. 여기선 iocp를 기준으로 살펴볼게.

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

우리가 찾아볼 함수는 ngx_iocp_process_events 함수야. 이제 거의 다 왔어.

ngx_int_t ngx_iocp_process_events(ngx_cycle_t *cycle, ngx_msec_t timer, ngx_uint_t flags)
{
  rc = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR) &key, (LPOVERLAPPED *) &ovlp, (u_long) timer);
  ovlp->event->handler(ev);
}

저 GetQueued...함수는 i/o 완료 이벤트가 들어올 때까지 블로킹되는 함수인데 마지막 인자로 timer가 들어가지? 저 시간만큼 대기하다가 이벤트가 들어오지 않으면 반환하게 되는 역할이야. 그래서 이전에 find_timer에서 가져온 시간은 여기에 쓰여.

그럼 실제 keepalive 핸들러는 어디서 호출하냐면 ngx_event_expire_timers 함수에 답이 있어. 여기가 마지막 함수니까 좀 길더라도 자세히 볼게.

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

rbtree가 비었거나 가장 작은 key가 현재 시간보다 크면 반환하고, 아니라면 등록된 타이머 객체의 이벤트 핸들러를 하나씩 호출하고 있어. 여기서 실제 rbtree의 삭제도 이뤄지고, 아까 이벤트 핸들러에서 보던 플래그 설정이 이뤄지게 되지.


여기까지 nginx의 keepAlive 구현을 알아봤어. 이전 글에서 node의 keepalive는 타이머를 우선순위 큐에 등록해서 사용했잖아? nginx는 rbtree에 등록한다는 점만 다르고, 등록 타이밍이나 실행같은 메인 구조는 비슷한 걸 알 수 있었어.

결론)
1) nginx의 keepAlive는 타이머 핸들러를 시간 순으로 정렬하여 순차적으로 실행한다.
2) 이 때, 정렬 및 타이머 저장은 red-black tree를 사용한다.
3) 전반적으로 node의 keepAlive와 비슷한 구조이다.


이거 외에 전반적으로 과거에 유행하던 기법들이라 코드 분석하면서도 재밌었어. 예를 들면 flow를 제어하고 싶은 전체를 for로 묶어두고 continue와 break로 goto처럼 제어하는 거라던가.. (아래 코드)

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

요즘에 저렇게 짜서 PR보내면 무수한 코멘트(=악플)를 받을 일이지. 그 외 flag로 쓰이는 변수나 union, bitfield 같은 것도 여기저기 보여서 참 오래된 코드라는게 느껴졌어. 

사실 nginx는 잘 사용하기도 쉽지 않은데 코드를 제대로 보는게 가능할 지 긴가민가 했는데 실제로 해보니 크게 어렵진 않더라고. 오히려 추상화 레벨이 낮아서 분석이 편한 것도 있고..

그럼 재밌게 읽고 다음에 또 봐.

p.s 블로그에 덧글 기능도 추가했어. 지나간 글에 대한 문의는 거기를 이용해줘. 그리고 아이디랑 태그도 블로그 기준으로 바꿨으니 참고해줘.
https://frogred8.github.io

#frogred8 #nginx #keepalive