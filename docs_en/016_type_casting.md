---
layout: page
title: "[javascript] Why is javascript type casting like this?"
date: 2022-10-01
---

<pre>
People who first learned programming with strongly typed languages (C/C++, Java) often find a lot of things strange when they first look at JavaScript. A string and an int can be added together without any special operator overloading, yet there are operators where that does not work, and the whole thing feels kind of chaotic.

So if you search for keywords like 'javascript suck', examples of operator type casting or comparison statements often come up. If you end up cursing while looking through them, that is normal.

Arithmetic operations
'3' + 2    // "32"
'5' - 2    // 3
'5' - '-2' // 7
'3' * '5'  // 15
3 / '2'    // 1.5

Arithmetic operations (feat.boolean)
'3' + true  // "3true"
'3' + +true // "31"
'3' + false // "3false"
3 + true    // 4
3 + false   // 3

Comparisons
1 == true     // true
'1' == true   // true
'01' == true  // true
-'-1' == true // true
'0' == false  // true
'0' == 0      // true
'' == 0       // true

Comparisons (feat.array)
[] == false    // true
[0] == false   // true
[1] == true    // true
[2] == false   // true
[1] == 1       // true
[1] == '1'     // true
[1,2] == '1,2' // true


Using double equals (==) in comparisons is already widely known as an anti-pattern, and most people use triple equals (===). Linters catch it well too, so you can just treat those examples as fun material for dunking on JavaScript. But arithmetic operations really do cause a lot of problems in practice.

For example, with something like Redis, even if you put in a numeric value, when you later get it back it returns a string. If the consuming side passes it along as-is without casting, values start getting concatenated as strings and everything goes off the rails. Or there could be a case where the client is supposed to send a number but sends a string instead. In any case, once that kind of issue happens, the value can keep growing without end. Like this..

10000 + '100' = '10000100'

When writing this value to the DB, if you try to make it safe so the ORM will not throw an error by forcibly type-casting it in the setter like below, it will just be saved as-is without any particular error.

func setPrice(price) {
  price = parseInt(price, 10);
  db.update({price:price});
}

That was a pretty long introduction. Anyway, that made me curious. Through what rules, and where, does JavaScript perform this kind of implicit casting?


First, I searched Google for ecma operator type casting and roughly found what I wanted.
https://262.ecma-international.org/5.1/#sec-11.6.1 (Additive Operators)
https://262.ecma-international.org/5.1/#sec-11.9.3 (Double Equal Algorithm)

The rules for comparisons are quite complex, but as mentioned above, == is an anti-pattern and is not used much, so here I will look only at the operator side.

11.6.1 The Addition operator ( + )
...
5. Let lprim be ToPrimitive(lval).
6. Let rprim be ToPrimitive(rval).
7. If Type(lprim) is String or Type(rprim) is String, then Return the String that is the result of concatenating ToString(lprim) followed by ToString(rprim)
(Basically, it casts to primitive types, and if either side is a string type, it applies ToString and concatenates them.)

Looking at the other operators below it (-*/%), they do not cast the parameters with ToPrimitive. Instead, they convert them with ToNumber and calculate.

11.6.2 The Subtraction Operator ( - )
...
5. Let lnum be ToNumber(lval).
6. Let rnum be ToNumber(rval).
7. Return the result of applying the subtraction operation to lnum and rnum.

Why is only addition implemented differently?
If you think about it for a moment, even strongly typed languages support addition through operator overloading in the string class.
Because of that, the expression string + string feels natural. Since JavaScript is a scripting language after all, it probably loosened this rule a bit, and this is how things ended up.

Before digging deeper, if we make a few examples where we can see the ECMAScript rules,

// Addition operation
1 + ''    // "1"
'' + 1 + 2  // "12"
1 + 2 + '' + 4 + 5  // "345"

If you add even an empty string like '', that expression always becomes a string. 
But when there is a string cast in the middle of a continuous calculation like in the last example, evaluation proceeds in order. So 1+2 is calculated first and becomes 3, then '' is added to it and it is converted to '3', after which the rest of the expression is calculated, returning the string '345'.

// Subtraction operation
'005' + 2  // "0052"
'005' - 2  // -3

You can see that addition casts to a string, while subtraction casts to a number so the types match.

'0x5' - 2    // 3
'-5e2' - 2   // 502
Number('5a') // NaN
'5a' - 2     // NaN

As long as the string can be converted into a number, the calculation proceeds without issue. But because '5a' becomes NaN (not a number) when cast with Number, the subtraction operator always returns NaN. The same applies to multiplication, division, and remainder operations.

As an extra note beyond the rules, parseInt behaves a bit differently. Unlike other casts, conversion succeeds up to the consecutive numeric portion from the beginning.

> parseInt('123abc', 10)
123
> parseInt('1a2b3c', 10)
1
> parseInt('a1b2c3', 10)
NaN

So far, we have used examples to get a rough idea of how the rules are applied. Now I will look through how the actual implementation works. For reference, I arbitrarily removed parts that were not needed for the explanation and template declarations that would make things too long, so if you want to see the original code, I recommend checking out the V8 code.

I will analyze these one by one in this order. 
1. Number + number
2. String + string
3. Addition between other types

First, when I roughly searched the V8 code for keywords related to casting, I found these definitions.

DEF_BINOP(Add_WithFeedback, Generate_AddWithFeedback)
DEF_BINOP(Subtract_WithFeedback, Generate_SubtractWithFeedback)
DEF_BINOP(Multiply_WithFeedback, Generate_MultiplyWithFeedback)
DEF_BINOP(Divide_WithFeedback, Generate_DivideWithFeedback)
...

