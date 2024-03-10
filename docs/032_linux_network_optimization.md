---
layout: page
title: "[etc] linux 6.8의 tcp optimization"
date: 2024-03-10
---

<pre>
이번 linux kernel 6.8 업데이트에 tcp 성능을 최대 40% 향상시켰다는 글을 우연히 보게 되어서 그 변경점이 궁금해서 자세히 찾아본 내용이야.

- 개요
일단 자세히 들어가기 전에 커널 버전 얘기를 잠깐 해볼게.
리눅스는 1년에 두세번 minor 버전 커널 업데이트를 하는데 major로 넘어가는 시점은 minor 숫자가 커지는 그 어느 시점이라고 해. major 버전 4,5에서 넘어간 히스토리를 보면 대충 minor 번호가 19,20번쯤 되면 넘어가는 듯.

아래 사이트에 리눅스 커널 릴리즈가 잘 정리되어 있는데 일부 버전은 LTS (long-term support) 이후에 CIP (civil infrastructure platform) 기간이 길게 추가된 걸 볼 수 있어.
https://www.wikiwand.com/en/Linux_kernel_version_history

CIP는 2017년쯤에 새롭게 추가되었는데 특정 산업용을 위해 25~50년 지원을 목표로 하는 SLTS (super long-term support) 개념을 도입한거고, 아래 CIP가 지원하는 플랫폼을 보면 일반 개발자 대상은 아니라는걸 알 수 있을거야.
https://wiki.linuxfoundation.org/civilinfrastructureplatform/ciptesting/cipreferencehardware

그리고 6.x 버전에 와서는 LTS 기간이 6년에서 2년으로 대폭 줄었는데 이게 또 궁금해서 찾아봤더니 커널 개발자가 두 가지 이유를 설명했는데, 1. 사람들은 LTS 버전을 업데이트 해놔도 잘 사용하지 않고, 2. 개발 인력이 점점 더 부족해져서 기간을 줄이기로 했대.
https://www.zdnet.com/article/linux-kernel-6-6-is-the-next-long-term-support-release/

위에서 말한건 리눅스 커널 버전인데 우리는 18.04, 22.04 같은 버전에 익숙하잖아? 왜냐하면 보통 리눅스 커널을 그대로 사용하는게 아니라 이 커널로 만든 리눅스 배포판을 사용하기 때문이야. 개발자면 보통 ubuntu를 쓸테고 점유율만 보면 redhat, centos도 자주 쓰이나 봐.

그래서 이 ubuntu 배포판이 사실은 우리가 보는 os버전의 느낌인데, 우분투는 2년마다 LTS 버전을 내놓고 해당 버전은 최대 10년의 지원을 해주고 있어. 올해 4월에 나올 ubuntu 24.04 LTS에서는 linux 6.8 커널을 사용하기로 했길래 그 변경 사항을 살펴보다가 눈길을 끄는 항목이 있어서 분석해봤어.


- 주요 내용
아래 6.8 업데이트를 보면 tcp 커넥션에 대한 성능이 최대 40% 개선되었다는 내용이 있는데, 특히 intel보단 amd 아키텍쳐에서 대단히 큰 개선을 보여주고 있어.
https://www.phoronix.com/news/Linux-6.8-Networking

최적화의 큰 방향은 network 사용 시 접근하는 변수들의 cacheline을 적게 유지하면서, cache coherence (캐시 일관성)을 높이는 수정을 했다고 하는데, 이 글에서는 cacheline 감소와 cache coherence 증가, 그리고 왜 amd 아키텍쳐에서 더 큰 개선이 이뤄졌는지 세 가지로 살펴볼게.

- cacheline 감소
최적화 작업에서 가장 중요한 건 현재 상태의 측정과 평가가 우선 진행되어야 하는데 역시 커널 개발자분이라 조사를 아주 잘 해놨더라고. 6.5 커널 기준으로 분석한 커밋인데 network 내의 각 변수가 read_mostly 인지, write_mostly 인지 싹다 정리해서 올려놨으니 한번 구경해 봐.
https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=14006f1d8fa24a2320781ad503ca1cba92e940d2

저 커밋 메시지를 자세히 보면 조사한 내용을 기반으로 아래 항목들을 개선했는데 캐시 라인 수가 꽤 많이 줄어든 걸 볼 수 있어.
name        cacheline
---------------------
tcp_sock     12 -> 8
net_device   12 -> 4
netns_ipv4    4 -> 2

이게 왜 중요하냐면 모든 cpu에는 캐시 메모리가 있는데 network든 뭐든 연산을 위해서는 일단 필요한 데이터가 있는지 L1 캐시를 탐색하는 작업을 하게 되고, 여기서 없으면 캐시 미스가 발생해서 L2, L3, 메모리 탐색까지 가면서 latency가 점점 늘어나게 되니 캐시힛이 성능에 매우 중요한 역할을 할 수 밖에 없어. 
(이에 대한 자세한 예시와 설명은 아래 예전에 쓴 글을 참고해)
https://frogred8.github.io/docs/014_cache_line/

