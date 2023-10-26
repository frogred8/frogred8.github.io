---
layout: page
title: "[etc] branch predictor와 spectre 취약점"
date: 2023-10-27

---

<pre>
최근에는 (실무와는 전혀 상관없지만) cpu레벨의 branch predictor 관련된 부분을 공부했어. 이론적인 것만 보다가 내용이 깊어지니 spectre attack이랑 엮어진 부분도 보게 되어서 이거랑 같이 소개해보려고 해.

사실 텍스트로만 정리하는게 한계가 있어서 차일피일 미루고 있었는데, 생각해보면 아예 안하는 것보단 나라도 알아보게 정리하는 것도 의미있을 것 같아서 일단 시작해봤어. 나도 잘 모르지만 이해가 되지 않는 부분은 질문해주면 최대한 답변해줄게.


- 개요
스펙터 공격은 2018년 1월에 melt down과 같이 공개된 취약점으로, 주요 내용은 분기 예측 중에 저장되는 메모리 주소를 이용하여 프로그램 내 임의 주소에 접근할 수 있는 방법을 제공하는 취약점이야. 

이 글은 아래 유튜브 링크의 cpu performance 1장에 대한 내용을 기반으로 삼아 여러 곳에서 얻은 정보를 더해서 쓰여졌어.
https://www.youtube.com/playlist?list=PLAwxTw4SYaPmqpjgrmf4-DGlaeV0om4iP
https://spectreattack.com/spectre.pdf
https://blog.cloudflare.com/branch-predictor


- 기본
일단 cpu pipelining 개념을 알아야 이해가 되니까 잠깐 설명할게.
cpu에 하나의 명령이 들어오면 그 명령은 여러 개의 stage를 거치는 파이프라인으로 나눠서 실행하게 돼.
이 stage가 많을수록 초당 처리하는 명령 개수는 많아질 수 있어.

이를 극단적으로 높인 cpu가 인텔 펜티엄4 프레스캇이라는 모델인데 무려 31단계의 파이프라인을 가지고 있다고 해.
인텔이 최초 4Ghz의 벽을 넘기 위해 승부수를 던진건데 결국 발매 초창기부터 끝까지 발열 이슈를 잡지 못해서 단종되고 말았어.
심지어 이전 세대보다 느린 cpu라는 오명도 같이 얻었지.
참고로 요즘 세대는 12~20개 이내 정도의 파이프라인을 가지고 있어.

파이프라인은 슈퍼 파이프라인, 슈퍼 스칼라, 슈퍼 파이프라인 슈퍼 스칼라 등으로 발전했는데 간단히 말하면 동시 실행하는 파이프라인 개수가 늘어났다고 보면 돼.
앞으로의 설명에서는 아래 stage 4개를 기준삼아 설명해볼게.

IF (instruction fetch) - ID (instruction decode) - EX (Execute) - WB (write back)

IF: 명령 가져오기
ID: 명령 해석
EX: 실행
WB: 결과 반환

간단히 예제 한번 보고 갈게. (CL.=clock)

CL.|IF|ID|EX|WB
1   A
2   B  A
3   C  B  A
4   D  C  B  A
5   E  D  C  B
...

A~E까지 5개의 명령이 queue에 들어있을 때에 clock 1~5까지의 파이프라인 실행 결과야. 
이 5개의 명령을 그냥 실행 시 4*5=20clock이 걸릴테지만, 파이프라인은 k+(N-1)=4+(5-1)=8clock으로 파이프라인을 쓰면 2.5배 빠르게 결과를 얻을 수 있어.
만약 파이프라인을 더 작게 잘라서 stage의 실행 시간을 작게 만든다면 한 번에 실행하는 명령 개수가 많으니 더 빠를거야.

여기서 파이프라인 hazard 라고 불리는 3가지 개념도 잠깐 보고 갈게.

1. structural hazard
2. data hazard
3. control hazard


- structural hazard
다른 stage에서 같은 자원을 접근할 때에 발생해. 예를 들면 IF와 WB이 memory 동시 접근, 혹은 ID와 WB이 register에 동시 접근하는 경우를 말해.
이 구조적인 문제는 각각 하드웨어 구조 변경으로 해결했어.

