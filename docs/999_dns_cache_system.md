---
layout: page
title: "[WIP][network] dns cache 동작 분석"
date: 2025-02-20
nav_exclude: true
search_exclude: true
---

<pre>
잘못된 내용이 포함되어 있어서 나중에 검토 후 재작성



dns에 대해 책에서 살펴보면 dns서버에 도메인 주소를 넘겨주고 ip를 가져와서 응답하는 시스템이라고 써있고, 이를 로컬에서 캐시해서 사용한다고만 알려져 있어. 내가 이전에 dns나 getaddrinfo 시리즈로 썼던 글이 사실 저 dns 로컬 캐시를 알아보기 위한 여정 중에 알게된 내용을 정리한거였어. 이 글은 그 마지막 여정으로 이전 글을 읽고 오면 조금 더 이해가 쉬울거야.


- 개요
이전 글에서 nsswitch.conf 파일에서 dns 질의할 순서를 정할 수 있다고 했어. 보통은 files (/etc/hosts), dns (지정된 dns 서버로 쿼리) 순서로 지정되어 있는 편이야.
여기에 dns 캐시 레이어를 추가로 설정할 수 있는데 nscd, systemd-resolved, nss-resolve 세 종류가 주로 쓰이게 돼. 
아래에서는 각각의 캐시 서비스들의 특징과 어떤 식으로 구현되어 있는지 주요 부분만 살펴볼거야.


- nscd (Name Service Cache Daemon)
이건 glibc에서 초기에 구현된 네임 서비스 캐시 데몬 서비스인데, 현재는 systemd 기능으로 대체되면서 잘 안쓰이는 상태야. 다만 glibc에 여기저기 nscd 관련된 함수가 많으니 간단히만 볼게.

dns 얻어오는 함수에서 get_nscd_addresses -> __nscd_getai -> __nscd_gethostbyname_r -> nscd_gethst_r -> __nscd_cache_search 함수로 이어지는 여정 끝에 구현 코드를 발견할 수 있는데 아래처럼 의사 코드로 축약해 볼 수 있어.


// nscd_helper.c
struct mapped_database *mapped;
mapped = __nscd_get_map_ref (GETFDHST, "hosts", ...);
long hash = __nss_hash (key, keylen) % mapped->head->module;
while (work != ENDREF) {
  struct hashentry *here = (struct hashentry *) (mapped->data + work);
  ref_t here_key = atomic_forced_read (here->key);
  if (memcmp (key, mapped->data + here_key, keylen) == 0) {
    return (struct datahead *) (mapped->data + here->packet);
  }
  work = atomic_forced_read (here->next);
}

코드를 하나씩 보면, 먼저 nscd의 전체 map에서 hosts 이름인 db를 찾고, 찾으려는 도메인 이름을 hashing하여 이 db의 헤더에 있는 module값으로 나머지 연산을 해서 hash 버킷을 구하게 돼. 그 이후에 버킷에 chaining 방식으로 구성된 리스트를 순회하며 검색하는 방식이야.
dns 캐시는 특성상 수천개를 넘어가진 않을테니 전체를 해시테이블로 두지 않고 이런 식으로 하는게 메모리도 아끼고 검색 성능에 여러가지로 이득이 되긴 할 것 같아.

이건 사족이지만, 저기에서 쓰인 atomic_forced_read 매크로는 아래처럼 간단한 인라인 어셈인데 컴파일러 최적화를 막고 항상 메모리에서 직접 읽어오도록 volatile 변수처럼 사용한거라고 보면 돼.
#define atomic_forced_read(x) ({ __typeof (x) __x; __asm ("" : "=r" (__x) : "0" (x)); __x; })

만약 캐시에 값이 없다면 소켓을 열어서 실제 dns 요청을 보내게 되는데 함수는 이런 순서로 불리게 돼.
__nscd_open_socket -> wait_on_socket -> __poll -> _hurd_select -> _io_select_request

저기 wait_on_socket 호출할 때 보면 time값이 코드 내에 5초로 하드코딩되어 있어서 nscd에서 dns 요청 만료 시간은 5초 고정으로 되어있는걸 확인할 수 있어. 가장 마지막에 불리는 _io_select_request 함수는 또다른 외부 프로젝트인 hurd의 함수인데 안에 보니까 mutex락으로 이벤트 대기하고 그러던데 더 깊이 들어가면 지나치게 커져서 일단 여기까지만 보는 걸로..

