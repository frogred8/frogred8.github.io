---
layout: page
title: "[javascript] substr 구현체 분석"
date: 2022-05-01
---

<pre>
그냥 오늘 공부한거 정리좀 해보려고.

일단 최근에 이 문서에 흥미있는 문구를 봤어.
https://developer.mozilla.org/ko/docs/Web/JavaScript/Memory_Management

var s = 'azerty';
var s2 = s.substr(0, 3); // s2는 새로운 문자열
// 자바스크립트에서 문자열은 immutable 값이기 때문에,
// 메모리를 새로 할당하지 않고 단순히 [0, 3] 이라는 범위만 저장한다.

진짜? 믿기지 않는데?
단순히 복사하지 않고 인덱스만 저장해서 따로 관리까지 할 필요가 있을까?
그래서 일단 구글을 뒤져봤지.

https://mrale.ph/blog/2016/11/23/making-less-dart-faster.html
꽤 뒤적거린 끝에 찾아냈는데 이 형이 무척 자세히 정리를 잘해놨더라구. 
주요 내용만 보면, 일단 dart에서는 substring이 복사체로 구현되어 있는데 js에서는 mdn가이드처럼 index 2개 저장하는 방식으로 되어있어. (Dart는 c like 언어야)
그래서 성능 차이가 몇백배 차이가 나고 있는데 여기까진 당연한 결과.

사실 이거 찾아보기 시작한게 인덱스만 저장하면 기존 문자열의 ref count가 올라가있어서 원본 문자열 해제가 안되는걸 알고 있는 상태에서 사용해야겠구나 싶었고, 동작 방식을 잘 모른채 쓰면 가끔 망하겠는데? 라는 의문이 있었는데 이 글에서도 똑같은걸 지적하더라구.

Counterintuitively obj above retains the whole 10Gb input string instead of a small 20 character token.
(역설적으로 20개 문자 대신 10gb 문자열을 유지하게 된다 - 대충 그런뜻)
이로 인해 발생한 이슈 등등 링크 내용도 꽤 재밌으니 관심있으면 읽어보고 다시 원래 목적으로 돌아와서,

결국 substring 구현체를 까봐야 알 수 있는 부분이라 나도 저 포스팅 따라서 v8 받아다가 하나씩 찾아봤는데 구현부도 궁금했지만 실제 명령에서 구현부까지 어떻게 호출되는지도 궁금해서 역추적을 시작해봤어. (여긴 지루하면 결론으로 가도 돼)

일단 잘 모르니까 SubString으로 검색해보니 builtins-definitions.h 파일에 이렇게 선언되어 있더라구
TFC(StringSubstring, StringSubstring)
SubString은 v8의 빌트인 함수로 구현되어 있다는걸 알 수 있었고, tfc는 요런뜻. (터보팬은 v8의 최적화 엔진 이름이야)
// TFC: Builtin in Turbofan, with CodeStub linkage and custom descriptor.

저 StringSubstring 키워드는 builtins-string-gen.cc로 연결돼서 선언되는데
TF_BUILTIN(StringSubstring, StringBuiltinsAssembler) {
  auto string = Parameter&lt;String>(Descriptor::kString);
  auto from = UncheckedParameter&lt;IntPtrT>(Descriptor::kFrom);
  auto to = UncheckedParameter&lt;IntPtrT>(Descriptor::kTo);
  Return(SubString(string, from, to));
}

여기서 본체인 SubString이 나오는구나. 싶었는데 아직 한참 남았어.
저 TF_BUILTIN 매크로는 빌트인 함수로 지정된 StringSubstring을 StringBuiltinsAssembler::SubString으로 연결시켜주는 역할을 해. 그래서 저 함수(SubString)를 따라가면 runtime 함수를 다시 부르는걸 볼 수 있어

  // Fall back to a runtime call.
  BIND(&runtime);
  {
    var_result =
        CAST(CallRuntime(Runtime::kStringSubstring, NoContextConstant(), string, SmiTag(from), SmiTag(to)));
    Goto(&end);
  }

저 kStringSubstring 값을 넣어서 호출하면 runtime.h 파일에 등록된 intrinsic 함수를 뒤져서 그 enum과 연결된 함수를 호출하게 돼. 함수는 runtime-strings.cc에서 매크로로 등록된 함수고, 이제야 구현체랑 연결된 NewSubString 함수를 찾은거야.

RUNTIME_FUNCTION(Runtime_StringSubstring) {
  ...
  return *isolate->factory()->NewSubString(string, start, end);
}

구현체는 factory.cc에 있는데 가장 중요한 구현부 함수는 여기. Factory::NewProperSubString()
코드 분석해보니 안에서도 이것저것 튜닝해놨더라구. substring 시에 13보다 작게 자르면 인덱스 2개가 아닌 복사로 동작하는 구문이 있는건 좀 신기했어. 작은 문자열은 복사 시 비용이 크지 않아서 그렇게 구현했나봐. 
어쨌든 거기서 여태까지 찾던 동작이 구현된 걸 볼 수 있었어.

  slice.set_length(length);
  slice.set_parent(*str);
  slice.set_offset(offset);

원본 문자열을 연결시키고, offset은 자르는 시작 위치로 설정하고, length는 가지고 있는 문자열의 length가 아닌 end-begin값으로 바꾸는 동작까지.
저 slice객체는 SlicedString 클래스의 인스턴스인데 이거 외에도 용도에 따라 string 클래스가 참 많더라구. ConsString, ThinString.. 이런 작은 튜닝들이 모여서 v8이 그렇게 좋은 엔진이 되었나 싶기도 하고.

분석은 끝났지만 아까 string 헤더에 이런 주석이 있었어.

// Currently missing features are:
//  - truncating sliced string to enable otherwise unneeded parent to be GC'ed.
v8 개발팀도 긴 문자열을 그대로 보관하는게 문제라는건 알고 있어서 잘린 문자열 외에는 gc하는 기능을 이렇게 todo로 적어놨지만 여전히 missing feature인걸로 봐서 해결하긴 쉽지 않나봐.

나도 잠깐 고민해봤는데, slicedstring에 접근할 때마다 ref count 개수를 검사해서 slicedstring 하나면 연결되어 있으면 잘린 문자열을 복사해놓고 기존 문자열은 해제하면 되지 않을까 싶었는데
1) leap func에서 확인하는게 너무 과도한 동작이고, 2) get 동작에서 문자열 복사(엄청 크면 어떻게 해..)가 언제 일어날 지 모르는 모호한 상태도 뒷맛이 안좋고.. 구글 형들도 딱히 답이 없어서 일단 두고 있지 않나 싶기도 하고 뭐 그러네.

결론)
1. js의 substring은 원본 문자열의 포인터를 가지고 인덱스 2개만 저장해서 사용한다
2. 자르는 문자열 개수가 13 미만일 경우에 그냥 복사해서 사용한다
3. 원본 문자열이 지나치게 길 경우 substring으로 자르고 이를 복사해서 사용하는게 좋다

mdn의 한 줄에서 시작된 궁금증이 이렇게 긴 여정이 될 줄은 몰랐는데 아무튼 내가 재미있으면 됐지 뭐.
사실 혼자 이해하고 넘어가도 되는데 오늘은 좀 복잡한거라 그냥 머릿속 정리겸 어딘가에 써보고 싶었어.
다음에도 필받으면 써볼게.
