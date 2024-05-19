---
layout: page
title: "[java] 카프카는 왜 빠를까?"
date: 2024-05-18
---

<pre>
이벤트 기반 아키텍쳐에서는 그 중심이 되는 메시징 서비스가 필요한데 보통 kafka, rabbitmq, redis (pub/sub) 등의 기술을 사용하고 있어. 특히 대규모 서비스에서는 kafka를 주로 사용하는데 다른 서비스에 비해 처리량이 월등히 좋기 때문이야. 각 서비스에 대한 특징을 간단히 한줄로 써보면,

kafka: 많은 처리량
rabbitmq: 낮은 지연 속도
redis: 비교적 쉬운 사용성

자세한 건 아래 벤치마킹 링크를 보면 선택에 조금 더 도움될거야. 개인적으로 redis는 속도나 처리량보단 사용성이 장점이라고 생각하는 편.
https://www.confluent.io/blog/kafka-fastest-messaging-system/
https://aws.amazon.com/ko/compare/the-difference-between-kafka-and-redis/

그런데 kafka를 보며 든 생각이, kafka는 자바로 만들어져 있고, vm위에 뜨는데도 어떻게 저런 많은 처리량이 나오는걸까 궁금해졌어. 그래서 이것저것 보다가 어느 정도 정리가 돼서 간단히 써봄.


- kafka가 빠른 일반적 이유
저 주제로 검색해보면 많은 글이 있는데 대동소이하니 여기서는 아래 페이지 내용으로 간단히 설명할게.
https://www.geeksforgeeks.org/why-apache-kafka-is-so-fast/

1. 저지연 I/O 사용
전송받은 메시지는 RAM을 사용하여 지연 시간을 낮추고, DISK를 최소한으로 사용.

2. 순차적 I/O 자료구조 사용 (log)
메시지 추가는 끝단에서 이뤄지고, 메시지 읽기는 consumer마다 별도의 포인터를 두어 탐색 시간을 피하는 'log'라는 데이터 구조 사용. 더 자세한 건 아래 링크 참조.
https://medium.com/rate-labs/11513af8b998

3. zero-copy 적용
어플 영역의 데이터를 복사하는 과정없이 커널에 직접 전달하여 효율을 높임. (이번 글의 메인 주제)

4. 수평 확장 시스템
단일 주제에 대해 여러 소비자로 분산 가능한 시스템.

5. 데이터 압축 및 일괄 처리
데이터를 묶음 단위로 관리하여 전송/관리 효율을 높이고, 이를 압축하여 보관/전송하는 구조. 아래 트러블 슈팅 링크글 재밌더라.
http://happinessoncode.com/2019/01/18/kafka-compression-ratio/

다른건 대충 와닿았는데 zero-copy는 어떻게 구현되었을지 이해가 잘 안되더라고. 데이터를 바로 커널에 전달하는게 가능한가? 그래서 이번 글은 zero-copy에 대해서 깊게 알아볼거야.


- 들어가기 전에..
메모리 할당은 어떻게 이뤄질까? malloc이나 new로 할당한다는 그런거 말고 '진짜' 메모리 할당 과정 말이야.

사실 잘 몰라도 이상할건 없어. 왜냐하면 커널책을 깊이 파보지 않은 이상 알고 있기가 쉽지 않거든. 얇은 책에서는 간단히 다루다가 두리뭉실하게 넘어가기도 하더라.

내가 아는대로 대충 써보면, 

1. 유저 공간에서 커널로 메모리 요청
2. 커널에서 메모리를 페이지 단위로 할당 (32bit=4kb, 64bit=8kb)
3. 할당된 페이지의 물리 메모리 주소와 가상 메모리 주소 매핑 테이블 등록 (PMT, Page Map Table) 
4. 가상 메모리 주소를 반환

한 페이지(4kb)보다 작은 메모리를 할당할 때에 단편화되는 단점을 보완하기 위해서 미할당된 부분을 기록했다가 다음 메모리 요청 시에 현재 할당된 페이지에 빈 자리가 있는지 검색하거나 해제 시 합치는 Buddy system 이라던지, 동일한 크기가 빈번하게 할당/해제될 때는 small/large bin, SLAB 등의 여러 메모리 관리 기법을 통해 단편화를 최소화하기도 해.

물리적 연속 메모리 할당을 위한 kmalloc, 가상으로만 연결된 메모리 할당을 위한 vmalloc 등도 있고, vmalloc 시 경우에 따라서 지나친 TLB(Translation Lookaside Buffer)의 변경으로 성능이 저하될 수 있다거나 뭐 이것저것.. (이 내용도 최신 버전에서 그 어디즈음의 과정일 수 있으니 참고만 하고, 자세한 건 별도로 찾아보길 권장해)

어쨌든 저기서 중요한 건 메모리 할당 동작은 커널로 턴이 한 번 넘어간다는거야. 그렇다는 얘기는 cpu레벨에서 context change가 일어나야 하는거고, 이는 꽤나 비싼 동작이지. 참고로 메모리 해제는 알고리즘에 따라서 더 큰 부하를 가져오기도 해.

갑자기 이런 내용을 왜 썼냐면 zero-copy는 결국 커널 영역의 context change를 최소화시키고 싶다는 요구사항에서 시작된 내용이거든. 가장 접하기 쉬운게 메모리 할당이라서 간단히 써봤는데 이제 아래에서 제대로 zero-copy를 알아볼게.