참고로 hurd 프로젝트는 GNU 커널 프로젝트 중 하나인데 공식 릴리즈는 꽤 오래전이지만 아직 마스터 브랜치에는 계속 기능 추가 중이더라. 64bit 포팅이 쉽지 않나 봐.


- nscd deamon 구조
이런 nscd daemon은 별도 실행 파일을 만들 수 있도록 glibc에서 main 함수가 따로 분리되어 있어. 개별 실행해야하는 데몬이니까 당연한 얘기긴 해.

// nscd.c
static const char *conf_file = "/etc/nscd.conf";
int main(...) {
  nscd_parse_file(conf_file, dbs);
  nscd_init();
  start_threads();  
}

실제 코드는 훨씬 길지만 주요 함수만 축약해보면, nscd_parse_file 함수는 nscd config 파일을 읽어와서 dbs 변수에 넣게 되는데 그 기본값은 c파일에 이렇게 입력되어 있어. 설정 파일이 없거나 따로 설정된 값이 없다면 코드에 써진 이게 기본값이 될거야.

// connections.c
struct database_dyn dbs[lastdb] =
{
  [pwddb] = {...},
  [hstdb] = {
    .db_filename = "/var/db/nscd/hosts",
    .postimeout = 3600,
    .negtimeout = 20,
    ...
  },
  ...
}

설정에서 중요한 변수만 가져왔는데 첫번째 설정인 db_filename은 캐시 시스템에서 미리 입력된 호스트 파일을 말하고, 두번째인 postimeout은 positive timeout, 이는 dns 외부 검색이 성공했을 때 기본적으로 3600초의 시간만큼 캐시하라는 의미를 뜻해. 원래 dns query를 보내면 자신의 만료 시간인 ttl도 같이 전달해주는데 만약 만료 시간이 없다면 이 값으로 설정하게 돼.
다음 값인 negtimeout은 negative timeout의 약자인데 dns 검색이 실패했을 때 20초 내에 들어오는 동일한 도메인 검색에 대해서는 dns 서버로 검색 요청을 보내지 않고 캐시 레이어 단에서 바로 실패했다고 응답하라는 설정값이야.

설정 파일 읽어오는걸 봤으니 다시 nscd의 main 함수로 돌아와서, nscd_init()에서는 config에서 설정된 파일을 읽어서 메모리에 db를 생성하고, mutex 객체나 소켓 초기화 등의 역할을 하고 있어.
그리고 start_threads()는 nscd_run_worker 함수로 n개만큼 스레드를 만들어서 데몬으로 들어오는 이벤트를 처리하도록 되어 있고 말이야. 

여기까지 glibc에 있는 dns 캐시 시스템인 nscd가 어떻게 되어있는지 알아봤는데 다음은 systemd-resolved를 볼게.


- systemd-resolved 설명
systemd는 리눅스에서 자주 쓰이는 외부 서비스 관리 기능 프로그램인데 systemd-resolved 역시 nscd처럼 데몬 형식으로 뜨는 서비스야. 이건 외부 시스템이기 때문에 원래 리눅스에 포함되어 있진 않고 별도로 설치해야 사용할 수 있지만 대부분의 리눅스 배포판에서는 systemd가 기본적으로 설치되어 있기 때문에 아마 바로 쓸 수 있을거야. 최소한 우분투에는 그냥 깔려있더라고.
보통 리눅스 시스템 레벨에서 자세히 제공하지 않은 기능이 이걸로 많이 확장되어서 이제 동일한 컨셉의 기능이라도 systemd에서 더 많은 기능을 제공하기도 해. 이는 리눅스의 특정 기능들이 systemd에 종속성을 가지게 되어서, 원래 작은 메모리로도 부팅이 가능했던 임베디드에서조차 사용하려는 기능에 따라 systemd를 띄워야 돌아가는 상황이 나오기도 한대. (=용량/부팅시간 증가)
그런데 같은 기능의 pr이라도 공식 리눅스 레포에 올리는 거랑 systemd 레포 중에 뭐가 더 쉬울지 생각해보면 사실 앞으로도 자잘한 기능은 systemd를 통한 확장이 더 많을 것 같긴 해.


