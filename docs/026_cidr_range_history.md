---
layout: page
title: "[network] CIDR 표기법의 역사"
date: 2023-06-18
---

<pre>
CIDR 표기법이 나온 이유에 대해 조금 더 알아본 내용을 정리해봤어. 대부분 아는 내용일거라 살짝 고민했는데 그냥 내가 공부했던걸 남에게 설명해주면서 정리하는게 가장 오래 기억되길래 가볍게 쓴 글이니 편하게 읽어줘.


- 태초 마을
인터넷이 개발되었을 때에 IP는 크게 두 가지 영역으로 구분하여 의미를 부여했어. 앞쪽은 네트워크ID, 그 나머지는 호스트ID 두 개로 말이야. 우리가 흔히 얘기하는 class가 네트워크ID 영역이고, 나머지 비트를 호스트ID라고 불러. 그런데 책에 있는 설명을 볼때마다 이해가 힘들었던게 class별 범위였어.

A: 1.0.0.0~126.255.255.255
B: 128.0.0.0~191.255.255.255
C: 192.0.0.0~223.255.255.255
D: 224.0.0.0~239.255.255.255
E: 240.0.0.0~255.255.255.255

D,E는 브로드캐스팅 및 예약된 영역이라 실제 사용은 A,B,C 세 개만 한다고 하는데 A class에서 1~126이라는게 정확히 무슨 의미를 가지고 있었는지 잘 와닿지 않더라고. (아래 B 범위랑 뭐가 다르지?) 요즘엔 CIDR(Classless Inter-Domain Routing)를 사용해서 할당하는게 너무 자연스러워서 말이지.

이를 알기 위해서는 과거 상황을 이해할 필요가 있는데 IP의 최초 설계 철학은 확장성보다는 속도를 중요시했어. IP가 42억개나 있는데 이게 부족할 줄은 꿈에도 몰랐거든. 그 때의 컴퓨터는 오로지 학술용이니까 확장성에 대한 고민 자체가 필요없던거지.

어쨌든 빠른 속도를 더 추구하다보니 첫 번째로 나오는 0비트의 위치로 해당 IP의 네트워크ID 범위를 결정하는 고정적인 인터페이스를 채택하게 돼. 이 방식은 라우터에 전달할 정보가 없어도 되고 별다른 계산을 할 필요가 없으니 속도가 빠르고 사람이 보기에 파악도 쉬웠던거지.

그래서 첫 비트가 0이면 A class, 두번째 비트가 0이면 B class, 세번째가 0이면 C class로 명명하는 규약을 세우게 돼. IP의 4옥텟 중에 첫 옥텟을 비트로 표현해보면 이렇게 표시할 수 있어.

A: 0xxx xxxx (0~127)
B: 10xx xxxx (128~191)
C: 110x xxxx (192~223)

그래서 첫 옥텟이 1~126으로 시작하는 IP는 A, 128~191은 B, 192~223은 C class로 명명하고 라우터에서는 그 클래스에 따라 읽어들일 네트워크ID 비트를 결정하게 되는데 A는 8비트, B는 16비트, C는 24비트를 네트워크ID로 사용하고 나머지 비트를 호스트ID로 설정하여 그 범위만큼의 IP를 가질 수 있었어. 이걸 각 비트별 범위로 표시하면 이렇게 나와.

class: network id/host id (ip개수)
A: 8/24 (1677만개)
B: 16/16 (6.5만개)
C: 24/8 (256개)

class가 가지는 범위는 저렇게 나오는데 IPv4에서 할당할 수 있는 각 class 개수는 어떨까? A class는 126개, B는 1.6만개, C는 200만개까지 사용할 수 있는데 알다시피 이 방식은 금방 한계에 부딪히게 돼.

만약 5천개의 IP가 필요한 회사가 있으면 어떤 대역을 받아야 할까? 혹은 같은 회사지만 부서마다 10개씩 나눠서 관리할 필요가 있다면 어떨까?

