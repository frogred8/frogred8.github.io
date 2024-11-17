---
layout: page
title: "[network] getaddrinfo 세부 구현 분석 (2)"
date: 2024-11-17
---

<pre>
이전글에서는 node -> getaddrinfo 시스템 함수 호출까지 바인딩되는 부분을 알아봤는데, 여기서는 getaddrinfo 함수랑 nsswitch 시스템, 그리고 dns 요청에 대한 전반적인 흐름을 살펴볼게. 곁다리 정보도 같이 다루다보니 꽤 길어졌는데 잘 모르는 단락은 그냥 넘어가도 될거야.
이전글: https://frogred8.github.io/docs/035_getaddrinfo_implementation_node/

getaddrinfo 함수의 posix 구현체는 GNU C 라이브러리에 있는데 glibc 프로젝트를 받아보니 쉽게 찾을 수 있었어.
여기서 핵심적인 구조체 두개의 구조와 할당, 사용에 대해서 먼저 보고 갈게.


- addrinfo와 sockaddr 구조체
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

함수에서 최종적으로 반환되는 값은 addrinfo 구조체로 구성되는데, 소켓 타입이나 프로토콜, ipv4/6 family 등 여러가지가 있고, dns가 목록으로 구성될 때를 대비해서 다음 addrinfo 구조체의 포인터도 가지고 있어.
참고로 변수 앞에 붙은 접두어 ai는 AddrInfo의 약자고, 이후에 살펴볼 함수의 접두어 gaih는 GetAddrInfoHelper, at는 AddrTuple 약자니까 살짝 기억하고 있으면 좋아. 이 함수에서 생성하는 에러 이름은 전부 EAI_* 로 시작하는데 이렇게 접두어 의미를 알아놓으면 코드 분석이 참 편하더라.

다음은 addrinfo에서 실제 ip 정보가 구성되는 sockaddr 구조체야.

struct sockaddr
{
  __SOCKADDR_COMMON (sa_);  // unsigned short int sa_family; (2byte)
  char sa_data[14];
};

여기서 sa_data가 아무 정보없이 14바이트인게 이상했어. ip를 문자열로 구성한 정보가 들어있다면 '123.123.123.123'으로 15바이트 혹은 null문자 포함 16바이트가 할당되어야 하거든.

그런데 사용처를 검색하다가 알게 되었는데 sockaddr 구조체는 사실 포인터 정보만 저장하는 역할이고, family type(IPv4,6)에 따라 구조체 크기만큼 더 할당해서 거기를 바라보게 해놓고, 사용할 때는 타입에 따라 강제 캐스팅해서 사용하는 방식을 쓰고 있었어. 실제 저장되는 주소값은 IPv4는 4바이트, IPv6는 16바이트를 사용 중이야.

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

위와 같은 구조체를 실제로 할당할 때에는 family type으로 분기하여 메모리 할당 크기가 달라지는데 여기 아이디어가 재미있어. 

if (family == AF_INET6) {
  socklen = sizeof (struct sockaddr_in6);
} else {
  socklen = sizeof (struct sockaddr_in);
}
struct addrinfo *ai;
ai = malloc (sizeof (struct addrinfo) + socklen);
ai->ai_addr = (void *) (ai + 1);

addrinfo+socklen 만큼의 메모리를 한번에 할당받아서 시작 주소는 addrinfo 변수로 받아놓고, ai_addr 변수에는 포인터 연산으로 ai+1 의 결과인 sizeof(addrinfo) 이후에 할당된 용량인 socklen 만큼의 메모리를 가리키게 돼서 결국 메모리는 이런 식으로 구성하게 돼.

| addrinfo(32byte) | sockaddr_in(16byte) |
| addrinfo(32byte) | sockaddr_in6(28byte) |

이걸 사용하는 부분에서는 아래처럼 타입에 따른 포인터 강제 캐스팅으로 메모리를 접근하게 돼. 포인터를 잘 모르면 선뜻 이해가 안될 수 있는데 천천히 보다보면 이해될거야.

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


- getaddrinfo 함수 구성
기본 구조체인 addrinfo, sockaddr 구조체를 자세히 살펴봤으니 실제 함수를 볼게.

// posix/getaddrinfo.c
int getaddrinfo (char *name, char *service, struct addrinfo *hints, struct addrinfo **pai);

이 시스템 함수는 보통 이런 식으로 호출할 수 있어.
getaddrinfo("www.google.com", "80", NULL, &result);

이제 함수의 기능을 차근히 살펴볼게.

