---
layout: page
title: "[network] tcp 3-way handshake"
date: 2024-04-27
---

<pre>
얼마 전에 wireshark를 사용하면서 tcp 3-way handshake 패킷을 열어본 적이 있는데 생각보다 재미있는게 많아서 공부한 내용을 정리해봤어.

- 개요
3-way handshake는 네트워크 면접 질문에서도 많이 나오지? 이를 기초서 수준으로 설명하면 '클라-서버 연결을 위해 서로 주고 받는 최초 3개의 패킷' 정도로 표현할 수 있을거야. 여기서 조금 더 아는 사람은 SYN->SYN/ACK->ACK 타입 패킷이라고 설명하는 사람도 있어.
그럼 이 클라-서버의 handshake에서는 정확히 어떤 정보를 주고 받는걸까? 그냥 살아있는지 핑퐁치고 끝나진 않을거잖아? 이걸 하나씩 알아볼거야.

- packet? segment?
먼저 이 개념을 잘 알아야 packet fragment (패킷 단편화)가 설명되니 한번 짚고 갈게.
우리가 흔히 얘기하는 tcp/ip에서 tcp는 osi 4단계, ip는 osi 3단계 프로토콜을 말해. (NIC는 2단계)
이 때, osi 단계별 규약에 따라 정보의 캡슐화가 일어나면서 최종 모습은 아래처럼 하나의 데이터로 오게 되는데 이를 header 정보를 통한 역캡슐화로 단계별 실제 정보를 가져올 수 있어

[l2 content][l3 content][l4 content]..

osi 1단계는 물리적 영역이니 논외로 하고, 2단계부터 보면 각 단계별로 부르는 정보 단위가 서로 달라. 나중에 이게 좀 헷갈리니까 레이어 간 부르는 명칭을 잘 기억해둬야 해.

l2 (data link): frame
l3 (network): packet
l4 (transport): segment
l5~7 (app.): data

여기서는 l3, l4인 ip, tcp만 볼건데 대략적인 정보는 이렇게 구성되어 있어.

ip: src/dest ip, fragment flags, time to live, length, checksum..
tcp: src/dest port, seq/ack number, flags, window, options (mss, sack..)

간단히 두 개 프로토콜의 기본 컨셉만 설명해보면, ip는 구성된 패킷을 어느 경로로 보낼건지 path finding을 위한 정보가 있고, tcp는 전송받은 세그먼트의 유효성과 순서를 관리하여 정보를 재구성하는데 필요한 정보들이라고 보면 돼.

그런데 handshake는 tcp레벨에서 이뤄지는데 왜 ip까지 설명하나 싶겠지? 후술할 tcp.options 중에 mss에 대한 설명 시 이런 토막 지식도 필요해서 간단히 넣어봤어. 우선 IP 정보에 대해 설명하고, 이후에 tcp handshake를 알아볼거야.


- IP (packet)
누가 봐도 자명한 필드는 넘기고 IP의 주요 필드 두 개만 볼게.