Just from the function names, they look related to arithmetic operations, right? The Add_WithFeedback function is over 200 lines long, so I will break it up by the main sections.


1. Number + number

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


It starts with a branch statement called Branch, and jumps to different labels depending on the lhs type. In this section, I will assume that lhs is an smi type. 

Then it executes the if_lhsissmi label block, and if rhs is a numeric type that is not smi, it executes the rhsisnotsmi label. At this point, lhs is an smi type, so it converts it to float64, and rhs is a heap number (double), so it loads it, assigns each value to var_fadd_lhs and var_fadd_rhs, and calls the do_fadd label.

From this logic, we can see that operations involving numbers that are not smi types convert both variables to float64 and perform floating-point arithmetic.

Now, moving down below, there is a rhsissmi label, where rhs is cast to smi and the TryAddSmi function is called. This is the most common case, where both variables are smi types.

The last part is the do_fadd label. It calls the Float64Add function with the two cast floating-point variables and passes the returned value as the result. 

I went a little deeper into what might be inside the TrySmiAdd and Float64Add functions, and the functions they call are declared in the raw-machine-assembler.h file.

Node* Int32AddWithOverflow(Node* a, Node* b) {
  return AddNode(machine()->Int32AddWithOverflow(), a, b);
}
Node* Float64Add(Node* a, Node* b) {
  return AddNode(machine()->Float64Add(), a, b);
}

The machine()->???() function returns an Operator* type. From a quick look, its purpose is to return an a, b operation instruction using an Operator object abstracted per architecture.

Still, I wanted to take a look at the part that actually calculates it (when else would I look this up?), so I dug through the layers hidden deep behind abstractions and got as far as the place where the opcode is entered. This is based on the x64 architecture code.

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

In the switch branch, it expands through a define like this, and only at this point is it converted into the addl assembly instruction, which is a 32-bit addition operation. Float64Add goes through a similar process and gets converted into the vaddsd assembly instruction.


2. String + string

This is implemented in the same Generate_AddWithFeedback() function as in part 1.

GotoIf(IsStringInstanceType(lhs_instance_type), &lhs_is_string);
BIND(&lhs_is_string);
{
  TNode&lt;Uint16T> rhs_instance_type = LoadInstanceType(rhs_heap_object);
  GotoIfNot(IsStringInstanceType(rhs_instance_type), &call_with_any_feedback);
  var_result = CallBuiltin(Builtin::kStringAdd_CheckNone, context(), lhs, rhs);
  Goto(&end);
}

In the first line, if it is not a string type, it moves to the call_with_any_feedback label, right? That is because the builtin function called here works only when all parameters are strings. (We will look at this in item 3.)

Once it passes that branch, it calls the kStringAdd_CheckNone builtin function, which looks like it adds something. If we trace that function, it is declared and implemented like this.

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

There is no especially difficult logic here, so if we briefly look only at the AllocateConsString function that runs last, it allocates memory for the total length and writes left and right into offset memory in order. 
One thing I found a little interesting while looking at this was that when allocating memory, you can set young and old space as flags. The same thing that comes up often in GC. I figured V8 would take care of it, so I did not look too deeply into the GC side, but seeing it controlled at allocation time felt both familiar and interesting.


3. Addition between other types

Now, finally, I will look at addition operations that require casting. The starting point is the same Generate_AddWithFeedback() function.

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

The end of the branch that checks whether lhs and rhs are different types is the call_with_any_feedback label. From there it calls call_add_stub, and then calls the kAdd builtin function. This one was a bit hard to find.

The earlier StringAdd function was implemented nicely in builtins-string-gen.cc, but I could not find this one at all. Then I wondered if it might be implemented in Torque, and that is when it finally showed up.

Torque is a dedicated scripting language made by V8. It looks like TypeScript, so it is pretty easy to read. Anyway, those files are *.tq files, and since all kinds of built-in functions were implemented there, I looked a little more into related information and found discussion that future builtin function implementations would be oriented toward Torque. (And it seems like most of the porting is already done.)
https://v8.dev/docs/torque

Anyway, a Torque script looks like this.

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
   
After looking at abstracted objects all the time, seeing it cleanly written as a switch feels like a breath of fresh air. Since the other cases all cast to numbers and calculate, I will look at the StringAddConvertLeft function, which is the part that adds strings.

This one is an external function in the builtins-string.tq file. 

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

Since this is the last function, I just pasted the whole thing. Depending on the variable's type, it branches and uses the appropriate string conversion function for each type to return a string, and you can see that it returns that value added to right. But the Oddball type is the boolean type we use, you know?

'3' + true  // "3true"

But it is kind of interesting that to_string produces the strings true and false like that, right? So I looked that up too.

// setup-heap-internal.cc
Oddball::Initialize(isolate(), factory->true_value(), "true", handle(Smi::FromInt(1), isolate()), "boolean", Oddball::kTrue);
Oddball::Initialize(isolate(), factory->false_value(), "false", handle(Smi::zero(), isolate()), "boolean", Oddball::kFalse);

In the place where various heap objects are initialized when the initial instance starts up, there is a spot that maps the strings true and false to the Oddball type's 1 and 0 values. Boolean's toString function uses this mapping to return the value "true".


Conclusion)
1) If the types differ in number + number, they are converted to float64 and then calculated
2) String + string just works
3) A large amount of V8 builtin functions are implemented in Torque scripts
4) The string produced by boolean's toString is used via a mapping table created at initialization time


With so many examples and so much analysis, this turned into quite a long post. Maybe it would be a little easier to read on the web. But if I put too much effort into it, I feel like I would not even write up this kind of summary, so I will use that as my excuse.

Have a good night, everyone.


Previous post: https://frogred8.github.io/
#frogred8 #javascript #suck