- systemd-resolved 설정 및 테스트
systemd에서 확장된 systemd-resolved(이하 resolved) 서비스는 dns 캐시가 주요 기능인데 /etc/resolv.conf 에 dns loopback ip(127.0.0.53)를 설정해야 작동해. 그 원리는 resolved 서비스가 뜨면 127.0.0.53:53 으로 로컬 dns 서비스가 실행되고, 여기로 dns 요청을 보내면 resolved 서비스가 받아서 자신의 캐시에 있는지 확인한 후 외부 dns로 보내는 방식이야. 그리고 여기서 받은 외부 dns의 응답을 저장했다가 동일한 도메인의 요청에는 외부 통신없이 캐시를 반환하는거지.

이건 사족이지만, 아래 테스트 결과를 제대로 얻기까지 꽤 많이 헤멨어. 
내가 원래 예상했던 동작은 로컬 dns의 실패 응답을 받고 나서 외부 dns로 요청을 보내는건데, 실제로는 로컬 dns로 패킷을 보내고 아직 응답을 받지도 않은 상태인데도 외부 dns인 8.8.8.8(구글 dns)로 자꾸 보내는거야.
dig로 보낸 dns 요청을 tcpdump로 패킷 캡쳐해보면 아래처럼 매번 2번의 요청/응답이 오가고 있었어.

ubuntu@instance:~$ dig www.google.com +noall +answer
www.google.com.		26	IN	A	142.250.199.100

ubuntu@instance:~$ sudo tcpdump -i any -n port 53
11:54:27.336571 lo    In  IP 127.0.0.1.42201 > 127.0.0.53.53: 62917+ [1au] A? www.google.com. (55)
11:54:27.336752 ens3  Out IP 10.0.0.142.46731 > 8.8.8.8.53: 25045+ [1au] A? www.google.com. (43)
11:54:27.336840 lo    In  IP 127.0.0.53.53 > 127.0.0.1.42201: 62917 1/0/1 A 142.250.199.100 (59)
11:54:27.371598 ens3  In  IP 8.8.8.8.53 > 10.0.0.142.46731: 25045 1/0/1 A 172.217.26.228 (59)

여기 보면 nic가 lo, ens3 두 개가 있는데 0.0002초 차이로 연속으로 전송하고, 응답을 먼저 받은 lo 응답(62917)이 dig 명령에 대한 반환값이 되고, ens3로 보낸 외부 dns 반환값(25045)은 그대로 사라지는걸 볼 수 있어. 의미없는 외부 통신인거지.
자꾸 결과가 제대로 안나와서 설정을 했다 지웠다, 서비스도 재시작해보고, systemd도 다시 깔아보고 등등.. 

그러다가 결국 찾아냈는데, resolved 서비스에서 외부 dns 서버 설정을 하려면 /etc/resolv.conf, /etc/systemd/resolved.conf 파일 두 개 모두 dns 서버에 dns loopback ip(127.0.0.1)를 써야 하고, 실제 외부 dns 서버로 변경해야 하는 곳은 NIC(Network Interface Controller, 즉 랜카드)에 적용된 dns 서버였어. 
사실 아무런 설정을 하지 않고 dns loopback ip만 써도 기본 설정된 dns 서버(169.254.169.254)로 캐시가 잘 작동했거든? 그런데 내가 외부 dns 서버를 바꿔서도 동작하는걸 보고 싶어서 했던 설정이 잘못된거지. 그래서 netplan으로 NIC의 dns 서버를 8.8.8.8로 변경해주니 이제야 내가 설정한 외부 dns 서버를 통해 제대로 요청했어.

ubuntu@instance:~$ sudo netplan status
Online state: online
DNS Addresses: 127.0.0.53 (stub)

1: lo ethernet UNKNOWN/UP (unmanaged)
MAC Address: 00:00:00:00:00:00
Addresses: 127.0.0.1/8

2: ens3 ethernet UP (networkd: ens3)
MAC Address: 02:00:17:00:30:02 (Red Hat, Inc.)
Addresses: 10.0.0.142/24 (dhcp)
DNS Addresses: 8.8.8.8
               169.254.169.254

아래 tcpdump 결과를 보면 4초에 요청한 응답이 lo, ens3(외부nic) 순서대로 요청이 갔는데, 8초에 요청한 패킷을 보면 외부 dns 요청없이 캐시된 항목으로 반환하는걸 볼 수 있어. 