그래서 캐시힛이 되려면 L1 캐시에 항상 들어있어야 하는데 보통 코어당 64KB 정도 뿐이고, 이를 또 쪼개서 L1i, L1d로 나누니까 실제 데이터용 캐시는 32KB, 그리고 하나의 캐시 라인 용량이 64Byte니까 512개의 캐시 라인만 저장 가능한 상황이야. 게다가 요즘엔 하이퍼스레드로 두 개씩 돌아가니 하나의 프로세스가 점유하는 캐시 용량은 더 적어지게 되고.

이럴 때 유지할 캐시 라인 개수를 감소시킨다면 캐시힛 확률이 훨씬 높아지겠지. 총 개수만 세봐도 기존: 28개 -> 개선: 14개로 캐시 유지 용량이 절반으로 줄어들었으니까. 이게 첫번째 주요 개선 사항이야.

- cache coherence 증가
하나의 캐시 라인에 담겨있는 데이터 중에 하나의 변수만 변경되어도 그 캐시 라인 전체가 만료되어 캐시 갱신을 요청하게 돼. 아래처럼 생긴 구조체가 있다고 생각해볼게.

struct {
  int id;
  int lv;
  int exp;
  char name[20];
  ...
}

여기서 캐시 일관성을 가장 자주 깨는 항목이 뭘까? exp는 몬스터 한 마리 잡을 때마다 변경되니까 이 값이겠지?
그럼 L1 캐시에서는 이 작은 구조체를 하나의 캐시 라인에 들고 있지만 exp가 변경될 때마다 캐시 갱신이 필요하게 되면서 성능이 나빠질거라 예상할 수 있어.

그럼 캐시 일관성을 어떻게 증가시킬 수 있을까? 
변경 빈도에 따라 캐시 라인을 별도로 구성하는게 가장 좋은 전략일거야. 그래서 커널 개발자가 초반에 모든 network 변수에 대해 read_mostly, write_mostly 분류를 먼저 만들어 놓았고, 이에 따라 read_mostly 변수만 모아놓는다면 그 캐시 라인은 캐시 일관성이 거의 깨지지 않은 상태로 유지되어 캐시힛 확률이 훨씬 올라가게 되는거야. 

이는 특히 여러 스레드로 공유되는 tcp 정보에 매우 유리한 상황이 되겠지. 캐시 일관성은 공유 자원에 특히 취약하니까. 아래는 이 방향성으로 수정된 커밋 중 하나야.
https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=18fd64d2542292713b0322e6815be059bdee440c

이거 외에도 커밋이 두세개 더 있는데 간략히 분석해보니 파라미터의 min/max값, 최초 생성 시 설정되는 값들은 read_mostly로 모아놨고, 소켓의 누적 recv/send 데이터 크기나 sequence number, 갱신 시간 등은 write_mostly로 잘 분리했더라고.

- amd에서 더 큰 개선이 이루어진 이유
자세한 캐시 정책은 어차피 알기 어렵지만 큰 방향성은 동일할거라는 가정 하에 비슷한 급의 cpu를 비교해봤어. 

Intel Core i7-12700
L1 Instruction Cache: 8 x 32 KB
L1 Data Cache: 8 x 48 KB
L2 Cache: 8 x 1280 KB
L3 Cache: 25 MB
https://www.cpubenchmark.net/cpu.php?id=4669

AMD Ryzen 7 5800
L1 Instruction Cache: 8 x 32 KB
L1 Data Cache: 8 x 32 KB
L2 Cache: 8 x 512 KB
L3 Cache: 32 MB
https://www.cpubenchmark.net/cpu.php?id=4188

intel은 코어 당 L1d, L2 캐시를 amd에 비해 50%이상 크게 가지는 대신 L3 용량이 적은 특징을 확인할 수 있어. 그래서 첫번째 항목의 최적화로 캐시 라인 수를 줄인게 상대적으로 캐시 용량이 적은 amd의 성능 개선에 더 큰 영향을 주었을거라고 강한 예상을 해봄.

번외로 이 커밋을 주도한게 구글 내부 팀인데, 구글은 amd epyc cpu를 클라우드에 대규모로 도입할만큼 amd의 적극적인 벤더라서 이런 커널 수정도 주도적으로 진행하나봐. 나같은 개발자는 변경 사항도 거의 안보고 '버전 높은게 좋은거겠지'하고 쓰기에도 바쁜데.. 세상에는 참 똑똑한 사람이 많아서 다행이야.


- 결론
1) linux kernel 6.8에는 캐시 라인/캐시 일관성 최적화로 다수의 tcp 연결 상황에서 큰 성능 개선이 이뤄졌다.
2) 사이드이펙트 없는 간단한 수정에 비해 얻을 수 있는 성능 개선 효과가 무척 좋다.
3) 다만 이런 방향의 수정은 업데이트가 지속될수록 유지하기가 쉽지 않은 컨셉이라 걱정되지만, 커널 개발자 분들이니 어련히 알아서..
4) 다음 달에 나오는 ubuntu 24.04 LTS 버전에 linux kernel 6.8이 바로 들어가는데, 프로덕트 레벨에서 적용하여 측정해봐도 좋을 것 같다.
5) 오픈소스 개발자 분들의 노고에 항상 ㄱㅅ

이전글: https://frogred8.github.io/
#frogred8 #linux #network