- zero-copy란?
이에 대해 찾아보면 필연적으로 만나게 되는 좋은 아티클 소개로 시작할게.
https://www.linuxjournal.com/article/6345

zero-copy는 file을 socket으로 복사할 때 발생하는 부하를 최소화하는 목표를 가지고 만든 기능이야. 여기서는 linux를 기준으로 설명하지만 최종 인터페이스는 window도 동일하게 지원한다고 하더라. 위 아티클에서 소개한 zero-copy 개선 방식을 순서대로 알아볼거야.


1. 초기 구현
파일을 소켓으로 복사해서 전달하는 기능을 기존 명령을 사용하여 구현한다면 이렇게 될거야.

char *tmp_buf = malloc(len);
read(file, tmp_buf, len);
write(socket, tmp_buf, len);

세부적으로 살펴보면, read를 할 때에 파일을 읽어오기 위해서 DMA에서 커널 버퍼로, 이를 다시 유저 버퍼(tmp_buf)로 복사하는 동작이 일어나고, write에서는 이 유저 버퍼를 다시 커널 버퍼(=소켓 버퍼)로 복사해서 다시 protocol engine으로 복사하는 동작이 일어나게 돼.

이렇게 총 4번의 복사와 각 동작에 대해 커널 영역의 명령 실행이 필요해서 context change가 4번 일어나는 비싼 동작인데, 이를 조금 더 개선시킨게 다음의 mmap을 이용한 방식이야.

2. mmap 적용
tmp_buf = mmap(file, len);
write(socket, tmp_buf, len);

mmap은 유저/커널 영역에서 공유할 수 있는 메모리 버퍼를 만드는 명령인데 이로 인해 파일을 굳이 유저 버퍼로 복사할 필요가 없어지고 커널 영역에서만 복사가 일어나게 할 수 있어.

mmap을 사용하면 DMA에서 커널 버퍼로 복사하는 동작이 일어나고, write에서는 이 mmap 버퍼를 소켓 버퍼로 복사하고 protocol engine으로 복사하는데, 이렇게 하면 3번의 복사와 4번의 context change로 줄어들게 돼.

3. sendfile 명령
커널 명령이 최소 한번씩은 들어가는 방식으로는 context change 횟수를 줄일 수 없으니 아예 명령을 새로 만들었어.

sendfile(socket, file, len);

이를 사용하면 DMA에서 커널 버퍼로 복사하고 바로 소켓 버퍼로 복사, protocol engine으로 복사하게 돼서 복사 횟수는 동일하게 3회지만 context change 횟수가 2번으로 줄어들게 돼.

4. sendfile 개선
초기에는 커널 버퍼를 소켓 버퍼로 복사했지만 이 비용을 줄이기 위해 소켓 버퍼 인터페이스를 바꿔서 데이터 전체가 아닌 데이터의 위치와 길이 정보를 받을 수 있도록 개선하여 커널 영역 내의 복사 비용도 없앨 수 있었어. 외부 인터페이스는 바뀐게 없기 때문에 기존처럼 사용하면 돼.

sendfile(socket, file, len);

이걸로 DMA에서 커널 버퍼로 복사하고, 소켓 버퍼에는 해당 커널 버퍼의 위치,길이 정보만 기록해서 protocol engine이 직접 참조하여 복사해갈 수 있어. 엄밀하게 말하면 zero-copy는 아니지만 유저/커널 영역에서 중복된 데이터 복사가 일어나지 않게 줄였다는 것에 의의를 둔다면 좋을거야. 사실 이보다 줄일 수는 없을거고.


- 그래서 kafka는 어떻게 zero-copy로 인해 빨라졌는가?
kafka는 자바로 만들어졌어. jvm위에서 돌아가다보니 유저-커널 영역의 context change외에도 유저 영역의 메모리 할당/복사 비용 등이 아무래도 부담되기 마련이야. (게다가 gc)

그런데 커널에서 제공하는 sendfile 인터페이스를 이용하면 데이터를 읽을 때마다 유저 영역으로 복사할 필요없이 바로 보낼 수 있단 말이지? 그래서 kafka는 이를 활용하여 consumer가 데이터를 요청할 때마다 유저 영역에 복사해서 내보내는 방식이 아닌, sendfile을 활용하여 쌓인 메시지를 네트워크로 바로 전송하도록 구현했어.

java 4버전에 nio (New IO) 라는 패키지가 추가되었는데 여기서 transferTo 함수가 이 sendfile을 랩핑해놓은 거라고 보면 돼. ibm문서 중에 기존 방식과 transferTo를 활용한 방식을 비교한 예제가 있는데 65% 더 빠른 결과를 보여주기도 했어.
https://developer.ibm.com/articles/j-zerocopy

관련해서 kafka 소스 코드도 살짝 소개해보고 싶어서 좀 봤는데 nio패키지의 Channel, Selector의 일반적인 사용들이 대부분이라 그냥 혼자 분석만 하고 말았다는 후문.


- 결론
1) kafka는 zero-copy로 인해 처리량을 대폭 향상시킬 수 있었다.
2) zero-copy는 커널 영역의 context change와 유저 영역으로의 데이터 복사를 줄이는 기능으로 os에서 지원하는 기능이다.
3) 초기 버전의 일반적인 구현 시 4번의 복사, 4번의 context change가 발생하던 부분을 zero-copy로 변경하면 2번의 복사, 2번의 context change로 최적화할 수 있다.


이전글: https://frogred8.github.io/
#frogred8 #kafka