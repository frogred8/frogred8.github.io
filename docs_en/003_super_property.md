---
layout: page
title: "[javascript] Introduction to super property access"
date: 2022-05-06
---

<pre>
This time, I'll briefly introduce an article about super property access, which became tens of times faster in V8 9.0, and take a look at the internal structure too.
https://v8.dev/blog/fast-super

That version was released in February 2021, and I brought it up because there was a major performance improvement in this area.

First, for anyone who isn't familiar with the concept of super, JavaScript also has an inheritance structure. It's not implemented as completely as in C++; instead, it's implemented indirectly using prototypes.
The huge performance gap between normal and super property access was partly because the old implementation was inefficient, but I think people had been overlooking it as something unavoidable due to the inheritance structure, and this time they fixed it. In the past, inheritance was hardly used, so that cost wasn't very significant. But as people started building large and complex structures with JavaScript (things like React?), the cost of accessing super properties must have grown, making the need for improvement much bigger.

In V8, normal variable access can directly access the offset of a known property through a mapping table called a hidden class, and information about functions that are executed repeatedly is built into inline caches, making it even faster. What changed this time is that super property access, which had only been handled at runtime, was improved. In any case, repeatedly walking up through parents every time doesn't feel great.


For comparison, let's first look at the existing way super properties were accessed.

class A { }
A.prototype.x = 100;
class B extends A {
  m() {
    return super.x;
  }
}
const b = new B();
b.m();

The prototype of the parent class A stores the value x, and the class B that inherits from it accesses the super property x through the m function. The prototype chain will be created like this:

b ->
 b.__proto__ === B.prototype ->
  B.prototype.__proto__ === A.prototype ->
   A.prototype.__proto__ === Object.prototype ->
    Object.prototype.__proto__ === null

When actually accessing x here, the lookup starts by checking whether the b instance has x. If it doesn't, it moves to the parent class and keeps repeating that check. If you access a property that doesn't exist, it searches from the lower level up through the parent classes, and only when the topmost class is null can it finally determine that the property "doesn't exist." If you accessed x directly in real code, it would look like this: b.__proto__.__proto__.x

But a small(?) feature added midway like this is relatively easy to find. That's because you can search through V8's commit list. The commit below is the actual initial commit for the implementation, and even this much gives you keywords for finding the connections, which makes analysis much easier.
https://github.com/v8/v8/commit/5339e5467ef33fd064fb996652ea01f876432edd
Now that we're fully prepared, let's deep dive to code~


First, looking at how the existing code fetched a super property,

MaybeHandle&lt;Object> LoadFromSuper(Isolate* isolate, Handle&lt;Object> receiver,
                                  Handle&lt;JSObject> home_object,
                                  PropertyKey* key) {
  ....
  LookupIterator it(isolate, receiver, *key, holder);
  Handle&lt;Object> result;
  ASSIGN_RETURN_ON_EXCEPTION(isolate, result, Object::GetProperty(&it), Object);
  return result;
}

You can see that it creates a LookupIterator it and passes it to GetProperty.
Then we should look at GetProperty too, right?

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


It iterates while checking whether that key exists, and if you keep following the implementation down to NextHolder, which is the Next function implementation of that LookupIterator, you eventually find this function that checks whether there is a next prototype.

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

You can see that if there is no prototype, it returns an empty JSReceiver, right? This was the old journey for finding a super property. Since it was made as a runtime function like this, the performance wasn't great, so they generalized the existing normal property access method and applied it here too.

But what surprised me a bit in Google's commit was that when I followed the linked design document, they had written a 20-page document explaining why this is a problem now, how it might be good to fix it, asking for thoughts, laying out how the implementation should be done, including the design diagram, pseudo code, things to verify, performance tests, and three or four alternatives. It's impressive that they made this public, and it also made me wonder whether FAANG-level companies work like this... Anyway. I'll leave the link here, so take a quick look if you're curious.
https://docs.google.com/document/d/1b_wgtExmJDLb8206jpJol-g4vJAxPs1XjEx95hwRboI/edit#heading=h.kurmjqj8jfgd