먼저 100줄 가량의 파라미터 유효성 검사와 hints 분석을 하는 간단한 로직이 나오고, 그 다음으로 scratch_buffer 구조체를 초기화한 이후에 메인 함수인 gaih_inet 함수를 부르고 있어. (위에서 말했듯이 gaih는 GetAddrInfoHelper 약자야) 이 함수의 반환값으로 도메인의 ip를 알아올 수 있어.

// getaddrinfo.c
struct scratch_buffer tmpbuf;
scratch_buffer_init (&tmpbuf);
gaih_inet (name, pservice, hints, pai, &naddrs, &tmpbuf);
scratch_buffer_free (&tmpbuf);

여기서 저 의문의 구조체에 대해 잠깐 보고 갈게.


- scratch buffer
struct scratch_buffer {
  void *data;
  size_t length;
  union { max_align_t __align; char __c[1024]; } __space;
};

이 버퍼는 특이하게 별도의 scratch_buffer_init 함수로 초기화한 이후에 사용할 수 있는데 init, free, grow 함수를 보면 왜 그런지 알 수 있어.

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

구조체에서 생성된 scratch.buffer 변수는 init 함수를 호출하면 scratch_buffer.__space.__c 포인터가 scratch_buffer.data 변수로 연결되어 구조체에 할당된 1024바이트를 사용할 수 있는데, 저기 보이는 grow 함수 호출로 현재보다 2배 더 큰 힙메모리를 할당하거나 다른 함수(set_array_size)로 크기를 재할당도 가능해.
이 자료구조는 glibc 프로젝트에서 함수가 reentrant(재진입성)을 충족하기 위해 주로 사용하는데, getaddrinfo 함수도 reentrant 가능하도록 함수 호출 파라미터에 저런 버퍼를 미리 만들어서 전달하고 있어. reentrant는 thread-safe랑 비슷하지만 살짝 다른 개념인데 찾아보면 많이 나오니 설명은 생략할게.

이렇게 만든 scratch 변수(tmpbuf)와 함께 gaih_inet 함수를 호출하게 돼. 이후 코드부터는 다수의 분기문과 함수들이 참 많아서 여기서 한 스텝만 더 들어가도 꽤나 많은 추상화와 define문으로 이해가 힘드니 코드는 최대한 생략하고 설명으로 풀어볼게.


- nsswitch (Name Service Switch)
이전 글에도 언급했지만, dns에 대해 나와있는 책이나 글을 보면 대부분 hosts 파일 검색 -> dns 캐시 검색 -> dns 서버로 요청 순으로 되어있는데 nsswitch.conf 설정에 따라 그 순서를 바꿀 수 있어. 예를 들어 hosts 항목에서 files를 지우고 dns를 앞에 놓는다면 파일 검색없이 바로 dns 서버로 요청한다거나 하는 것 말이야.
nsswitch는 dns 외에도 다른 서비스도 많은데 해당 서비스에 요청 시 검색할 우선순위를 지정할 수 있어. 설정 파일은 대충 이런 식으로 생겼어.

// etc/nsswitch.conf
passwd:         files systemd
group:          files 
hosts:          files dns
...

os로 요청하는 각 서비스 이벤트가 저 순서대로 검색해서 반환하게 돼.

그런데 저기 hosts 라인을 보면 캐시 레이어가 없지? 맞아. 기본값에는 명시적인 dns 캐시 레이어가 없고 캐시 레이어는 별도로 선택할 수도 있는데 그 중 하나인 nss-resolve는 resolve 키워드로 dns 캐시 레이어를 추가 설정할 수 있어. 
(ex. hosts: files resolve dns)

만약 다른 dns 캐시로 systemd-resolved 기능을 이용하고 싶으면, resolv.conf 파일에 dns loopback ip (127.0.0.53)를 dns 서버로 설정해서 모든 dns 요청이 systemd-resolved 서비스로 전달하여 처리할 수도 있어. systemd-resolved는 nsswitch.conf에 별도로 설정하지 않아도 dns 캐시가 되는 방식이야.

이런 dns 캐시 시스템 종류에는 glibc에서 구현된 nscd, 별도 프로그램인 systemd-resolved, nss시스템을 이용한 nss-resolve 세 종류를 보통 사용하는데 이 글 하나에서 다루기엔 너무 길어져서 dns 캐시에 대한 건 다른 글에서 써볼게. 그 글에서는 아마 시스템 함수에서 해당 시스템까지 어떻게 전달되는지, 실제 dns 캐시 테스트 시 겪은 이슈 같은 주제가 될거야.


