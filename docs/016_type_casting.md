---
layout: page
title: "[javascript] 자바스크립트의 타입 캐스팅은 왜 이럴까?"
date: 2022-10-01
---

<pre>
강타입 언어(c/c++, java)로 프로그래밍을 입문했던 사람이 자바스크립트를 처음 보면 참 괴이한 부분이 많아. string과 int가 별다른 연산자 오버로딩없이 더해지는데 이게 안되는 연산자도 있고 뭔가 좀 뒤죽박죽이야.

그래서 'javascript suck' 같은 키워드로 검색해보면 연산자의 타입 캐스팅이나 비교문의 예가 주로 쓰이곤 해. 구경하다보면 욕이 나와도 정상.

사칙연산
'3' + 2    // "32"
'5' - 2    // 3
'5' - '-2' // 7
'3' * '5'  // 15
3 / '2'    // 1.5

사칙연산 (feat.boolean)
'3' + true  // "3true"
'3' + +true // "31"
'3' + false // "3false"
3 + true    // 4
3 + false   // 3

비교문
1 == true     // true
'1' == true   // true
'01' == true  // true
-'-1' == true // true
'0' == false  // true
'0' == 0      // true
'' == 0       // true

비교문 (feat.array)
[] == false    // true
[0] == false   // true
[1] == true    // true
[2] == false   // true
[1] == 1       // true
[1] == '1'     // true
[1,2] == '1,2' // true


비교문에서 double equal(==)을 쓰는건 이미 안티 패턴으로 많이 알려져 있어서 대부분 triple equal(===)을 사용하고 lint에서도 잘 걸러내기 때문에 그냥 자바스크립트를 까기 위한 재미로 봐도 되지만 사칙연산은 실제로도 문제를 많이 일으키고 있어.

예를 들어, redis같은 경우에는 값에 숫자를 넣어도 나중에 get을 하면 문자를 반환하는데 사용하는 측에서 캐스팅을 안하고 그대로 전달하면 값이 막 문자열로 합쳐지면서 난리가 나게 돼. 아니면 클라이언트에서 숫자로 줘야 하는데 문자열로 넘기는 상황도 있을 수 있고. 어쨌든 그런 이슈가 생기면 값이 끝도 없이 늘어날 수도 있어. 이렇게..

10000 + '100' = '10000100'

이 값을 db에 쓸 때에 orm에서 에러가 날까봐 안전하게 해놓는다고 아래처럼 setter에서 강제 타입 캐스팅을 해준다면 별다른 에러없이 그대로 저장되겠지.

func setPrice(price) {
  price = parseInt(price, 10);
  db.update({price:price});
}

개요가 참 길었네. 어쨌든, 그래서 궁금했어. 자바스크립트는 이런 암묵적 캐스팅을 어떤 룰을 통해 어디서 하는걸까?


일단 구글에 ecma operator type casting으로 검색해서 대충 원하는 내용을 찾아냈어.
https://262.ecma-international.org/5.1/#sec-11.6.1 (Additive Operators)
https://262.ecma-international.org/5.1/#sec-11.9.3 (Double Equal Algorithm)

비교문에 대한 룰이 상당히 복잡한데 위에서 말했듯이 안티 패턴으로 ==은 잘 쓰이지 않으니 여기서는 연산자 부분만 볼게.

11.6.1 The Addition operator ( + )
...
5. Let lprim be ToPrimitive(lval).
6. Let rprim be ToPrimitive(rval).
7. If Type(lprim) is String or Type(rprim) is String, then Return the String that is the result of concatenating ToString(lprim) followed by ToString(rprim)
(대충 Primitive type으로 캐스팅해서 둘 중 하나라도 string타입이면 ToString해서 concat으로 붙인다는 얘기)

그 아래 다른 연산자(-*/%)는 어떤지 보니까 거기서는 파라미터를 ToPrimitive로 캐스팅하지 않고 ToNumber로 변환해서 계산하도록 되어 있어.

11.6.2 The Subtraction Operator ( - )
...
5. Let lnum be ToNumber(lval).
6. Let rnum be ToNumber(rval).
7. Return the result of applying the subtraction operation to lnum and rnum.