In any case, setting my envy aside, now we should look at how they changed the implementation. As described in the design document, they made it possible to read super properties by generalizing the existing normal property reading logic. First, looking at the function added to AccessorAssembler:

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

As you can tell from the class name Accessor, it's probably a class that gathers implementations for accessing something. The important part here is the creation of lookup_start_object_map, and the function looks like this:

TNode&lt;Map> CodeStubAssembler::LoadReceiverMap(TNode&lt;Object> receiver) {
  return Select&lt;Map>(
      TaggedIsSmi(receiver), [=] { return HeapNumberMapConstant(); },
      [=] { return LoadMap(UncheckedCast&lt;HeapObject>(receiver)); });
}

That Select function consists of condition, true_body, and false_body in order. If we expand it, it means that if the current receiver is a small integer value, it goes to the number map; otherwise, it goes to LoadMap. Since we probably won't be passing a numeric key here, it goes into the LoadMap function, and if you keep following it down, the final leap function ends up calling a function included in raw_assembler that looks like this:

Node* CodeAssembler::LoadFromObject(MachineType type, TNode&lt;Object> object, TNode&lt;IntPtrT> offset) {
  return raw_assembler()->LoadFromObject(type, object, offset);
}

Only AccessorAssembler added something new; the functions here already existed. So that's probably why the design document said they only needed to generalize things. I wanted to look around the call sites to some extent too, but even after analyzing this part for a day, I couldn't clearly understand it myself, so I moved on. It's difficult to grasp the overall structure in just a few days.

Before wrapping up, one bit of side chatter: analyzing a highly advanced project like this is hard not only because the abstraction level is high, but also because all sorts of define statements are used to generate and define functions.

For example, the VisitGetNamedPropertyFromSuper function is matched with the kGetNamedPropertyFromSuper enum value and called, but I just couldn't find the connected part through search. After widening the search scope again and again, I finally found it, and it was defined like this:

#define BYTECODE_CASE(name, ...)       \
  case interpreter::Bytecode::k##name: \
    Visit##name();                     \
    break;
      BYTECODE_LIST(BYTECODE_CASE)
#undef BYTECODE_CASE

Based on the value that goes into name, it connects the k+name value with Visit+name. Then that name must be sent to some list somewhere, right? For that, we can look at the BYTECODE_LIST define statement, and I'll also show the define statement it calls inside.

#define BYTECODE_LIST(V)                                             \
  BYTECODE_LIST_WITH_UNIQUE_HANDLERS(V)                              \
  SHORT_STAR_BYTECODE_LIST(V)

#define BYTECODE_LIST_WITH_UNIQUE_HANDLERS(V)                                  \
  V(GetNamedPropertyFromSuper, ImplicitRegisterUse::kReadWriteAccumulator,     \
    OperandType::kReg, OperandType::kIdx, OperandType::kIdx)                   \
  ... (dozens of entries like this)

There we finally see the GetNamedPropertyFromSuper we were looking for. It's wrapped in V, and that V is the thing we passed earlier from BYTECODE_CASE, which creates the enum-to-function call site, right? So dozens of call sites are generated by the preprocessor in this way.
Because of this, no matter how much you search, it's hard to find the call site, and even when you do find it, you have to find the next abstracted thing after that... It was quite a painful process, so in the end I couldn't trace it all the way up to the top-level call. The limits of analysis without compiling and running it...


Conclusion)
1) Existing super property access was implemented as a runtime function.
2) By generalizing several functions used for normal property access, it was improved to use Inline Cache.
3) As a result, super property access became tens of times faster! profit!

The super property feature introduced here has been included since V8 9.0, and it is included in all releases after Node 16.0, so keep that in mind when migrating versions.
Latest releases by Node version: https://nodejs.org/ko/download/releases/

This ended up longer than the article I introduced because I organized what I studied over three days. I wonder who would read this kind of thing, but I'm posting it lightly with the mindset of organizing what I studied. Honestly, since this is the IT lounge, I'd like to see technical posts like this come up once or twice too. (It's a bit boring when it's only salary and job-changing posts.)

Have a great day.

#javascript #v8
</pre>