첫번째 질문에 대한 답은 B는 6.5만개라서 이 중에 10%만 사용하겠지만 C로 받으면 20개 정도를 받아야 할거야. 라우팅 테이블이 커지면 당연히 IP찾는 속도도 오래 걸리고, 관리도 쉽지 않아.
두번째 질문도 쉽지 않은데 가장 작은 할당 범위인 C class(256개)로 부서개수만큼 할당이 필요할거야. 엄청난 낭비지.

첫번째에 대한 정답은 후술하고, 두번째 문제를 먼저 볼게.

- 추가적인 계층 구조
사실 IP대역을 크게 하나 받는건 IP 낭비의 영역이었지 문제가 되진 않았어. 그것보다 대형 기관에서 IP를 범위로 지정할 방법이 없다는게 당장 닥친 문제였어. 라우팅 테이블에서 매번 전체 호스트IP를 관리해야 했으니까.

그래서 네트워크ID, 호스트ID 두 계층으로 사용하던 구조에서 호스트ID를 두 개로 나눠 서브넷ID, 호스트ID를 사용하게 돼. 그래서 최종적으로는 네트워크ID, 서브넷ID, 호스트ID인 3계층 구조를 구성해서 내부 네트워크를 구성하기 시작했어.

물론 서브넷을 사용하려면 추가적인 서브넷 마스크 정보가 라우터에 입력되어 있어야 했는데 이 서브넷 마스크는 네트워크ID와 서브넷ID가 1로, 호스트ID는 0으로 표기하기로 정의했어. 아래 B class 네트워크에 7비트 서브넷ID로 구성한 예를 볼게.

123.32.0.0 (B class)
255.255.254.0 (subnet mask)
11111111.11111111.11111110.00000000 (subnet mask bit)

이 서브넷 마스크를 보면 B class니까 앞에 16비트를 1로 표기해줬고, 이후에 7비트 서브넷ID이라서 1이 7개 연속으로 들어가고 그 이후에 9개 비트가 0으로 표기된 걸 볼 수 있어. 저 비트만큼이 호스트ID인거지.

따라서 저 서브넷ID만 봐도 9비트 호스트 개수인 512개 대역을 가지고 있는 라우팅 테이블인걸 알 수 있을거야.
이런 식으로 큰 주소 하나를 받아서 서브넷으로 여러 라우터에 분산시키면 별도의 IP 범위를 관리할 수 있어서 두번째 문제가 어느 정도 해결됐어.

다만 여전히 첫번째 문제가 남았는데 IPv4에서는 A class가 126개밖에 없는데다가 각 클래스 범위가 현실에서 사용하기에 지나치게 크다는거야. 이를 해결하기 위해 나온게 현재 사용 중인 CIDR 표기법이야.

- CIDR
이전의 클래스로 지정하는 방식은 유연성이 떨어졌기 때문에 아예 클래스를 배제한 방식이라 이름도 Classless! Inter-Domain Routing이야. 이는 서브넷의 개념을 전체 인터넷으로 확장하기 위해서 만들어졌어.

그래서 이제 범위를 비트 단위로 지정할 수 있게 되었고, 이로 인해 IP의 큰 낭비없이 최적의 범위만 사용할 수 있게 되었어. 예전에는 7천개의 IP가 필요하다면 C class 28개 혹은 B class를 받아서 관리해야 했지만 지금은 /19 block을 받으면 간단히 사용할 수 있어.

CIDR: 15.28.32.0/19 (8,192개)
범위: 15.28.32.0 ~ 15.28.63.255


- 결론
1) IP는 네트워크ID와 호스트ID로 나눠져 있다.
2) 예전엔 네트워크ID 비트수에 따라 클래스로 구분된 범위로 식별했다.
3) 이에 대한 단점을 보완하기 위해 서브넷 마스크를 사용하기도 했다.
4) 현재는 서브넷 개념을 확장한 CIDR를 사용하는게 일반적이다.

이전글: https://frogred8.github.io/
#frogred8 #network #ip #cidr