* fragment flags
패킷이 라우터의 MTU(maximum transmission unit) 보다 클 때에 단편화 할건지 알려주는 flag값이야. DF(don't flagment)가 설정되어 있으면 단편화 처리를 하지 않게 돼.
만약 MTU를 넘어서는 패킷을 받게 되면 해당 라우터에서는 그 패킷을 버리고 송신자에게 ICMP(internet control message protocol)로 can't fragment 에러와 함께 현재 라우터의 MTU를 보내게 돼. 저 값에 맞춰서 다시 보내라는거지.

다만 이게 자동으로 이뤄지는건 아니고 저 에러를 받은 송신측에서 ICMP DF error 처리 정책에 따라 달렸어. 그래서 vpn을 사용할 때 가끔 특정 서버로 접속되지 않거나 패킷 전송이 실패하는 이유가 MTU를 넘어서는 패킷에 DF가 설정되어서 해당 서버에서 ICMP 에러를 보내지 않는 정책으로 되어있거나, 보냈다 하더라도 이걸 받아온 vpn측 서버에서 재처리하지 않아서 그럴 수 있어.
그럴 때는 내 host에서 MTU를 낮춰주면 속도는 조금 떨어지겠지만 접속은 가능할 수 있으니 우회해서 한 번 시도해 봐.

관련된 내용은 path MTU discovery로 찾으면 많이 나오는데 여기 잘 나와있더라.
https://packetlife.net/blog/2008/aug/18/path-mtu-discovery

* time to live (TTL)
흔히 hop이라 부르는 녀석이야. 보통 64로 지정되어 있고, 경로(라우터)를 지날 때마다 1씩 줄어드는데 0이 되면 해당 패킷은 폐기되고 송신자에게 ICMP time exceeded 에러를 반환하도록 되어 있어.
이건 좀 다른 얘기지만 traceroute 명령은 이를 활용하여 구현되어 있는데, TTL 1부터 순차대로 ICMP echo request를 요청하면 time exceeded 에러를 받으면 TTL을 하나 더해서 다시 요청하는 방식으로 쭉 경로를 스캔하면서 라우터 응답 속도를 측정하는 방식이야. 다만 방화벽이나 내부 라우터 설정으로 외부 ICMP에 응답하지 않도록 되어있다면 timeout나면서 * 로 나오는 경로도 있고 그래.
경로만 간단히 체크할거면 세개씩 보내던 쿼리를 1개로 줄이고, timeout을 1초로 해놓으면 조금 낫더라.
traceroute -q 1 -w 1 [url]


- TCP handshake (Segment)
이제야 본론이야. 3-way handshake는 클라와 서버가 SYN -> SYN/ACK -> ACK 순서로 주고받는데 순차적으로 어떤 정보가 오가는지 하나씩 확인해볼거야.


- SYN
tcp 연결 시 클라에서 서버로 보내는 첫 세그먼트야. 여기서는 연결을 요청하는 클라 정보를 보내고 있어.

* sequence number (이하 seq number)
패킷의 순서 동기화를 위해 클라에서 발급한 32비트 난수야. 0~2^32-1 범위를 가지고 있고, 추후에 그 범위를 넘게 되면 0으로 순환하게 돼. 이건 뒤에 나올 acknowledgement number도 동일한 룰을 가지고 있어.
예) Sequence Number: 751742043

* acknowledgement number (이하 ack number)
SYN 요청에서는 아직 서버에서 받은게 없기 때문에 0으로 설정해서 전달하게 돼.
예) Acknowledgement Number: 0

* header length
이름만 봐도 알 수 있지? 다만 특이한 건 실제 계산된 값은 해당 비트수*4로 이뤄지기 때문에 4비트만 할당되었지만 최대 60바이트까지 표현할 수 있어. 아래 예시는 이진수야.
예) header length: 1011 (44byte)

* flags
PUSH, RESET, SYN 등 해당 세그먼트의 타입을 설정한 값인데, 3-way handshake의 최초 두 개 세그먼트에서만 SYN 플래그를 활성화시켜서 보내고 있어. wireshark에서 볼거면 필터에 tcp.flags.syn==1 로 넣어보면 SYN, SYN/ACK 두 개만 나와서 찾아보기 편해.
예) flags(bit): 0000 0000 0010 (SYN)

* window
sliding window 알고리즘에서 사용할 클라 window 값이야. 이건 뒤에 window scale에서 조금 더 볼거야.
예) window: 65535

* checksum
tcp segment의 무결성 체크를 위한 checksum 값.
예) checksum: 0xf580

* urgent pointer
URG flag가 켜져있는 segment에 한해서 긴급 데이터의 위치를 나타내는 파라미터래. 처음보는거라 뭔가 했더니 범용적으로 사용하진 않는다고 하네.
예) urgent pointer: 0

* options
tcp option은 아래같은 공통 스키마로 구성되어 있고, type에 따라 읽어내는 데이터 개수가 달라.
Kind: option type
Length: 해당 option의 전체 크기
Data1(,Data2..): type에 따른 순차 데이터

보통 4개의 주요 옵션을 보내는데 네트워크 설정에 따라 다를 수 있지만 일반적인 케이스로 알아볼게.

* option - MSS
Maximum Segment Size 값인데 MTU(maximum transmission unit)랑 살짝 다른게 MTU는 네트워크 레이어 단에서의 최대 패킷 사이즈(보통 1500)를 나타내고, MSS는 MTU에서 IP header(20)+TCP header(20)를 뺀 최대 세그먼트 사이즈(보통 1460)을 말해.

만약 이 값이 설정되지 않은 채로 온다면 IPv4 스펙의 기본값인 536 바이트로 설정되어 전송 효율이 낮아질 수 있어. 왜냐하면 연결하는 호스트 간에 설정된 MSS 중에서 가장 낮은 값으로 통신하게 되어있거든. (IPv6 기본값은 1220)