일단 register 접근 시에는 클럭을 반으로 쪼개서 앞쪽 0.5클럭은 register read, 뒷쪽 0.5클럭은 register write를 실행하도록 변경해서, 동시에 실행해도 각각 전/후반부 0.5클럭을 사용하기 때문에 register 접근 시 겹치지 않을 수 있게 구성했어.

memory 접근 문제도 가만히 살펴보면 IF는 명령, WB은 데이터를 저장하기 위해 memory로 접근하고 있어. 따라서 이를 분리해주면 되겠지?
L1 cache 사양을 보면 L1i (instruction), L1d (data)로 나눠져있는데 그게 저 이유야.
IF는 L1i로 접근해서 명령을 가져오고, WB은 L1d로 접근해서 데이터를 쓰도록 한거지.


- data hazard
다음 명령이 이전 명령의 값과 dependency가 걸린걸 말해. 예를 들어 이런 로직이 있으면 b가 WB되기 전까진 c가 대기해야 하겠지.

b=a+1;
c=b+1;

참고로 이건 true dependency라고 불리는 RAW (read after write) 상황인데 false dependency인 WAR, WAW까지 알아보진 않을거야.
저 dependency를 해결하기 위해서는 2stage만큼 대기하거나 forwarding을 이용하는 방법이 있어.
실제 연산 결과는 EX stage 완료 시점에 알 수 있기 때문에 forwarding으로 RAW 명령을 등록해놓으면 WB까지 기다리지 않고 EX가 완료되면 그 결과를 바로 읽어오게 해서 대기 지연을 최소화 시킬 수 있어.

아래 링크의 아키텍쳐를 보면 하단에 forwarding unit이 있고 여기서 받은 데이터를 Mux(Multiplexer)에 넣어서 ALU로 들어가는 걸 볼 수 있을거야.
https://i.stack.imgur.com/1KmO5.png


- control hazard
분기(=branch) 명령을 만나서 다른 주소로 이동하게 된다면 순차대로 실행 중인 이후 명령을 모두 무효화시키고, 이동한 분기 주소에 있는 명령을 처음부터 읽게 돼. 파이프라이닝을 다시 한 번 볼게.

CL.|IF|ID|EX|WB
1   A
2   B  A
3   C  B  A
4   D  C  B  A

여기서 B가 분기문일 때, Q주소의 명령을 실행하게 된다면 5번째 클럭은 이렇게 될거야.

5   Q  X  X  B

이전에 계산했던 C,D는 무효화된거지. 여기서는 stage가 4개뿐이라 커보이지 않지만 stage가 10개, 30개가 넘어간다면 분기문이 다른 주소로 점프할 때에 그 사이의 파이프라인은 모두 버려지면서 분기로 인한 비용이 엄청 커지는거지.

control hazard에 대해서 보통 여기까지가 일반적인 책에 담겨진 내용이야. 
내가 진짜 궁금했던건 실제로 분기 예측이 어떻게 발전되었는지 부분이었는데 이 내용을 처음에 소개했던 동영상에서 자세히 설명해주고 있어. 
유창하게 설명할 수 있을 정도까진 안되지만 아는대로 정리해볼게.


- branch predictor
분기 예측을 한마디로 정리하면, 분기문에서 자주 실행되는 다음 실행 명령 주소를 가져오는걸 말해.

일반적으로 어셈블리에 있는 PC(Program Counter) 레지스터를 통해서 IF(Instruction fetch)할 다음 명령 주소를 가져오게 되는데 cpu에서는 순차적으로 PC+4 (주소는 32비트니까) 주소를 읽게 되어 있어.
만약 분기문을 만날 때 그 분기문이 이전에 실행했던 명령 주소를 다음 명령 주소라고 PC값을 바꿔주면 어떻게 될까? 그럼 IF시에 순차적인 명령 주소가 아닌 실제로 다음에 실행할 명령을 제대로 읽어오겠지?

이 버퍼를 BTB (Branch Target Buffer)라고 불러. 

