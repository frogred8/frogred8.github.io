---
layout: page
title: "[javascript] super property access 소개"
date: 2022-05-06
---

<pre>
이번엔 v8 9.0에서 수십배 빨라진 super property 접근에 대한 아티클을 가볍게 소개하고 안에 구조도 한 번 구경할거야.
https://v8.dev/blog/fast-super

해당 버전은 2021년 2월에 릴리즈 되었는데 큰 성능 향상이 있는 부분이 있어서 가져와봤어.

일단 super 개념을 잘 모르는 사람을 위해 간단히 설명하면, javascript도 상속 구조를 가지고 있어. c++처럼 완벽히 구현된 건 아니고 prototype을 활용해 우회적으로 구현되어 있는거지.
normal과 super property 둘 간의 접근 성능 차이가 극심한 건 예전이 비효율적인 것도 있는데 다들 상속 구조 상 어쩔 수 없는 부분이라고 여기고 눈감고 있던 부분을 이번에 수정한 것 같아. 예전엔 상속 거의 안 썼으니까 저 비용이 크지 않았는데 javascript로 크고 복잡한 구조들(react 같은거?)을 만들면서 super property에 대한 접근 비용이 점점 커져서 개선의 필요성이 더 커졌겠지.

v8에서 일반 변수 접근은 hidden class라는 mapping table을 통해 알려진 property의 offset으로 직접 접근이 가능한데 여러 번 실행되는 함수 정보가 inline cache로 구성되어 더 빨라지게 돼. super property는 runtime에만 접근하던 부분을 이번에 바꾼거지. 어쨌든 매번 부모를 계속 타고 올라가는 행동이 마음에 들진 않으니까.


일단 비교를 위해 기존에 있던 super property 접근 방식을 먼저 알아보면,

class A { }
A.prototype.x = 100;
class B extends A {
  m() {
    return super.x;
  }
}
const b = new B();
b.m();

상위 클래스 A의 prototype은 x값을 저장하고, 이를 상속받은 클래스 B에서는 m함수로 super property인 x를 접근하게 돼. 프로토타입 체인은 아래처럼 생성될거고.

b ->
 b.__proto__ === B.prototype ->
  B.prototype.__proto__ === A.prototype ->
   A.prototype.__proto__ === Object.prototype ->
    Object.prototype.__proto__ === null

여기서 실제 x에 접근하면 어떤 순서로 찾기 시작하냐면, b 인스턴스에 x가 있는지 확인하고, 없으면 부모 클래스로 가서 확인하는 작업을 계속 반복해. 만약 가지고 있지 않은 property에 접근하면 하위부터 올라가며 부모 클래스를 탐색하다가 최상위 클래스가 null일 때에야 비로소 '없다'를 알아낼 수 있어. 실제 코드에서 x에 직접 접근한다면 이렇게 될거고. b.__proto__.__proto__.x

근데 이렇게 중간에 추가된 작은(?) 기능은 비교적 찾기가 쉬워. 왜냐하면 v8에서 커밋 리스트 찾아보면 되거든. 아래 커밋이 실제로 구현부의 initial 커밋인데 이정도만 있어도 연결고리 찾을 키워드가 있으니 분석이 훨씬 쉬워져.
https://github.com/v8/v8/commit/5339e5467ef33fd064fb996652ea01f876432edd
만반의 준비를 했으니 let's deep dive to code~


일단 기존 코드에서는 어떻게 super property를 가져오는지 보면, 

MaybeHandle&lt;Object> LoadFromSuper(Isolate* isolate, Handle&lt;Object> receiver,
                                  Handle&lt;JSObject> home_object,
                                  PropertyKey* key) {
  ....
  LookupIterator it(isolate, receiver, *key, holder);
  Handle&lt;Object> result;
  ASSIGN_RETURN_ON_EXCEPTION(isolate, result, Object::GetProperty(&it), Object);
  return result;
}

LookupIterator it 를 생성해서 GetProperty 로 넘기는 걸 볼 수 있어. 
그럼 GetProperty 도 봐야지?