왜 더하기만 다르게 구현되어 있을까?
잠깐 생각해보면 아무리 강타입 언어라도 string 클래스에서 연산자 오버로딩을 통해 더하기를 지원하고 있어.
그 때문에 string + string 표현식이 자연스러운데 자바스크립트는 아무래도 스크립트 언어다보니 이 룰을 조금 느슨하게 풀어놓아서 이렇게 되었을거야.

더 깊이 알아보기 전에 ecma룰을 알 수 있는 예제를 몇 개 만들어보면,

// 더하기 연산
1 + ''    // "1"
'' + 1 + 2  // "12"
1 + 2 + '' + 4 + 5  // "345"

''같은 빈 문자열이라도 더하면 해당 식은 무조건 문자열이 돼. 
근데 마지막 예제같이 연속된 계산식 사이에 문자열 캐스팅이 있을 경우에는 순차적으로 계산하기 때문에 1+2가 먼저 계산되어 3이 오게 되고 거기에 ''가 더해지면서 '3'으로 변환된 후에 뒤에 식을 계산하게 되어서 '345'라는 문자열을 반환하는 모습이야.

// 빼기 연산
'005' + 2  // "0052"
'005' - 2  // -3

더하기는 문자열로, 빼기는 숫자로 캐스팅되어 자료형이 맞춰지는걸 볼 수 있어.

'0x5' - 2    // 3
'-5e2' - 2   // 502
Number('5a') // NaN
'5a' - 2     // NaN

문자열이 숫자로 변환되기만 한다면 문제없이 계산되는데 '5a'는 Number 캐스팅 시에 NaN(not a number)이 나오기 때문에 빼기 연산자에서는 항상 NaN을 반환하고 있어. 이는 곱하기나 나누기, 나머지 연산도 동일해.

룰 외에 첨언해보면 parseInt는 동작 방식이 조금 달라. 다른 캐스팅과 다르게 앞에서부터 연속된 숫자까지는 변환이 성공하게 돼.

> parseInt('123abc', 10)
123
> parseInt('1a2b3c', 10)
1
> parseInt('a1b2c3', 10)
NaN

여기까지 예제를 통해 대략적인 룰이 어떻게 적용되는지 알아봤고 이제는 실제 구현이 어떻게 되어있는지 쭉 볼거야. 참고로 설명에 필요없는 부분이나 지나치게 길어지는 템플릿 선언부는 임의로 삭제했으니 원본 코드를 보고 싶으면 v8 코드에서 구경해보길 추천해.

이 순서대로 하나씩 분석해볼거야. 
1. 숫자 + 숫자
2. 문자 + 문자
3. 그 외 타입끼리 더하기

일단 v8 코드에서 대충 캐스팅에 관련된 키워드로 검색해보니 이런 정의문이 나왔어.

DEF_BINOP(Add_WithFeedback, Generate_AddWithFeedback)
DEF_BINOP(Subtract_WithFeedback, Generate_SubtractWithFeedback)
DEF_BINOP(Multiply_WithFeedback, Generate_MultiplyWithFeedback)
DEF_BINOP(Divide_WithFeedback, Generate_DivideWithFeedback)
...

함수 이름만 봐도 사칙연산에 관련있어 보이지? Add_WithFeedback 함수가 200줄이 넘어가서 주요 단락마다 끊어서 볼거야.


1. 숫자 + 숫자

TNode&lt;Object> BinaryOpAssembler::Generate_AddWithFeedback(context, lhs, rhs, slot_id, maybe_feedback_vector, update_feedback_mode, rhs_known_smi) {
  Branch(TaggedIsNotSmi(lhs), &if_lhsisnotsmi, &if_lhsissmi);
  BIND(&if_lhsissmi);
  {
    {
      Label if_rhsissmi(this), if_rhsisnotsmi(this);
      Branch(TaggedIsSmi(rhs), &if_rhsissmi, &if_rhsisnotsmi);
      BIND(&if_rhsisnotsmi);
      {
        // Check if the {rhs} is a HeapNumber.
        TNode&lt;HeapObject> rhs_heap_object = CAST(rhs);
        var_fadd_lhs = SmiToFloat64(lhs_smi);
        var_fadd_rhs = LoadHeapNumberValue(rhs_heap_object);
        Goto(&do_fadd);
      }
      BIND(&if_rhsissmi);
    }
    {
      TNode&lt;Smi> rhs_smi = CAST(rhs);
      TNode&lt;Smi> smi_result = TrySmiAdd(lhs_smi, rhs_smi, &if_overflow);
      {
        var_result = smi_result;
        Goto(&end);
      }
    }
    ...
  }
  BIND(&do_fadd);
  {
    ...
    TNode&lt;Float64T> value = Float64Add(var_fadd_lhs.value(), var_fadd_rhs.value());
    TNode&lt;HeapNumber> result = AllocateHeapNumberWithValue(value);
    var_result = result;
    Goto(&end);
  }
  ...
  BIND(&end);
  return var_result.value();
}