ubuntu@instance:~$ sudo tcpdump -i any -n port 53
12:23:04.048922 lo    In  IP 127.0.0.1.52022 > 127.0.0.53.53: 35049+ [1au] A? www.google.com. (55)
12:23:04.049194 ens3  Out IP 10.0.0.142.33078 > 8.8.8.8.53: 33516+ [1au] A? www.google.com. (43)
12:23:04.092553 ens3  In  IP 8.8.8.8.53 > 10.0.0.142.33078: 33516 1/0/1 A 216.58.220.100 (59)
12:23:04.092836 lo    In  IP 127.0.0.53.53 > 127.0.0.1.52022: 35049 1/0/1 A 216.58.220.100 (59)

12:23:08.348417 lo    In  IP 127.0.0.1.48951 > 127.0.0.53.53: 25319+ [1au] A? www.google.com. (55)
12:23:08.348606 lo    In  IP 127.0.0.53.53 > 127.0.0.1.48951: 25319 1/0/1 A 216.58.220.100 (59)

아무래도 네트워크 엔지니어가 아니다보니 이론적인건 대충 알지만 어디에 설정해야 하는지 헤메는 부분이 많더라고. 혹시 내가 잘못 알고 있는 부분은 덧글로 알려주면 고맙게 배울게.


- systemd-resolved 세부 구조
resolved 서비스는 DBus(Desktop bus)와 dns loopback ip를 사용하여 요청과 응답을 처리하고 있어. DBus를 조금 더 자세히 설명하면 외부 프로그램 간의 IPC 역할을 한다고 보면 돼. glibc에서도 연결된 버스 호출하는 부분이 있고(nss-resolve), resolvectl query www.google.com 으로 외부 프로그램에서 dns 요청을 할 때에도 연결된 버스를 사용해서 가져오는데 dns loopback을 사용하는 것보다 훨씬 효율적이라고 해. 아무리 로컬 네트워크라도 보내고 받는 비용이 크긴 하겠지.

resolved는 이렇게 두 개의 다른 인터페이스를 지원하고 있으니 리눅스 한정 low level로 더 빠른 dns 캐시 시스템을 사용하고 싶으면 systemd 코드에서 io.systemd.Resolve.ResolveHostname 키워드의 버스 등록 및 사용부를 참조해봐도 좋을거야.
다만 서로 다른 인터페이스라도 결국 캐시를 검색해보고 없으면 외부 dns서버로 요청하는건 동일하니 이쪽이 궁금하면 공통 함수인 dns_query_go 함수 구현부를 잘 따라가면 돼. 나중에 hashmap 자료구조로 chaining하는 함수까지 찾으면 거기가 끝이야.


- systemd-resolved 세부 구현부 추적

일단 glibc에 있는 nsswitch 시스템에서 _nss_##module##_gethostbyname_r 같이 선언부만 있는 함수들이 있는데 실제 구현부는 systemd 프로젝트에 존재하고 있어. systemd에서는 nss_resolve라는 모듈을 제공하는데 glibc의 nsswitch 에서 이 모듈에 있는 _nss_resolve_gethostbyname_r 함수를 호출하면 DBus(Desktop bus)를 통해 io.systemd.Resolve.ResolveHostname 이벤트를 전달하고, systemd-resolve 데몬에 해당 이벤트와 연결된 함수가 호출되면서 systemd-resolve 서비스에서 dns 로컬 캐시 검색, 요청 및 갱신 등의 동작이 발생하는거야.

저렇게 외부 모듈을 연동하기 위해서 두 개의 설정파일이 필요한데, .sym파일은 외부로 노출될 심볼 목록을 제공하고 meson.build 파일은 동일 폴더의 .sym 파일을 읽어서 내보낼 심볼을 정의하고 제공하고 있어. 




캐시 미스일 때에 dns 요청은 udp로 시도해보고 실패하면 소켓 열어서 tcp로 하던데 코드까지 설명하면 너무 길어지니까 관심있는 사람은 systemd 프로젝트의 아래 함수를 참고해 봐.
dns_transaction_emit_udp / dns_transaction_emit_tcp


- resolvectl 사용법
그리고 systemd-resolve 데몬에 있는 정보를 볼 수 있는 명령어가 있는데 그게 resolvectl 명령이야. 아래처럼 사용할 수 있어.

