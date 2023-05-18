---
layout: page
title: "[javascript] for-in 구현 분석"
date: 2023-05-19
---

<pre>
for-in으로 오브젝트를 순회하면 가끔 이상하게 키 순서가 바뀌는 경우가 있는데 아래 for-in 예제를 기준으로 설명할게.

// 코드
let obj1 = {
  '001': 'a',
  '201': 'c',
  '101': 'b',
  '301': 'd'
};
for (const key in obj1) {
  console.log(key);
}
// 출력 결과
'101'
'201'
'301'
'001'

출력 결과가 좀 이상하지 않아? 입력한 순서대로 나오는 것도 아니고 정렬된듯 하지만 안되어있기도 하고 그렇잖아.
사실 나도 처음엔 'object에 key는 안에서 map으로 가지고 있을테니까 자료 구조에 따라 추가/삭제할 때마다 순서가 임의로 바뀌겠지'라고 대충 생각했어. 그런데 실제로 구현부를 보니 많이 다르더라고. 그래서 이게 왜 이렇게 되는지 v8 코드 레벨로 분석해봤어.


- 내용
일단 for-in 코드를 v8에서 찾아봤는데 운좋게도 runtime-forin.cc 파일을 빨리 발견해서 꽤 쉽게 구현체를 찾을 수 있었어.

RUNTIME_FUNCTION(Runtime_ForInEnumerate) {
  HandleScope scope(isolate);
  Handle&lt;JSReceiver> receiver = args.at&lt;JSReceiver>(0);
  RETURN_RESULT_OR_FAILURE(isolate, Enumerate(isolate, receiver));
}

파라미터 하나를 받아서 Enumerate 함수로 넘겨주는 역할을 하는데 저기엔 우리가 순회하려는 오브젝트가 들어가게 돼. 그래서 넘겨주는 다음 함수를 보면,

MaybeHandle&lt;HeapObject> Enumerate(Isolate* isolate, Handle&lt;JSReceiver> receiver) {
  FastKeyAccumulator accumulator(isolate, receiver, KeyCollectionMode::kIncludePrototypes, ENUMERABLE_STRINGS, true);
  Handle&lt;FixedArray> keys;
  ASSIGN_RETURN_ON_EXCEPTION(isolate, keys, accumulator.GetKeys(accumulator.may_have_elements() ? GetKeysConversion::kConvertToString : GetKeysConversion::kNoNumbers), HeapObject);
  return keys;
}

KeyAccumulator 객체가 중요한데 여기서 생성할 때에 각 파라미터가 filter_:ENUMERABLE_STRINGS, is_for_in_:true, skip_indices_:false로 설정하고 있어. 이 객체에서 호출하는 GetKeys() 함수가 실제로 오브젝트의 멤버를 가져오는 메인 함수야.

MaybeHandle&lt;FixedArray> FastKeyAccumulator::GetKeys(GetKeysConversion keys_conversion) {
  if (filter_ == ENUMERABLE_STRINGS) {
    Handle&lt;FixedArray> keys;
    if (GetKeysFast(keys_conversion).ToHandle(&keys)) {
      return keys;
    }
  }
}

아까 지정한 filter_ 타입에 따라 GetKeysFast 함수를 호출하는데 이 함수 안에서 호출하는 부분이 재밌어. (아래 함수들도 모두 동일한 리턴 타입이라 가독성을 위해서 뺐어)

FastKeyAccumulator::GetKeysFast(..) {
  Map map = receiver_->map();
  if (map.is_dictionary_map()) {
    return GetOwnKeysWithElements&lt;false>(isolate_, object,keys_conversion, skip_indices_);
  }
  return GetOwnKeysWithElements&lt;true>(isolate_, object, keys_conversion, skip_indices_);
}

