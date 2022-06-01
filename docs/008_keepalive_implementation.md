---
layout: default
title: "[javascript] http 모듈의 keepAlive 구현"
---

## [javascript] http 모듈의 keepAlive 구현 

<pre>
이전에는 커맨드 별 api 테스트 방법을 알아봤는데 이거쓰면서 alive 구현이 궁금해졌어. 왜냐하면 내가 서버측에서 keepAliveTimeout을 변경해봤는데 어느 포스팅에서 알려주기로는 keepAliveTimeout과 headersTimeout을 같이 바꿔야 한다는 얘기가 있어서 node 18버전에서 실제로 해보니 keepAliveTimeout만 바꿔도 잘 적용되더라고.

그래서 그 '루머'에 대한 내용을 조금 더 찾아봤는데 2019년에 버그가 있었을 때에 작성된 우회 코드가 전설처럼 계속 내려오는 거였어. https://github.com/nodejs/node/issues/27363#issuecomment-603489130

이거랑 별개로 연결을 자동으로 끊어주려면 timer 객체를 사용할 것 같기도 한데 특화된 다른 시스템으로 하는걸까 싶기도 해서 이번에 살짝 파봤어.


일단 node 코드를 받아야겠지? git clone https://github.com/nodejs/node.git 로 간단히 받아주고 가이드에 나온대로 아래처럼 컴파일을 해봤어.

> xcode-select --install
> ./configure
> make -j4
> sudo ./tools/macos-firewall.sh

이러면 node 컴파일 완료~ ./configure debug 라고 하면 디버그 모드로 빌드도 되는 것 같은데 굳이 그렇게까지 볼 필요는 없어서 그냥 릴리즈로 ㄱㄱ

프로젝트가 크다 보니 make가 꽤 오래 걸려. m1에어에서 20분 넘게 걸리더라고. 어쨌든 빌드하면 ./node로 실행시킬 수 있어. (막상 해놓고보니 눈으로 따라가도 충분해서 딱히 필요는 없었던걸로..)

어쨌든 이제 준비는 끝났으니 코드를 좀 볼까? node의 http 모듈은 대부분 js로 작성되어 있고 libuv 함수와 연결하는 부분이 주로 내부 함수로 구현되어 있어. Server 클래스는 _http_server.js 파일에 있고.