- nsswitch 초기화 로직
nss 시스템은 nss 모듈의 함수를 가져올 때마다 해당 모듈의 초기화 여부를 검사하는 방식을 쓰고 있어. 초기화 시점이 애매한 시스템이나 최초 부팅을 최대한 가볍게 하기 위해서 런타임에 약간 손해보는 방식인데 어차피 state 분기 처리라 비용은 거의 없긴 해.

nss 모듈 초기화 코드를 보면 이렇게 files와 dns 키워드에 따라 분기문이 나눠져 있어.

bool module_load (struct nss_module *module)
{
  if (strcmp (module->name, "files") == 0)
    return module_load_nss_files (module);
  if (strcmp (module->name, "dns") == 0)
    return module_load_nss_dns (module);
  ...

저 함수를 계속 따라가면 이런 식으로 define 문이 포함된 함수가 나오는데 function.def 파일에 모듈에서 전달받은 함수 목록의 포인터와 실제 바인딩할 함수가 써있어.

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

함수 포인터에 순차적으로 바인딩하기 때문에 이 순서가 반드시 정렬되어야 한다고 주석으로 써있기도 해. 저 define 문을 풀면 컴파일 시 만들어지는 코드는 결국 이런 식으로 나올거야.

void **fptr = pointers;
*fptr++ = _nss_files_gethostbyname3_r;
*fptr++ = _nss_files_getnetbyname_r;
...

이렇게 nss 시스템에서 hosts 모듈의 files 타입 관련 함수 테이블이 구성되었어. 다른 서비스의 모듈도 비슷하게 바인딩하더라. (passwd, group 등) 


- nss_action 구성
위에서 nss 초기화 시 만든 함수 테이블을 nsswitch.conf 파일을 읽을 때 nss_action 목록으로 구성하는데 여기서 설정 파일에 따라 동적으로 사용할 수 있게 되어 있어.
만약 nsswitch.conf 파일에 "hosts: files dns"라고 설정하면 nss_action_list에 hosts모듈의 files로 연결된 함수 바인딩 테이블이 먼저 연결되고, 그 다음 포인터에는 dns로 연결된 함수 테이블이 연결되는 느낌이야.
그 함수 테이블은 나중에 __nss_lookup_function 함수에서 __nss_module_get_function을 사용하여 호출하게 돼.


- get_nss_addresses 함수 구성
위에서 nss 시스템을 깊이있게 설명한 이유는 dns를 가져오는 가장 핵심 로직이라서 그래. getaddrinfo -> gaih_inet -> get_nss_addresses -> __nss_lookup_function 으로 이어지거든.

이제 다시 메인 함수로 돌아와서, get_nss_addresses 함수는 본격적으로 추상화된 함수 구현부를 호출하기 때문에 분석이 꽤 까다로운 부분이었어. 이 함수 플로우를 대략적으로 설명하면, 

1. nsswitch.conf 파일의 변경 여부를 확인하여 리로딩이 필요한 지 확인하여 현재 설정을 가져옴
2. 설정대로 nss_action_list 타입의 변수에다가 설정에 나열된 순서대로 nss_action 추가
3. 요청한 서비스(여기서는 hosts) 항목의 nss_action을 순차적으로 실행
4. nss_action의 실행이 성공했으면 바로 반환하고, 실패했으면 다음 nss_action을 호출 (ex. files -> dns)

1,2번은 설정 부분이니 3,4번만 의사 코드와 함께 간단히 설명해보면, 

nss_action_list nip;
__nss_database_get (nss_database_hosts, &nip);
while (1) {
  fct = __nss_lookup_function (nip, "gethostbyname2_r");
  result = gethosts (fct, AF_INET, name, ...);
  if (result == S_OK) return true;
  nip++;
  if (!nip->module) return false;
}

nss에서 hosts의 nss_action_list인 nip를 얻어서 그걸로 연결된 함수 포인터를 가져와서 gethosts 함수에서 해당 함수 포인터를 이용하여 호출하고, 결과가 있으면 반환하고 없으면 다음 nss_action로 가서 반복하는 코드야.
실제로는 훨씬 복잡하고 분기문이 많지만 큰 틀로 보면 별다르진 않을거야.

저 함수 포인터인 fct의 구현체는 hosts 파일은 files-hosts.c, dns에 대한 구현은 dns-host.c 에 _nss_dns_gethostbyname4_r 함수로 구현되어 있는데, 파일은 그냥 파싱한거 검색하는 정도니 dns 구현체만 마지막으로 볼게.


- dns query 구현체
_nss_dns_gethostbyname4_r -> __res_context_search -> __res_context_querydomain -> __res_context_query -> __res_context_send 까지 함수를 타고 오면 dns 요청에 대한 마지막 분기를 볼 수 있어. tcp라면 send_vc, udp라면 send_dg 함수를 호출하게 되는데 기본값은 udp로 보내게 돼.
이 때, 현재의 dns 서버로 열린 소켓이 있으면 그대로 사용하고, 연결이 안되어있으면 새로 dns 서버로 소켓을 열어서 저장했다가 재사용하고 있어. 이 소켓으로 해당 도메인에 대한 ipv4, ipv6 요청 패킷을 연속적으로 보내게 되고, 응답 두 개가 다 돌아올 때까지 기다렸다가 반환하게 돼. 
이를 가지고 가장 처음에 언급한 addrinfo 구조체를 만들어서 반환하면 드디어 dns 요청이 끝나는 거야.
실제 코드들은 흐름제어를 위해 goto문으로 되어있어서 복잡하기도 하고, 설명한 것 이상의 내용이 딱히 없는 평이한 코드라 여기서는 생략할게. 혹시 보고 싶은 사람은 저 키워드로 검색해서 보면 돼.


- dns 서버 목록의 비밀
위에서 dns 서버로 요청하는 곳을 보다가 새로이 알게 된 내용을 하나 더 정리해볼게.
/etc/resolv.conf 파일에는 여러 개의 dns 서버를 설정할 수 있는데, 저 설정 파일을 읽어오는 코드를 살펴보면 dns 서버는 3개까지만 사용이 가능하더라고.

// resolv_conf.c
size_t nserv = conf->nameserver_list_size;
if (nserv > MAXNS)
  nserv = MAXNS; // 이 값이 3
for (size_t i = 0; i < nserv; ++i) {
...

그런데 보통 dns 서버를 여러 개 설정해도 가장 처음 설정된 dns 서버로만 보내는데, 이는 기본값이 첫번째 서버를 사용하도록 설정되어 있고, dns 서버와의 연결에 실패했을 때에만 다음 dns 서버로 요청하는 방식이라 그래.
resolv.conf 파일에 rotate 옵션을 넣으면 처음 요청할 서버도 랜덤하게 선택되고, 요청마다 순차적으로 다른 dns 서버로 요청하게 되어 있어.

// /etc/resolv.conf
nameserver 1.1.1.1
nameserver 2.2.2.2
nameserver 3.3.3.3
options rotate

그런데 roundrobin을 하려면 이전에 보냈던 서버 인덱스를 저장해야 하잖아? 그래서 어떻게 해놨나 봤더니 단순하게 함수에 static 변수로 저장했다가 하더라고. 아래는 그걸 의사 코드로 쉽게 바꿔봤어. (원본 코드에서는 atomic연산을 위해 define이나 복잡한게 좀 있음)

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

global_offset 변수의 최하위 1비트에는 초기화 여부를 저장하고, 사용 시에 비트를 우측으로 밀어서 사용하는 방식이야. 이 함수에서 반환한 nameserver_offset은 이런 식으로 사용될 수 있어.

// res_send.c
int ns_offset = nameserver_offset (statp);
for (int ns_shift = 0; ns_shift < nameserver_count; ns_shift++) {
  int ns = ns_shift + ns_offset;
  sockaddr_in nameserver = statp->nsaddr_list[ns];
  ...

rotate로 설정해도 일회성으로 요청하고 종료하는 프로그램(host, dig)은 동일한 dns를 사용하기도 하던데, 서비스가 계속 살아있으면서 여러번 dns 요청하는건 roundrobin으로 순차적으로 잘 요청하더라. dns 로드밸런싱이 필요할 때만 한번 생각해보면 될 듯.


- 결론
1) 주소 정보(sockaddr 구조체)는 ipv4/v6에 따라 다른 용량의 메모리를 한번에 할당받아서 포인터 연산으로 이를 사용한다.
2) scratch_buffer 자료형은 재진입성(reentrance)을 갖춘 함수 호출을 위해 인자로 전달하여 사용하기도 한다.
3) nsswitch에서는 각 서비스의 요청 순서를 바꿀 수 있고, 리눅스에서 일반적으로 사용되는 dns 캐시 시스템에는 nscd, systemd-resolved, nss-resolve가 있다.
4) dns 서버 목록은 3개까지만 유효하고, rotate 옵션을 추가하면 순차적으로 다른 dns 서버에 요청한다.

이전글: https://frogred8.github.io/
#frogred8 #network #getaddrinfo #dns