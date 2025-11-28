---
layout: page
title: "[etc] deepseek의 네트워크 라이브러리 살펴보기"
date: 2025-11-28
---

<pre>
예전에 deepseek의 태생부터 시작해서 ptx를 어떻게 사용했는지, ptx가 어떤건지 대충 정리했었어.
https://frogred8.github.io/docs/038_ptx_in_deepseek

그 때 내용을 간단히 축약해보면, PTX(Parallel Thread Execution)는 nvidia에서 만든 gpu 전용 중간 언어야. 일종의 gpu 어셈블리어라고 보면 되는데 이걸 사용해서 deepseek팀은 low-level 최적화를 했어. 
그에 대해 논문과 인터뷰 등에도 많은 내용이 있었지만 실제 코드는 없었기 때문에 그저 궁금해하고만 있었는데 저 글을 쓴 지 얼마 되지 않은 2월 말에 deepseek팀에서 실제 코드를 github에 공개했어.
이 글은 deepseek가 공개한 네트워크 라이브러리 부분을 분석하고 나름대로 정리한 글이야. 최대한 코드없이 설명해볼게.


- deepEP 소개 및 의미
deepEP(expert parallelism)는 deepseek팀에서 공개한 여러 라이브러리 중에 하나인데, 주요 역할은 MoE(mixture of expert, 전문가 혼합 모델) 및 ptx를 사용한 네트워크 병렬 통신 라이브러리라고 보면 돼.
https://github.com/deepseek-ai/DeepEP/

난 이게 왜 흥미로웠냐면 OpenAI(chatGPT)나 Anthropic(Claude), xAI(grok), google(Gemini) 등 그 어떤 회사에서도 내부 개발 도구 및 코드를 공개한 적이 없었거든.
meta나 qwen도 사실 그냥 학습이 끝난 베이스 모델에 대해서만 공개하는거고 실제 그 모델을 만드는데 필요한 세부 개발 도구를 공개한 적은 없었는데, 오히려 중국에서 처음으로 대규모 모델에 대한 전반적인 개발 도구를 공개했다는게 참 아이러니한 느낌.


- deepEP의 최적화
일단 deepEP 자체가 h800같은 중국 전용 nvidia 그래픽카드에 특화된 네트워크 라이브러리야. h100(600GB/s)보다 2배나 낮은 bandwidth를 가진 h800(300GB/s)의 성능을 극복하기 위해 나온 결과라는거지.
https://www.hyperbolic.ai/blog/h100-vs-h800
그래서 대역폭을 최대한 활용하기 위해 병목 현상이 발생하는 명령이나 작업을 gpu 직접 제어 코드(=PTX)로 랩핑해서 사용하고 있어.

일반적으로 cuda는 gpu만으로 동작한다고 오해하기 쉬운데 사실 cudaXXX로 시작되는 명령은 cpu가 gpu커널로 명령을 전달하고, gpu커널은 이걸 큐에 적재했다가 gpu의 작업자(Streaming Multiprocessor, SM)가 가져가서 처리하게 돼.
이를 PTX로 직접 제어를 하게 된다면 cpu-cuda커널-gpu큐로 전달되는 부분을 생략할 수 있겠지.

예를 들어, gpu 메모리 복사는 cudaMemcpyAsync 명령으로 간단히 처리할 수 있지만 deepEP에서는 PTX를 랩핑하여 TMA(Tensor Memory Access)를 직접 제어하고 있어. 아래 함수는 메모리 복사하는 PTX 사용 예를 하나 넣어본거니까 대충 이런 느낌이구나 하고 넘어가면 돼.

void tma_load_1d(...) {
  ...
  asm volatile("cp.async.bulk.shared::cluster.global.mbarrier::complete_tx::bytes.L2::cache_hint [%0], [%1], %2, [%3], %4;\n"
    :: "r"(smem_int_ptr), "l"(gmem_ptr), "r"(num_bytes), "r"(mbar_int_ptr), "l"(cache_hint) : "memory");
}

cudaXXX 함수는 범용적으로 쓰기 편하라고 만들어둔거고 모든걸 제어할 수 있다면 gpu 내에서 저렇게 PTX를 직접 호출하는게 빠를거야. 아무래도 gpu의 대기 시간을 극단적으로 줄일 수 있으니까.
이게 deepEP에서 최적화한 첫번째 방법이야. (저 함수 말고도 PTX 명령을 랩핑해서 사용하는게 꽤 있어)


두번째 최적화 방법으로는, 캐시 할당 및 일관성 제어를 우회하는 L2 메모리 읽기 명령을 사용한거야. 이게 무슨 뜻이냐면, 값을 읽어올 때 일단 L1 캐시를 검색하고 순차적으로 내려가는데 이걸 우회해서 L2 전역 메모리에서 직접 읽어온다는거야.
nvidia 가이드에는 '전역 데이터는 L2 수준에서 일관성을 유지하지만, L1 캐시는 전역 데이터에 대해 일관성을 유지하지 않는다'라고 명시되어 있어.
https://docs.nvidia.com/cuda/parallel-thread-execution/index.html#cache-operators
다만 저게 무조건 L1 캐시가 깨진다는건 아니고, 텍스쳐 캐시에 대한 캐시 일관성을 말하는거야. nc 지시자는 캐시 일관성을 포기하는 대신 더 높은 대역폭을 제공하게 되거든.