MaybeHandle&lt;Object> Object::GetProperty(LookupIterator* it, bool is_global_reference) {
  for (; it->IsFound(); it->Next()) {
    switch (it->state()) {
      case LookupIterator::NOT_FOUND:
      case LookupIterator::TRANSITION:
        UNREACHABLE();
      case LookupIterator::JSPROXY: {
        ....
        MaybeHandle&lt;Object> result =
            JSProxy::GetProperty(it->isolate(), it->GetHolder&lt;JSProxy>(),
                                 it->GetName(), receiver, &was_found);
        ....


이터레이터를 돌면서 해당 key가 있는지 보는데 저 LookupIterator Next 함수 구현부인 NextHolder 함수까지 쭉 따라가면 이렇게 다음 prototype이 있는지 보는 함수가 나와. 

JSReceiver LookupIterator::NextHolder(Map map) {
  DisallowGarbageCollection no_gc;
  if (map.prototype(isolate_) == ReadOnlyRoots(isolate_).null_value()) {
    return JSReceiver();
  }
  if (!check_prototype_chain() && !map.IsJSGlobalProxyMap()) {
    return JSReceiver();
  }
  return JSReceiver::cast(map.prototype(isolate_));
}

prototype이  없으면 빈 JSReceiver를 보내는거 보이지? 여기까지가 예전 super property를 찾던 여정인데 이렇게 runtime 함수로 만들어놓으니 성능이 잘 안나와서 기존 normal property 접근 방식을 일반화시켜서 여기에도 적용한거지.

근데 구글 형들 커밋에서 좀 놀란게 링크된 설계 문서를 따라가보니, 이게 왜 지금 문제고 이걸 어떻게 수정하면 좋을 것 같고 너네 생각은 어쩌니 저쩌니 하면서 이 문제의 구현을 어떻게 해야할 지 설계도부터 pseudo 코드랑 그에 따른 확인할 부분, 성능 테스트, 그리고 대안 세네 개를 20페이지 짜리 문서로 정리했더라고. 이걸 public으로 공개한 것도 대단하고, faang급은 이렇게 하나 싶기도 하고.. 뭐 그렇네. 링크는 남겨둘테니 구경이나 슬쩍 해봐.
https://docs.google.com/document/d/1b_wgtExmJDLb8206jpJol-g4vJAxPs1XjEx95hwRboI/edit#heading=h.kurmjqj8jfgd

어쨌든 부러움은 뒤로 한 채, 이제 구현을 어떻게 바꿨는지 봐야겠지? 설계 문서대로 기존 normal property를 읽어오는 부분의 일반화로 super property도 읽어올 수 있게 했어. 일단 AccessorAssembler에 추가된 함수를 보면,

void AccessorAssembler::LoadSuperIC(const LoadICParameters* p) {
  ....
  // The lookup start object cannot be a SMI, since it's the home object's
  // prototype, and it's not possible to set SMIs as prototypes.
  TNode&lt;Map> lookup_start_object_map =
      LoadReceiverMap(p->lookup_start_object());
  GotoIf(IsDeprecatedMap(lookup_start_object_map), &miss);
  TNode&lt;MaybeObject> feedback =
      TryMonomorphicCase(p->slot(), CAST(p->vector()), lookup_start_object_map,
                         &if_handler, &var_handler, &try_polymorphic);

클래스 이름이 Accessor인걸 보면 알다시피 어딘가 접근하는 구현을 모아놓은 클래스라는걸 짐작할 수 있어. 여기서 중요한 부분은 lookup_start_object_map 생성부인데 함수는 아래처럼 되어있어.

TNode&lt;Map> CodeStubAssembler::LoadReceiverMap(TNode&lt;Object> receiver) {
  return Select&lt;Map>(
      TaggedIsSmi(receiver), [=] { return HeapNumberMapConstant(); },
      [=] { return LoadMap(UncheckedCast&lt;HeapObject>(receiver)); });
}

저기 Select 함수는 차례대로 condition, true_body, false_body로 이뤄져있는데 풀어보면 지금 receiver가 small integer 값이면 number map으로, 아니면 LoadMap으로 가라는 뜻이야. 여기서 우린 숫자키를 넘기진 않을테니 LoadMap 함수로 빠지는데 타고타고 들어가면 최종 leap함수는 이렇게 생긴 raw_assembler에 포함된 함수를 호출하게 돼.

Node* CodeAssembler::LoadFromObject(MachineType type, TNode&lt;Object> object, TNode&lt;IntPtrT> offset) {
  return raw_assembler()->LoadFromObject(type, object, offset);
}

AccessorAssembler 에서만 새로 추가하고 여긴 이미 다 있던 함수들이야. 그래서 그 설계 문서에 일반화만 시키면 된다고 한 듯. 호출부도 어느 정도 구경해보고 싶었는데 이쪽은 하루를 분석했는데도 스스로 명확하게 이해되진 않아서 넘어갔어. 며칠 사이에 전반적인 구조까지 보는건 어렵네. 

끝내기 전에 잡설 하나하면, 이렇게 고도화된 프로젝트의 분석이 참 힘든게 추상화 레벨이 높아서도 있지만 온갖 define문으로 함수의 생성, 정의를 하기 때문이야. 

예를 들면 VisitGetNamedPropertyFromSuper 함수는 kGetNamedPropertyFromSuper enum값과 매칭되어 호출하는데 그거 엮어진 부분이 도저히 검색으로 안나오는거야. 검색 범위를 계속 늘이다가 결국 찾아냈는데 이런 식으로 정의되어 있어.

#define BYTECODE_CASE(name, ...)       \
  case interpreter::Bytecode::k##name: \
    Visit##name();                     \
    break;
      BYTECODE_LIST(BYTECODE_CASE)
#undef BYTECODE_CASE

name에 들어가는 값을 기준으로 k+name값과 Visit+name을 연결해주더라고. 그럼 저 name을 리스트로 어딘가 보내주겠지? 그건 BYTECODE_LIST define문을 보면 되는데 그 안에서 호출하는 define문까지 같이 볼게.

#define BYTECODE_LIST(V)                                             \
  BYTECODE_LIST_WITH_UNIQUE_HANDLERS(V)                              \
  SHORT_STAR_BYTECODE_LIST(V)

#define BYTECODE_LIST_WITH_UNIQUE_HANDLERS(V)                                  \
  V(GetNamedPropertyFromSuper, ImplicitRegisterUse::kReadWriteAccumulator,     \
    OperandType::kReg, OperandType::kIdx, OperandType::kIdx)                   \
  ... (이런게 수십개)

저기 우리가 찾던 GetNamedPropertyFromSuper가 드디어 보여. V로 감싸져 있는데 그 V는 우리가 아까 BYTECODE_CASE에서 넘긴게 enum->함수 호출부를 만들어주는 녀석이었지? 그래서 수십개 호출부가 전처리기로 생성되는 방식이야.
이러니 검색을 아무리 해도 호출부를 찾기도 힘들뿐더러 찾아내도 그 다음 추상화된 녀석을 찾아내야 하고.. 꽤 괴로운 작업이라 최상위 call까진 결국 못 찾아내겠더라. 컴파일&실행없는 분석의 한계.. 


결론)
1) 기존의 super property 접근은 runtime 함수로 되어있었다.
2) 이를 normal property 접근에 사용되는 여러 함수의 일반화로 Inline Cache를 사용하게 개선했다.
3) 이로 인해 super property 접근 속도가 수십배 향상! profit!

여기서 소개한 super property 기능은 v8 9.0부터 포함되어 있는데 node 16.0 이후 릴리즈에는 모두 포함된 기능이니 버전 마이그레이션 시 참고하고.
node 버전별 최신 릴리즈: https://nodejs.org/ko/download/releases/

3일 간 공부하면서 정리한거라 소개한 아티클 내용보다 더 길어졌네. 이런거 누가볼까 싶지만 내 공부 한 거 정리한다는 마음으로 가볍게 올릴게. 사실 it 라운지니까 이런 기술적 내용도 한 두번 올라오면 좋겠다 싶은 마음이 있거든. (너무 연봉, 이직글만 있어서 재미없기도 하고)

즐거운 하루 보내.

#javascript #v8