예)
Kind: 2
Length: 4
MSS Value: 1460
(이후부터는 option이라 하더라도 value만 적을게)

* option - Window Scale
tcp 스펙에 있는 window 크기는 최대 64kb만 지원하기 때문에 이에 대한 확장이 필요했는데 이미 정해진 필드를 바꾸기는 상당히 힘든 일이야. 그래서 rfc 1072에서 제안되었고, tcp 확장 옵션에 window scale 옵션이 추가되는데 이 값만큼 window 값을 2^n을 곱해서 적용하게 돼. (일반적인 shift 연산)

window size = tcp.window << option.window_scale

예) Window Scale: 6

만약 window가 64kb, scale값이 6이라면 4mb로 확장된 window size를 뜻한다는 걸 알 수 있어.
64kb << 6 = 4096kb

* option - TSval, TSecr
연결 간의 RTT(Round trip time, 왕복 시간), RTO(Retransmission timeout, 재전송 만료시간) 측정을 위해 사용하는데, 혼잡 제어나 여러 판단의 근거가 되는 데이터라고 보면 돼. 여기서는 연결을 요청한 클라의 Timestamp value만 넘어왔고, 서버에서 보낼 때 Timestamp echo reply를 채우게 될거야.

예) 
TSval: 12191741
TSecr: 0

* option - SACK permitted
tcp 공부 좀 해봤다면 알만한 selective acknowledgement 옵션의 설정 여부야. tcp에서는 하나의 큰 데이터가 여러 개의 세그먼트로 분리되어 도착할 때 중간에 유실된 세그먼트가 있으면 그 부분부터 다시 받는게 기본 구현이야. 이를 재요청 시에 이미 받은 세그먼트 정보를 같이 전달해서 누락된 세그먼트만 받아오는 기능이 rfc 1072에 추가되었는데 이게 sack야.
이건 기능이 켜있을 때만 보내기 때문에 Kind, Length만 가지고 있는 옵션이기도 해.


- SYN/ACK
휴. 드디어 두번째 세그먼트야. 첫 세그먼트는 클라 정보, 이에 대한 응답인 두번째 세그먼트는 서버 정보가 채워져서 서로 연결 정보를 전달한다고 보면 돼. 보내는 정보는 이전과 거의 동일한데 추가된 값의 의미만 조금 더 알아볼거야.

* flag
이전에는 syn만 켜졌지면 여기서는 ack 플래그도 켜진 채로 전달해.
예) flags(bit): 0000 0001 0010 (ACK,SYN)

* seq number / ack number
클라에서는 seq만 넘겨줬는데 이 값이 서버에서 응답할 때는 ack로 가게 되고, 서버에서도 seq를 난수로 채워서 넘겨주게 돼. 이 때, 값이 증가하는 규칙은 세그먼트 크기만큼 더해져서 전달하는데 예외적으로 최초 3-way handshake 에서는 +1씩 더해진 값이 전달되고 있어.

예)
Sequence Number: 3055224127
Acknowledgement Number: 751742044

* option - TSval, TSecr
이전에는 echo reply가 0으로 채워졌지만 여기서는 echo reply에 전달받은 클라 timestamp value가 설정되고, timestamp value에는 서버 값을 채워서 전달해.

예) 
TSval: 330256684
TSecr: 12191741


- ACK
마지막 세번째 세그먼트는 기본 헤더에서 flag만 바뀐 채 timestamp option(TSval, TSecr)만 전달하고 있어.

* flag
syn가 꺼지고 ack만 켜진 상태.
예) flags(bit): 0000 0001 0000 (ACK)

* option - TSval, TSecr
첫번째-두번째 세그먼트 사이의 latency가 17ms였는데 이게 반영되어 세번째 세그먼트에서 timestamp가 바뀐 걸 볼 수 있어.

예)
TSval: 12191758 (이전: 12191741)
TSecr: 330256684


- 결론
1) 3-way handshake 간에는 연결되는 피어 간 정보 전달이 주로 이루어진다.
2) tcp는 한번에 완성된 규약이 아니라 지속적인 확장 기능의 추가를 통해 개선된 결과물이다.
3) wireshark는 거의 완벽한 툴.

사실 path MTU discovery는 별도로 다뤄볼만한 주제긴 한데 같이 정리하느라 사족이 좀 많아진 것 같네. 가독성은 별로 안좋아졌지만 누군가 도움되는 사람은 있겠지.

이전글: https://frogred8.github.io/
#frogred8 #network #tcp #handshake