일단 Branch라는 분기문부터 시작하는데 lhs 타입에 따라 다른 라벨로 점프하게 돼. 이 단락에선 lhs가 smi 타입이라고 생각할게. 

그럼 if_lhsissmi 라벨 구문을 실행하게 되고, rhs가 smi가 아닌 숫자 타입이면 rhsisnotsmi 라벨을 실행하게 돼. 이 때, lhs는 smi 타입이니까 float64 타입으로 바꿔주고, rhs는 heap number(double)이니까 꺼내와서 각각을 var_fadd_lhs, var_fadd_rhs에 할당해서 do_fadd 라벨을 호출하고 있어.

이 로직에서 smi 타입이 아닌 숫자의 연산은 두 변수 모두를 float64로 변환해서 실수 연산을 한다는걸 알 수 있어.

이제 그 아래로 넘어오면 rhsissmi 라벨이 있는데 rhs를 smi로 캐스팅해서 TryAddSmi 함수를 호출하고 있어. 이 부분이 두 변수가 다 smi 타입일 경우에 발생하는 가장 일반적인 케이스야.

마지막 부분은 do_fadd 라벨 부분인데 캐스팅한 두 실수형 변수를 Float64Add 함수를 호출해서 받은 값을 결과값으로 넘기게 돼. 

TrySmiAdd, Float64Add 함수들 안쪽에는 뭐가 있을지 조금 더 깊이 들어가봤는데 그 안에서 호출하는 함수들이 raw-machine-assembler.h 파일에 선언되어 있어.

Node* Int32AddWithOverflow(Node* a, Node* b) {
  return AddNode(machine()->Int32AddWithOverflow(), a, b);
}
Node* Float64Add(Node* a, Node* b) {
  return AddNode(machine()->Float64Add(), a, b);
}

machine()->???() 함수가 반환하는게 Operator* 형인데 대충 보니 아키텍쳐마다 추상화된 Operator 객체를 이용하여 a, b 연산 명령을 반환하는 목적이더라고.

그래도 계산하는 부분은 한번 구경해보고 싶어서 (지금 아니면 언제 찾아보겠어) 깊이깊이 추상화로 감춰진 부분을 헤쳐보다가 opcode 입력하는 곳까지 가봤어. 여기선 x64 아키텍쳐 코드 기준이야.