그런데 실행하는 분기 명령마다 다음 명령 주소를 그대로 저장하는건 비용 낭비가 심해. 왜냐하면 분기문으로 점프하는 곳이 보통 하위 비트 수준에서의 이동이 많거든.
그리고 분기 예측은 1cycle 내에서 제공할 정도로 빨라야 하기 때문에 최대한 적은 데이터로 해시테이블처럼 축약해서 사용해. 

예를 들어, 32비트 cpu에서 BTB 인덱스를 저장한다고 할 때에 이렇게 있다고 치면 상위 비트는 어차피 거의 비숫하니 하위 12비트만 잘라서 저장해볼게.

(32비트)       (하위 12비트)
0x00000010 -> 0x010
0x00000014 -> 0x014

여기서 분기 명령 인덱스를 보면 0x010은 있는데 0x011, 12, 13은 비어있다가 0x014는 다시 사용하게 될거야. 왜냐하면 명령은 32비트니까. 그래서 이렇게 그냥 저장하면 인덱스에 1024개의 연속된 저장 공간이 있다고 할 때, 실제로는 256개만 저장할 수 있을거야.

그럼 최하위 2비트는 항상 00(2진수)임을 보장하니까 하위 12비트 중에 마지막 2비트를 빼고 12번째 비트부터 3번째 비트까지 10개 비트만 저장하면 1024개를 다 사용할 수 있지 않을까?

(주소)    (2진수)            (하위 2비트 삭제)  (최종 주소)
0x010 -> 0000 0001 0000 -> 00 0000 0100 -> 0x004
0x014 -> 0000 0001 0100 -> 00 0000 0101 -> 0x005

물론 12비트를 넘어가는 주소값은 해시 중복이 되는데 애초에 전체 분기문의 다음 명령 주소를 모두 저장하는게 목표가 아니라, 지금 실행 중인 지역적인 분기만 저장하는걸 목표로 하기 때문에 이는 고려하지 않고 있어.
가끔 실행되는 저 멀리있는 함수까지 파이프라인을 보장하는게 목적이 아니라, 지역적인 반복문에서 최대한 다음 파이프라인을 깨지 않도록 하는게 목적이거든. 

BTB에서는 이전 분기에서 실행한 명령 주소를 저장해놓는데 이전에 실행한 분기 명령의 결과 히스토리를 저장했다가 이동하면 더 정확해지겠지? 이렇게 분기 결과를 저장하는 테이블을 BHT (Branch History Table) 라고 불러.

저장하는 값은 N(not taken), T(taken) 두 가지인데 BHT로 1비트를 사용하면 바로 이전 결과만 저장하기 때문에 NTNTNT 로 번갈아가며 바뀌는 패턴에 대한 예측이 100% 실패하게 되는 단점이 있어서 보통 2비트를 사용해서 저장하게 돼.

2비트 BHT는 분기 결과가 N이 나오면 왼쪽으로, T가 나오면 오른쪽으로 상태가 이동하는 방식이야
SN(strong not taken) - WN(weak not taken) - WT - ST

그런데 이런 단순한 예측으로는 많은 패턴을 알아내기 힘들어. 따라서 PHT (Pattern History Table) 라는 방식도 나오는데 이는 진짜 히스토리 패턴을 기록하는 방식이야. 
NTNTNT로 번갈아서 나온다면 최초 두번은 예측이 실패하겠지만 그 이후 반복되는 패턴에 대해서 100% 예측을 할 수 있어. 저 패턴은 2Bit-counter만 사용하지만 3BC를 사용하면 NNTNNT 라던가 NTTNTT 같은 패턴도 예측 가능해. 예를 들어 반복문에서 이런 구문이 있을 때 정확한 예측이 가능하겠지.

if (i%3) ~~

여기까지 설명한게 PShare (Private History, Shared Counters) 에 대한 내용이야. 일반적으로 작은 반복문이나 홀짝 패턴으로 분기되는 방식에 유용해.
이와 다르게 전체적으로 보는 방식은 GShare (Global History, Shared Counters) 라고 불러. 얘는 분기들의 패턴과 상관도를 중요시하고 기록하는 메모리 크기가 PShare보다는 더 많이 들게 돼.