function Server(options, requestListener) {
  storeHTTPOptions.call(this, options);
  if (requestListener) {
    this.on('request', requestListener);
  }
  this.on('connection', connectionListener);
  ....

생성자에서 받은 option을 storeHTTPOptions 함수를 통해 적용시키고, 연결이 완료되었을 때에 connectionListener 함수를 호출하도록 설정해주는 코드야. 

저 리스너 함수를 쭉 따라가면 소켓에 이벤트 핸들러 초기화 부분도 있고, 파서 설정 부분도 있는데 대세에는 영향이 없으니 넘어가고 중요한 부분만 볼게.

function connectionListenerInternal(server, socket) {
  if (server.timeout && typeof socket.setTimeout === 'function')
    socket.setTimeout(server.timeout);
  socket.on('timeout', socketOnTimeout);
  ....

여기서 socket에 있는 setTimeout을 호출하는데 이건 net.js 파일에 prototype 함수로 설정되어 있고, 연결된 함수는 stream_base_commons.js 파일에 선언되어 있어.

Socket.prototype.setTimeout = setStreamTimeout;

function setStreamTimeout(msecs, callback) {
    ....
    this[kTimeout] = setUnrefTimeout(this._onTimeout.bind(this), msecs);
    if (this[kSession]) this[kSession][kUpdateTimer]();
  }

저기 kTimeout은 심볼로 등록된 고유키인데 this는 소켓 객체니까 결론적으로 소켓마다 kTimeout 키에 setUnrefTimeout으로 하나씩 등록시킨다고 볼 수 있어. 여기서 _onTimeout 함수 바인딩을 해주는데 가장 마지막에 호출될거니 일단 기억해놓자. 그럼 연결된 함수를 봐야겠지?

function setUnrefTimeout(callback, after) {
  const timer = new Timeout(callback, after, undefined, false, false);
  insert(timer, timer._idleTimeout);
  return timer;
}

여기서 Timeout 객체를 생성해서 타이머를 받게 돼. Timeout 클래스 생성자에는 값 초기화 정도만 해주니 넘어가고, 이번엔 insert 함수랑 거기서 쓰이는 전역 변수를 볼건데 여긴 좀 길어. 타이머 등록에서 가장 중요한 부분이거든.


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

timerListMap은 키는 밀리세컨드, 값은 링크드리스트를 사용하고 있는 map이고, timerListQueue는 밀리세컨드 기준으로 정렬되는 우선순위큐 자료구조야. 왜 map 안에 링크드리스트가 있냐면 같은 시간에 동작하는 타이머가 여러 개일 경우에 리스트로 추가되어 해당 시간이 되면 리스트를 돌면서 타이머를 호출하게 되는거지.

그리고 insert할 때마다 이전에 등록된 nextExpiry 전역 변수와 현재 입력한 만료 시간을 비교해서 타이머 작동 시간을 줄일지 결정하게 돼. 그 때 호출하는 scheduleTimer 함수는 timer.cc 파일의 internal 함수인데 아래처럼 libuv 함수인 uv_timer_start를 이용해 RunTimers를 호출하고.

void Environment::ScheduleTimer(int64_t duration_ms) {
  if (started_cleanup_) return;
  uv_timer_start(timer_handle(), RunTimers, duration_ms, 0);
}

여기까지가 타이머 등록 부분이야. 이제 저렇게 등록된 타이머가 실제로 실행되는 RunTimers 함수를 볼게.

void Environment::RunTimers(uv_timer_t* handle) {
  ....
  Local<Function> cb = env->timers_callback_function();
  do {
    ret = cb->Call(env->context(), process, 1, &arg);
  } while (ret.IsEmpty() && env->can_call_into_js());

타이머 콜백을 여기서 호출하는데 그 콜백 설정하는 부분은 node 초기화를 진행하는 node.js 파일(!)에서 하더라고.

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

setupTimers 함수에서 세팅하는 함수는 결국 processTimer 함수인데 여기 코드를 보면 이전에 전역 변수였던 우선순위큐에서 순서대로 뽑아다가 listOnTimeout함수로 넘기는걸 볼 수 있어. (아래 참고)

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

그럼 이제 대장정의 끝인 listOnTimeout 함수를 보자고.

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

여기서 드디어 최초 timer 등록 시 넘겨준 콜백인 _onTimeout 함수를 호출하게 돼. 현재 시간에 등록된 여러 개의 타이머 리스트를 돌면서 쭉 호출해주고 마지막에 해당 리스트 객체 삭제 및 우선순위 큐에서 빼는걸 볼 수 있어.

결론)
1) node의 KeepAlive는 타이머로 구현되어 있다
2) KeepAlive가 켜져있을 때 연결된 소켓마다 타이머를 하나씩 등록한다
3) node의 타이머는 우선순위 큐와 맵으로 구성되어 다음 만료 시간에 순차적으로 동작한다

원래 nginx랑 다른 애들 구현부도 비교해보고 싶었는데 여기까지 하는데도 꽤 걸렸고 너무 길어질 것 같아서 그냥 마무리하려고. 나중에 조금 더 보거나 해야지.

아. 그리고 결국 깃헙 블로그를 하나 만들었어.
https://frogred8.github.io/

며칠 전만 해도 만들 생각이 전혀 없었는데 1) IT 엔지니어 글이라 블라에 가입하지 않은 사람에겐 내용 공유할 방법이 없었고, 2) 이메일 변경 시 이전 글을 수정/삭제할 수 없다는게 좀 그렇더라고. (잘못된 정보가 그대로 남는건 좀..) 3) 무엇보다 설치형 블로그를 10분 만에 빠르게 생성할 수 있다는 글에 혹해서 시작했는데 이것저것 설정하고 옵션도 바꾸니까 꼬박 하루가 넘게 걸리더라.

어쨌든 이전과 바뀐건 없고, 저 블로그는 그저 공유&백업 용도니 참고해.


#javascript #node