따라서 L2 캐시로 직접 제어하면서 높은 대역폭으로 가져올 수 있고, 부가적인 효과로 데이터가 L1 캐시를 덮어쓰지 않은채 그대로 유지되면서 실행 중인 캐시힛 확률이 높아지는 효과도 얻을 수 있게 되었어. deepEP에서는 아래처럼 구현됐어.

uint8_t ld_nc_global(uint8_t *ptr) {
  ...
  asm volatile("ld.global.nc.L1::no_allocate.L2::256B .u8 %0, [%1];" : "=h"(ret) : "l"(ptr));
}

PTX 명령인 ld.global.nc.L1::no_allocate는 칩셋에 따라 SASS(Streaming ASseMbler)에서 LDG.E.NA.[width].CONSTANT 명령으로 변환되는데 이렇게까지 깊이 알 필요는 없으니 관심있는 사람은 저 키워드로 찾아보면 될거야.


세번째 최적화 방법으로, 네트워크 통신 전용으로 20개의 SM(Streaming Multiprocessor)을 할당해서 사용하고 있어.
어차피 SM은 코드 실행 단위이기 때문에 누가 해도 상관없는데 L1 캐시가 SM 하나마다 공유되기 때문에 이전에 네트워크 코드를 처리한 SM이 동일 작업을 진행한다면 캐시힛 효율이 좋아지고, 이렇게 네트워크 처리가 빨라지면 h800의 부족한 대역폭을 최대한 이용할 수 있겠지.
그리고 여러 개의 MoE(Mixture-of-Experts)로 요청을 보내고 이를 취합해야 하기 때문에 deepEP에서는 132개의 SM중에 20개를 네트워크 전용으로 할당했는데 그에 따라 계산 성능은 15% 정도 감소하게 돼. 아마 내부적으로 많은 테스트를 해보고 20개로 결정된 것 같아. 만약 200개의 SM이 있는 하드웨어가 나온다면 이 값은 또 그에 맞춰 수정되겠지.
이 부분이 실제 코드에서 어떻게 구현되어있는지 바로 살펴볼게.


- 네트워크 통신 전용 SM 구현부
deepEP 코드를 보면 internode.cu, intranode.cu 파일이 있는데 internode 파일은 노드 간 통신, 그러니까 다른 머신에 있는 gpu와 통신할 때 쓰이는 구현체이고, intranode 파일은 같은 머신에 있는 여러 gpu끼리 내부 통신할 때 사용되는 구현체야.

deepseek 최초 설계 공개할 때부터 네트워크 전용 SM의 20개 구분을 어떻게 하는지 궁금했는데 deepEP 구현체에 그 내용이 있었어. deepEP가 실행될 때 gpu 전체가 아닌 인자로 받은 num_sms 개수만큼만 생성해서 네트워크 구현체가 돌아가는거지. 코드에서는 SETUP_LAUNCH_CONFIG 매크로를 사용해서 이걸 설정하고 있어.

이렇게 gpu하나마다 SM 20개를 할당해서 사용하게 되는데 실제 채널 개수는 10개로 실행 중인 sm_id의 홀수/짝수에 따라 역할이 나눠지게 돼. 짝수 sm_id는 데이터를 보내는 송신자&전달자 역할을 하고, 홀수 sm_id는 수신자 역할을 하면서 말이지. 다른 곳에서도 자주 보이는 Producer-Consumer 패턴이야.
이 때, 같은 머신에 있는 gpu끼리는 NVLink를 이용하여 통신하게 되는데 이 역할은 짝수 sm_id이면서 warp_id가 8이하인 warp가 할당받고 있어. 이런 여러가지 조건에 따라 현재 sm에 부여된 역할을 가져오는 함수가 이거야. (원본 코드에서 많이 간추린 버전)

#define NUM_MAX_NVL_PEERS 8
auto role_meta = [=]() -> std::pair&lt;WarpRole, int> {
  if (sm_id % 2 == 0) {
    if (warp_id < NUM_MAX_NVL_PEERS) {
      return {WarpRole::kNVLSender, warp_id};
    } else if (warp_id < kNumForwarders) {
        return {WarpRole::kRDMAReceiver, warp_id - NUM_MAX_NVL_PEERS};
    } else {
        return {WarpRole::kCoordinator, 0};
    }
  } else {
    if (warp_id < kNumForwarders) {
      return {WarpRole::kNVLAndRDMAForwarder, warp_id};
    } else {
      return {WarpRole::kCoordinator, 0};
    }
  }
}();

role_meta 함수로 가져온 각 WarpRole에 따라 하위에서 실행되는 내용이 분기되며 세부 코드를 실행하게 돼. 다만 여기부터는 진짜 '전문가' 영역이라 코드 분석이 많이 어렵더라. 완벽히 이해할 깜냥은 안돼서 그저 스르륵 흝어보기만..