Tournament Predictor는 위에서 설명한 두 개의 예측기 결과를 Meta Predictor 테이블에 저장하여 다음에 실행될 때 어떤 예측기 결과를 선택할 지 고르는 방식이야.

이와 비슷한 Hierarchical Predictor 방식도 있는데 2Bit-counter 방식의 단순한 예측기, Local History, Global History 예측기를 가진 상태에서, 분기 명령이 Global History에 있으면 거기서 가져오고, 없으면 Local History, 여기도 없으면 2BC 예측기까지 내려가서 가져오게 돼.

만약 2BC 예측기가 잘못 예측하면 이 결과를 Local History로 올려서 관리하고, Local History에서도 분기가 틀리면 Global History로 올려서 잘못 예측할 수 있는 부분에 비용을 더 사용하는 방식을 말해.

마지막으로 RAS (Return Address Stack)에 대해서만 한번 정리할게.
함수 호출도 일종의 분기문이라 볼 수 있어. 왜냐하면 호출 시 다른 주소로 이동하게 되잖아. 그런데 조금 다른 방식으로 접근해야 하는 부분이 있어.

0x1230: call func1
..
0x1250: call func1
..
func1:
..
0x2004: ret

이런 어셈 코드가 대충 있다고 할 때에 0x1230, 0x1250 명령은 BTB에 들어갈 수 있을거야. 그런데 func1에서 다시 이전으로 돌아가는 0x2004 ret 부분을 보면 어디서 불렀는지에 따라 돌아갈 주소가 달라지게 돼. 그럼 여기서는 BTB로 저장해봐야 실패할 확률이 높아.

그래서 함수 호출의 경우 예외적으로 호출 이후에 돌아갈 주소를 RAS에 callstack처럼 별도로 쌓아두고, 돌아갈 때에 가장 위에 있는 주소를 가져오게 돼. 만약 func1 -> func1-1 -> func1-2 로 중첩되어 호출되었다면 이렇게 stack이 쌓일거야.

func1-2 <- now
func1-1
func1

물론 읽을 때마다 pop하게 되니 그 다음에 ret를 만나면 func-1-1을 가져오게 되겠지.


- spectre attack
이제야 스펙터 공격에 대해 말할 수 있게 되었는데, 스펙터 공격은 공격대상과 동일한 코어에 내 어플리케이션을 실행해서 내가 실행하고 싶은 코드로 분기하도록 계속 실행을 반복해서 BTB에 학습시키는 것부터 시작해. 왜냐하면 BTB는 코어마다 공유하는 장치거든.

이후에 공격대상이 예측기를 통해 분기를 실행하려고 할 때에 내가 학습시킨 BTB의 내용을 근거로 내 코드가 공격대상의 파이프라인에 들어가서 실행하게 되는데, 물론 끝까지 실행되진 않지만 그 중간에 메모리를 읽어서 캐쉬라인에 남겨놓은 정보는 캐쉬와 일반 메모리 접근 속도차에 의해 정보를 읽어낼 수 있다고 해.

이런 복잡함을 보면 알다시피 전제 조건이 참 많은데 두 프로그램이 동일 코어에서 실행되어야 하고, 분기 명령 주소와 읽어들일 주소도 알고 있어야 하며, 두 프로그램이 모두 접근 가능한 주소 공간도 있어야 하는 등 사실상 거의 불가능한 내용이긴 해.


- 결론
1) structural, data, control hazard 극복이 cpu 성능 향상에 많은 도움을 주었다.
2) branch predictor는 생각보다 매우 복잡하고 효율적으로 구성되어 있다.
3) 추가 정보는 아래 키워드로 검색해보면 된다. (BTB, BHT, PHT, PShare, GShare, Tournament/Hierarchical Predictor, RAS)
4) spectre attack은 전제 조건이 많아 악용하기가 쉽진 않다.

들을 때는 이해갔는데 실제로 글로 써보니 쉽게 설명할 정도까진 깊이 이해하지 못했나봐. 글이 중구난방인데 키워드 정도만 얻어가도 괜찮지 않을까 싶네.

이전글: https://frogred8.github.io/
#frogred8