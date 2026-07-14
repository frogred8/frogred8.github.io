---
layout: page
title: "[javascript] Analyzing the implementation of for-in"
date: 2023-05-19
---

<pre>
When you iterate over an object with for-in, the key order sometimes changes in strange ways. I’ll explain it using the for-in example below.

// Code
let obj1 = {
  '001': 'a',
  '201': 'c',
  '101': 'b',
  '301': 'd'
};
for (const key in obj1) {
  console.log(key);
}
// Output
'101'
'201'
'301'
'001'

The output looks a little odd, doesn’t it? It doesn’t come out in the order we entered it, and it seems sorted, but also not quite sorted.
At first, I also vaguely thought, “Object keys are probably stored internally in a map, so depending on the data structure, the order must change arbitrarily whenever keys are added or deleted.” But when I actually looked at the implementation, it was very different. So I analyzed why this happens at the V8 code level.


- Content
First, I looked for the for-in code in V8, and luckily I quickly found the runtime-forin.cc file, so it was fairly easy to find the implementation.

RUNTIME_FUNCTION(Runtime_ForInEnumerate) {
  HandleScope scope(isolate);
  Handle&lt;JSReceiver> receiver = args.at&lt;JSReceiver>(0);
  RETURN_RESULT_OR_FAILURE(isolate, Enumerate(isolate, receiver));
}

It takes one parameter and passes it to the Enumerate function. That parameter is the object we want to iterate over. So if we look at the next function it passes the object to:

MaybeHandle&lt;HeapObject> Enumerate(Isolate* isolate, Handle&lt;JSReceiver> receiver) {
  FastKeyAccumulator accumulator(isolate, receiver, KeyCollectionMode::kIncludePrototypes, ENUMERABLE_STRINGS, true);
  Handle&lt;FixedArray> keys;
  ASSIGN_RETURN_ON_EXCEPTION(isolate, keys, accumulator.GetKeys(accumulator.may_have_elements() ? GetKeysConversion::kConvertToString : GetKeysConversion::kNoNumbers), HeapObject);
  return keys;
}

The KeyAccumulator object is important. When it is created here, each parameter is set to filter_:ENUMERABLE_STRINGS, is_for_in_:true, and skip_indices_:false. The GetKeys() function called on this object is the main function that actually retrieves the object’s members.

MaybeHandle&lt;FixedArray> FastKeyAccumulator::GetKeys(GetKeysConversion keys_conversion) {
  if (filter_ == ENUMERABLE_STRINGS) {
    Handle&lt;FixedArray> keys;
    if (GetKeysFast(keys_conversion).ToHandle(&keys)) {
      return keys;
    }
  }
}

It calls GetKeysFast according to the filter_ type we set earlier, and the part called inside this function is interesting. (The functions below all have the same return type, so I omitted it for readability.)

FastKeyAccumulator::GetKeysFast(..) {
  Map map = receiver_->map();
  if (map.is_dictionary_map()) {
    return GetOwnKeysWithElements&lt;false>(isolate_, object,keys_conversion, skip_indices_);
  }
  return GetOwnKeysWithElements&lt;true>(isolate_, object, keys_conversion, skip_indices_);
}

When calling GetOwnKeysWithElements, the parameters are the same, but the template declared in front is different. So if we look at that function, we can see that it doesn’t receive fast_properties as a parameter, but declares and uses it as a template. If it were me, I would probably just add one more parameter, but I’m sure there was a reason for doing it this way. (I am a bit curious about the reason.)

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

Anyway, if you keep following the logic inside, here it gets properties of type ENUMERABLE_STRINGS from GetFastEnumPropertyKeys. The important point is that in the code, string-type keys are called properties, and number-type keys are called indices.

So what we have now is only the list of string-type keys, which means we now need to get the number-type keys. Since skip_indices_ was false earlier, it calls PrependElementIndices, and this is where it retrieves the list of number-type keys.

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

It checks whether the object type requires sorting, then calls DirectCollectElementIndicesImpl, and the combined_keys it receives is the list of number-type keys. Depending on whether sorting is needed, it calls SortIndices, the sorting function, and then returns the combined_keys created through the CopyObjectToObjectElements call. That function is the final step.

void CopyObjectToObjectElements(...) {
  ...
  FixedArray from = FixedArray::cast(from_base);
  FixedArray to = FixedArray::cast(to_base);
  to.CopyElements(isolate, to_start, from, from_start, copy_size, write_barrier_mode);
}

Here, to_base is the combined_key we just passed in, the list of number-type keys, and from_base is the list of string keys obtained from the GetFastEnumPropertyKeys function above. Since it merges from into to, the function ultimately returns a list ordered as number-type keys + string-type keys.


- Conclusion
1) JSObject separates keys by type: strings are properties, and numbers are indices.
2) Indices are sorted by default, and if they are not sorted, they may also be sorted in real time before being returned.
3) Enumerable objects returned by for-in are retrieved and passed along in number + string key type order.
4) In the example output, the '101', '201', and '301' keys are number-type keys, so they are sorted and printed together, while the '001' key looks like a number-type key but is actually a string-type key, so it is printed last.

There is a lot compressed here because of limited space, but if you want more detail, you can download the V8 code and search for those keywords.

#frogred8 #javascript #v8 #forin
</pre>