GetOwnKeysWithElements 함수를 호출할 때에 파라미터는 동일하게 해놓고 앞에 템플릿을 다르게 선언했더라고. 그래서 저 함수를 보면, fast_properties를 파라미터로 받지 않고 템플릿으로 선언해서 사용하는걸 볼 수 있어. 나라면 그냥 파라미터 하나 더 추가할텐데 저렇게 한 이유가 있었겠지? (이유가 좀 궁금하긴 하다)

template &lt;bool fast_properties>
GetOwnKeysWithElements(...) {
  Handle&lt;FixedArray> keys;
  if (fast_properties) {
    keys = GetFastEnumPropertyKeys(isolate, object);
  } else {
    keys = KeyAccumulator::GetOwnEnumPropertyKeys(isolate, object);
  }
  MaybeHandle&lt;FixedArray> result;
  if (skip_indices) {
    result = keys;
  } else {
    result = accessor->PrependElementIndices(object, keys, convert, ONLY_ENUMERABLE);
  }
  return result;
}

어쨌든 안에서 로직을 쭉쭉 따라가다보면 여기서는 GetFastEnumPropertyKeys 에서 ENUMERABLE_STRINGS 타입인 property를 얻게 돼. 여기서 중요한 건 코드 내에서 string 타입의 키는 property, number 타입의 키는 index로 부르고 있다는 거야.

따라서 지금 얻은 건 string 타입의 키 목록뿐이니까 이제 number 타입 키를 얻어야 돼. 그건 아까 skip_indices_가 false였으니까 PrependElementIndices 함수를 호출하는데 여기서 number 타입의 키 목록을 가져오게 돼.

PrependElementIndicesImpl(...) {
  Handle&lt;FixedArray> combined_keys;
  bool needs_sorting = IsDictionaryElementsKind(kind()) || IsSloppyArgumentsElementsKind(kind());
  combined_keys = Subclass::DirectCollectElementIndicesImpl(isolate, object, backing_store, needs_sorting ? GetKeysConversion::kKeepNumbers : convert, filter, combined_keys, &nof_indices);

  if (needs_sorting) {
    SortIndices(isolate, combined_keys, nof_indices);
  }
  CopyObjectToObjectElements(isolate, *keys, PACKED_ELEMENTS, 0, *combined_keys, PACKED_ELEMENTS, nof_indices, nof_property_keys);
  return combined_keys;
}

객체 타입이 sorting이 필요한지 확인하고, DirectCollectElementIndicesImpl 함수 호출해서 받은 combined_keys가 number 타입 키 목록이야. 여기서 sorting 여부에 따라 정렬 함수인 SortIndices를 호출해주고, 이후에 CopyObjectToObjectElements 함수 호출로 만들어진 combined_keys를 반환하는데 저 함수가 이제 마지막이야.

void CopyObjectToObjectElements(...) {
  ...
  FixedArray from = FixedArray::cast(from_base);
  FixedArray to = FixedArray::cast(to_base);
  to.CopyElements(isolate, to_start, from, from_start, copy_size, write_barrier_mode);
}

여기서 to_base가 방금 넘긴 combined_key(number 타입 키 목록)이고, from_base가 저 위에 GetFastEnumPropertyKeys 함수에서 가져온 string 키 목록이야. to에다가 from을 합치니까 결과적으로 number 타입 키 + string 타입 키 순서의 목록을 반환하게 되는거지.


- 결론
1) JSObject는 키 타입에 따라 string은 property, number는 index로 분리한다.
2) index는 정렬이 기본이고, 만약 정렬이 안되어 있으면 실시간으로 정렬해서 반환하기도 한다.
3) for-in으로 반환하는 enumerable 객체는 number + string 키 타입 순으로 가져와서 전달한다.
4) 예제 출력 결과에서 '001' 키는 number 타입처럼 보이지만 사실은 string 타입이라서 마지막 순서로 출력된다.

지면이 작아 함축된 부분이 많은데 더 자세한 내용은 v8 코드 받아서 저 키워드로 검색해보면 될거야.

#frogred8 #javascript #v8 #forin