// compiler/backend/x64/code-generator-x64.cc
CodeGenerator::CodeGenResult CodeGenerator::AssembleArchInstruction(Instruction* instr) {
  ArchOpcode arch_opcode = ArchOpcodeField::decode(opcode);
  switch (arch_opcode) {
    case kX64Add32:
      ASSEMBLE_BINOP(addl);
      break;
    ...

#define ASSEMBLE_BINOP(asm_instr)                                \
  do {                                                           \
    if (HasAddressingMode(instr)) {                              \
      size_t index = 1;                                          \
      Operand right = i.MemoryOperand(&index);                   \
      __ asm_instr(i.InputRegister(0), right);                   \
  ...

switch 분기문에서 이런 식의 define으로 풀어지게 되는데 이 때에 비로소 32비트 더하기 연산인 addl 어셈블리 명령으로 변환돼. Float64Add도 비슷한 과정을 거쳐서 vaddsd 어셈 명령으로 변환되더라.


2. 문자 + 문자

1번과 같은 Generate_AddWithFeedback() 함수에 구현된 부분이야.

GotoIf(IsStringInstanceType(lhs_instance_type), &lhs_is_string);
BIND(&lhs_is_string);
{
  TNode&lt;Uint16T> rhs_instance_type = LoadInstanceType(rhs_heap_object);
  GotoIfNot(IsStringInstanceType(rhs_instance_type), &call_with_any_feedback);
  var_result = CallBuiltin(Builtin::kStringAdd_CheckNone, context(), lhs, rhs);
  Goto(&end);
}

첫 줄에 분기문에서 string 타입이 아니면 call_with_any_feedback 라벨로 이동하지? 여기서 호출하는 builtin 함수는 파라미터가 모두 문자열일 경우에만 작동하는 함수라서 그래. (이건 3번 항목에서 볼거야)

그 분기문을 넘어가면 kStringAdd_CheckNone 빌트인 함수를 호출하여 뭔가 더해줄 것 처럼 생겼어. 그 함수를 추적해보면 이런 식으로 선언 및 구현되어 있어.

// builtins-definitions.h
// TFS: Builtin in Turbofan, with CodeStub linkage.
TFS(StringAdd_CheckNone, kLeft, kRight)

// builtins-string-gen.cc
TF_BUILTIN(StringAdd_CheckNone, StringBuiltinsAssembler) {
  auto left = Parameter&lt;String>(Descriptor::kLeft);
  auto right = Parameter&lt;String>(Descriptor::kRight);
  Return(StringAdd(context, left, right));
}

TNode&lt;String> StringBuiltinsAssembler::StringAdd(context, left, right) {
  TVARIABLE(String, result);
  TNode&lt;Uint32T> left_length = LoadStringLengthAsWord32(left);
  TNode&lt;Uint32T> right_length = LoadStringLengthAsWord32(right);
  TNode&lt;Uint32T> new_length = Uint32Add(left_length, right_length);
  result = AllocateConsString(new_length, var_left.value(), var_right.value());
  return result.value();
}

TNode&lt;String> StringBuiltinsAssembler::AllocateConsString(TNode&lt;Uint32T> length, TNode&lt;String> left, TNode&lt;String> right) {
  TNode&lt;HeapObject> result = AllocateInNewSpace(ConsString::kSize);
  StoreObjectFieldNoWriteBarrier(result, ConsString::kLengthOffset, length);
  StoreObjectFieldNoWriteBarrier(result, ConsString::kFirstOffset, left);
  StoreObjectFieldNoWriteBarrier(result, ConsString::kSecondOffset, right);
  return CAST(result);
}

딱히 어려운 로직은 아니라서 마지막으로 실행되는 AllocateConsString 함수만 잠깐 살펴보면, 전체 길이로 메모리 할당을 하고 left, right를 각 순서에 맞게 offset 메모리에 쓰고 있어. 
보면서 조금 흥미로웠던 건 메모리 할당 시 플래그로 young, old space를 설정할 수 있다는 거야. gc에서 자주 나오는 그거. v8이 알아서 하겠지 싶어서 gc쪽은 깊이 살펴보진 않았는데 할당 시점에서 제어하는거 보니까 반갑기도 하고 신기하기도 하고.


3. 그 외 타입끼리 더하기

이제 마지막으로 캐스팅이 필요한 더하기 연산을 볼거야. 시작점은 동일한 Generate_AddWithFeedback() 함수야.

GotoIfNot(IsStringInstanceType(rhs_instance_type), &call_with_any_feedback);
BIND(&call_with_any_feedback);
{
  var_type_feedback = SmiConstant(BinaryOperationFeedback::kAny);
  Goto(&call_add_stub);
}

BIND(&call_add_stub);
{
  UpdateFeedback(var_type_feedback.value(), maybe_feedback_vector(), slot_id, update_feedback_mode);
  var_result = CallBuiltin(Builtin::kAdd, context(), lhs, rhs);
  Goto(&end);
}

lhs, rhs가 서로 다른 타입인지 확인하는 분기문의 끝은 call_with_any_feedback 라벨이야. 거기서는 call_add_stub을 호출하고, kAdd 빌트인 함수를 호출하는데 얘는 좀 힘들게 찾았어.

전에 StringAdd 함수는 builtins-string-gen.cc 파일에 잘 구현되어 있었는데 쟤는 도통 찾아지지 않다가 혹시 torque에 구현되어있나 살펴보니 그때서야 나왔어.

torque가 뭐냐하면 v8에서 만든 전용 스크립트 언어인데 타입스크립트처럼 생겨서 보기는 편하더라. 어쨌든 그 파일이 *.tq인데 여기에 온갖 내장함수가 구현되어 있길래 관련 내용을 조금 더 찾아보니 추후 빌트인 함수 구현을 torque로 지향할거란 얘기도 있었어. (포팅도 거의 다 한것 같고)
https://v8.dev/docs/torque

어쨌든 torque 스크립트는 이렇게 생겼어.

// number.tq
transitioning builtin Add(implicit context: Context)(
    leftArg: JSAny, rightArg: JSAny): JSAny {
  let left: JSAny = leftArg;
  let right: JSAny = rightArg;
  typeswitch (left) {
    case (left: Smi): {
      typeswitch (right) {
        case (right: Smi): {
          return math::TrySmiAdd(left, right) otherwise goto Float64s(SmiToFloat64(left), SmiToFloat64(right));
        }
        case (right: HeapNumber): {
          goto Float64s(SmiToFloat64(left), Convert&lt;float64>(right));
        }
        case (right: BigInt): {
          goto Numerics(left, right);
        }
        case (right: String): {
          goto StringAddConvertLeft(left, right);
        }
        case (HeapObject): {
          right = ToNumericOrPrimitive(right);
          continue;
        }
   
맨날 추상화된 객체만 보다가 switch로 깔끔하게 되어있는거 보니까 눈정화되는 느낌. 다른 애들은 다 숫자로 캐스팅해서 계산하고 있으니 문자열 더하는 부분인 StringAddConvertLeft 함수를 볼게.

얘는 외부 함수로 builtins-string.tq 파일에 있는 함수야. 

transitioning builtin StringAddConvertLeft(implicit context: Context)(left: JSAny, right: String): String {
  return ToStringImpl(context, ToPrimitiveDefault(left)) + right;
}

transitioning macro ToStringImpl(context: Context, o: JSAny): String {
  let result: JSAny = o;
  typeswitch (result) {
    case (num: Number): {
      return NumberToString(num);
    }
    case (str: String): {
      return str;
    }
    case (oddball: Oddball): {
      return oddball.to_string;
    }
    case (JSReceiver): {
      result = NonPrimitiveToPrimitive_String(context, result);
      continue;
    }
    case (Symbol): {
      ThrowTypeError(MessageTemplate::kSymbolToString);
    }
    case (JSAny): {
      return runtime::ToString(context, result);
    }
  }
  unreachable;
}

이제 이게 마지막 함수니까 그냥 쭉 붙여봤어. 변수의 타입에 따라 분기문에서 각 타입에 맞는 문자열 변환 함수를 사용해서 문자열을 반환하는데 이를 right와 더해서 반환한 부분을 볼 수 있어. 근데 Oddball 타입이 우리가 쓰고 있는 boolean 타입이거든?

'3' + true  // "3true"

근데 to_string 한다고 저렇게 문자열 true, false가 나오는게 좀 신기하잖아? 그래서 또 찾아봤지.

// setup-heap-internal.cc
Oddball::Initialize(isolate(), factory->true_value(), "true", handle(Smi::FromInt(1), isolate()), "boolean", Oddball::kTrue);
Oddball::Initialize(isolate(), factory->false_value(), "false", handle(Smi::zero(), isolate()), "boolean", Oddball::kFalse);

최초 인스턴스 시작할 때에 각종 heap object를 초기화하는 곳에서 Oddball 타입의 1, 0 값에 대한 true, false 문자열을 매핑하는 곳이 있더라. Boolean의 toString 함수에서는 이 매핑을 이용해서 "true"값을 넘기는 거였어.


결론)
1) 숫자 + 숫자는 타입이 다를 경우 float64로 변환 후 계산한다
2) 문자 + 문자는 그냥 잘 된다
3) v8 빌트인 함수는 torque 스크립트에 많은 양이 구현되어 있다
4) boolean의 toString 시 나오는 문자열은 초기화 시점에 매핑 테이블을 만들어서 사용한다


예제도 많고, 분석 내용도 많다보니 꽤나 긴 글이 되었네. 웹에서 보면 조금 더 편하려나. 근데 품을 많이 들이면 이런 정리조차 안할 것 같아서 못하겠다는 핑계를 한번 대봄.

다들 좋은 밤 보내.


이전글: https://frogred8.github.io/
#frogred8 #javascript #suck