- RDMA(Remote Direct Memory Access)
위에서 intranode, internode에 대해 살짝 설명하고 지나갔는데 이 부분이 꽤 재밌어서 조금 더 정리해봤어.
intranode는 NVLink를 사용해서 한 머신에서 내부 통신하는거고, internode는 RDMA(Remote Direct Memory Access)를 사용하여 다른 머신의 gpu와 통신하는거라서 internode의 대역폭이 상대적으로 많이 느린 편이야. 스펙 상으로도 NVLink의 대역폭이 900GB/s인거에 비해 RDMA는 50GB/s으로 나와있기도 하고.

그래서 deepseek는 클러스터 구성이 되어있어도 자주 참조하는 고정 데이터는 한 머신에만 보관하지 않고, 다른 머신에서 두세벌 중복해서 가지고 있다고 해. 왜냐하면 하나의 데이터가 한 머신의 gpu메모리에만 있다면 그 데이터가 필요할 때 무조건 RDMA로 접근해야 하는데 이게 병목이 될 수 있잖아? 그래서 최대한 NVLink를 통해서 동일 머신에 데이터가 있는지 확인해본다고 해. 일종의 캐시힛 개념이랄까.

어쨌든 RDMA는 다른 머신의 메모리 접근 방식을 말하는데 여기에는 IBRC(InfiniBand Reliable Connection), IBGDA(InfiniBand GPUDirect Async) 이렇게 두 가지로 나눌 수 있어.

IBRC 방식은 gpu가 cpu에게 '이 데이터를 저기로 보내줘'라고 요청하면, gpu 메모리에서 dram으로, 그리고 이걸 cpu가 NIC(Network Interface Card, 랜카드)에 데이터를 보내서 전송하는 방식이야. 하나의 머신에 gpu가 몇개씩 있는 상태에서 매번 dram으로 복사가 일어나면서 cpu가 명령을 받으면 병목 현상이 발생하고, 응답에 대한 효율적인 처리가 어렵겠지?
그래서 나온게 IBGDA인데 이건 nvidia에서 만든 GPUDirect 기술을 이용하여 gpu가 직접 전용 NIC로 데이터를 전송해서 처리하는 방식이야. gpu->ram->cpu->NIC를 통하지 않고 GPU에서 연결된 NIC로 직접 전달하기 때문에 zero-copy가 가능해서 훨씬 더 효율적이야.
다만 IBGDA 구성을 하려면 일반 이더넷 NIC로는 안되고 InfiniBand 제품이나 RoCE(RDMA Over Converged Ethernet)를 지원하는 NIC만 가능하다고 해. 

InfiniBand는 예전에 고성능 컴퓨팅 산업의 표준 규격이라고만 언뜻 알고 있었는데, nvidia가 그 업계 1위였던 멜라녹스를 인수하면서 InfiniBand가 사실상 nvidia 독자 규격처럼 개발되고 있다고 하더라. 사실 표준이기 때문에 이론적으로 누구든 만들어도 되지만 nvidia에 특화되어 계속 개선되고 있는 상황에서 다른 기업이 생산에 뛰어들 의미가 없긴 해..


- 커밋 중에 재밌었던 부분
deepEP 커밋 목록을 구경하다가 우연히 텐센트 네트워크 부서의 PR을 보게 됐어.
그 PR에서는 이전에 설명한 IBRC 방식으로 통신하던 부분을 모두 IBGDA로 바꾸고, 병렬로 데이터 전송이 가능하도록 추가한게 주요 개선점이야.
https://github.com/deepseek-ai/DeepEP/pull/130
이 개선으로 기존 로직보다 internode 간의 대역폭이 최대30% 늘어났다고 해. 

그리고 두달 전에는 deepseek 메인 개발자가 HybridEP라고 SM 리소스를 더 효율적으로 사용하는 방식도 추가했는데 좀 더 효율적인 SM의 운용으로 동일한 SM 개수에서 기존보다 30~70%까지 증가하는 기능의 PR도 적용하고 그러더라.
https://github.com/deepseek-ai/DeepEP/pull/420

AI 모델 뿐만 아니라 이런 개발 도구들도 계속해서 발전하는게 deepseek 오픈소스가 취지대로 잘 운영되고 있구나 싶기도 하고, 이렇게 계속 발전하는게 대단하기도 하고.. 
이런걸 보면 아무리 하드웨어가 좋아졌어도 성능을 극한으로 내기 위해서는 low-level 최적화가 언제나 필요하다는 것을 다시 한 번 느끼게 되네.


- 결론
1) deepEP는 중국 전용 nvidia칩의 낮은 대역폭의 한계를 넘어가기 위해 나온 네트워크 라이브러리 도구이다.
2) PTX 사용, L2 캐시 직접 접근, 네트워크 통신 전용 SM 할당을 통해 low-level 최적화를 진행했다.
3) deepseek 오픈소스는 활발하게 운영되고 있는 중이다.
4) 코드를 봐도 이해가 안되는 부분이 꽤 많은데 나만 그런건 아니었겠지..

이전글: https://frogred8.github.io/
#frogred8 #deepseek #deepep