root@instance:~# resolvectl show-cache
www.google.com IN A 172.217.175.68
www.google.com IN AAAA 2404:6800:4004:824::2004

그런데 저기서는 ttl을 표시해주지 않아서 남은 캐시 시간을 확인하려면 dig를 사용해야돼. 저기서는 47초 남은걸로 나오네.

root@instance:~# dig www.google.com +noall +answer
www.google.com.		47	IN	A	172.217.175.68


- nss-resolve
세번째 캐시 시스템인 nss-resolve인데 이건 기본으로 깔려있진 않아서 아래처럼 추가 설치가 필요해.

sudo apt install libnss-resolve

설치하고 nsswitch.conf를 이렇게 바꿔주면 이제 host를 찾을 때에 nss-resolve를 사용하여 찾게 돼.

hosts: files resolve dns

만약 libnss-resolve 패키지를 설치하지 않은 상태로 설정하면 모듈을 찾지 못해서 dns 쿼리할 때 모듈 로드가 실패할거야. strace로 시스템 콜을 확인해보면 이렇게 에러를 확인할 수 있어.

ubuntu@instance:~$ strace getent hosts naver.com 2>&1 | grep resolve
openat(AT_FDCWD, "/lib/libnss_resolve.so.2", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
openat(AT_FDCWD, "/usr/lib/libnss_resolve.so.2", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
...




libnss-resolve는 glibc에서 이벤트가 어떻게 전달되는지 플로우를 자세히 살펴볼게.




- nsswitch의 dns 요청
dns 캐시 시스템 설명이 꽤 길었는데 어쨌든 기본값은 캐시를 안쓰는거니까 보통 hosts 파일에 찾고자 하는 도메인이 없으면 dns 서버로 요청하게 될거야. 이 부분에 대한 코드는 glibc에 있는데 추상화때문에 꽤 멀리 가야해서 어차피 과정은 중요하지 않으니 중간은 생략해볼게.

_nss_dns_gethostbyname3_r -> ... -> __res_context_send 함수까지 오면 dns 요청할 프로토콜에 따라 tcp일 경우에는 send_vc, udp는 send_dg 함수로 가게 되는데, send_vc만 잠깐 보면 __writev 함수가 불리면서 dns 쿼리가 네트워크로 전달되고, while문으로 원하는 정보가 수신될 때까지 대기하는 로직이 나오게 돼. 이렇게 dns 쿼리를 직접 호출하는 부분을 찾을 수 있었어.
여기에 dns timeout이나 기타 설정에 따라 분기되는 부분도 같이 있으니 궁금하면 저 함수를 따라가봐도 재미있을거야.


- 분석 소회
처음에 dns 캐시 구현에 대해 생각하기엔 어디 메모리에 대충 저장되어 있을줄 알았는데 이렇게까지 추상화되고 glibc, systemd, hurd 등의 여러 프로젝트가 연동되어 있다는게 참 놀라웠어. 
이것저것 보다보니 리눅스가 점점 systemd에 종속성을 가지게 되는걸 경계해야 된다는 의견도 어느 정도 이해가더라. 서로 키워드가 공유되는게 꽤 있어서 독립적으로 수정하기 쉽지 않을 것 같은 느낌도 들고..

그리고 이렇게 dns 관련된 주제 세 개가 끝났는데, 조금 큰 주제로 써보니 글로 쓰기 위한 지식은 참 다르구나 싶었어. 분석을 다했다고 생각하고 글로 쓰려고 보니 뭐이리 모르는게 많던지.. 이번에 유독 글로 표현하기 힘든 내용이 많아서 못내 아쉽고 그러네. 그래도 아는대로 키워드를 최대한 많이 써놨으니 누군가에겐 도움이 되길 바랄게.


- 결론
1) 도메인 검색은 /etc/nsswitch.conf 파일의 hosts 항목에 나열된 항목 순서에 따라 작동한다
2) dns 캐시는 os에서 관리하지 않고 별도 서비스에서 구성하고있고, 그 종류에는 nscd와 systemd-resolve가 있다.
3) 현재 nscd는 deprecated 상태라서 systemd-resolve를 많이 사용한다.
4) dns 캐시의 현재 상태를 알아보려면 resolvectl과 dig를 사용하면 간단히 볼 수 있다.


이전글: https://frogred8.github.io/
#frogred8 #network #getaddrinfo
</pre>
