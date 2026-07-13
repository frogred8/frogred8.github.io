---
layout: page
title: "[etc] How playing duckov led me to contribute multilingual translations to the dnSpy tool"
date: 2025-11-02
---

<pre>

It was last week.
Duckov videos suddenly started showing up on my YouTube feed one or two at a time, and then more and more kept appearing.
The game I had been playing was starting to feel stale anyway, so while I was looking for something new, I saw it on Steam for the low price of 15,000 won and bought it without really knowing much about it.

They say it's an extraction game, but after trying it, it felt more like a roguelike with progression. More than anything else, I liked the farming-focused PvE concept where you don't fight other people. I'm at 44 hours of playtime now, and I still haven't even explored half of Farm Town, the third area. I am but a small creature...

The main goal of this game is collecting, and after playing for a bit, I started to feel the need to install user-made mods.
For example, in the original game, every item in your bag has the same background color, but there are mods that add background colors based on item rarity, and quite a few others that show item counts, sale prices, or what items you get from dismantling.
I had been happily playing with only those convenience mods installed, but since you can't see your weight unless you open your bag, inventory management became pretty annoying later on as I kept picking items up and putting them back down. I thought it would be nice if just the weight appeared as text right above the HP bar, so I looked for a mod, but I couldn't find anything I really liked.

Then a thought suddenly occurred to me. If a game that was released only two weeks ago already has over 700 mods, then making one probably doesn't require some incredibly advanced technique, so why not try making one myself?


- Exploration
Since I knew nothing at first, I took a peek at some mods in the mod list where people had made all of their code public on GitHub, and sure enough, they were really just made up of a solution, a project, and a single C# file. I figured Unity probably makes this kind of thing relatively easy.
As for using the functions the game uses, I guess the only option is to find them one by one through a DLL viewer. (There's no way the game company would provide that...)

So I installed dnSpy, a DLL viewer, and was able to open the TeamSoda.Duckov.Core.dll file. It contained a lot of the logic used in Duckov, and I've already found the current weight / max weight part, so now I just need to make a .NET DLL project and figure out where to hook it in. The logic looked like this.

float num2 = num / this.MaxWeight;
WeightStates weightStates = WeightStates.light;
if (num2 > 1f) {
	weightStates = WeightStates.overWeight;
}
else if (num2 > 0.75f) {
	weightStates = WeightStates.superHeavy;
}
...

It was roughly simple logic that calculates the weight percentage and changes the state to overWeight if it's 100% or higher, or superHeavy if it's 75%. Since it's made in C#, I figured I could refer to that and make a Unity behavior in a day or two.
But while using dnSpy, I thought it was a really well-made tool, and then I noticed there was no Korean language pack. I figured I would have struggled for days without this tool, so I went to the related repo thinking I'd make a small contribution, but dnSpy was a bit different.


- Contribution progress
I've made a few translation contributions to MDN pages before, but I eventually quit after a handful of them because if my PR landed with a lazy reviewer, it would sit there for weeks without a response, which was pretty annoying.
After that unpleasant experience, I had stopped contributing altogether, so it felt new that dnSpy doesn't manage multilingual strings through GitHub PRs, but instead uses an external web service for localization string management. With that setup, once you connect your GitHub account, contributing to the project becomes much easier.

Now that I think about it, big companies almost always have internal multilingual text editing tools, so it isn't exactly surprising, but I think it's impressive that a public service like this exists and is used to operate commercial services. Personally, I hope it becomes a bit more widely known.

Anyway, when I opened the Korean table for the dnSpy project, there were about 2,700 text codes, and the progress was around 30%, but most of what had been translated was only easy words like File, so in practice there was quite a lot of work to do. The error messages were written in so much detail...
One thing I felt while translating was that there are a lot of words I only vaguely understand. For example, property and attribute both get roughly translated as "속성" in Korean, but if you translate them both the same way, users won't know whether it's referring to a property or an attribute. So I thought about it for a long time and looked up a bunch of things, and apparently because of this exact issue, property is translated as "속성", while attribute is transliterated as "어트리뷰트".
I really felt that experts are different. After that, I wrote down tricky terms like that separately in Notepad, and when I finished everything and did a final pass, I made quite a few edits to keep the translations consistent.

I started touching it briefly on Friday, then worked on it all weekend, and in the end I translated all 2,700 entries and filled it to 100%. Nobody will probably notice, but it feels like I achieved something personally.


- What made translation difficult
With text translation inside a program like this, a lot of parts were really ambiguous because you don't know where the text is going to be used. For example, if you mechanically translate a sentence like "Missing the file path", it can become "There is no file path", "No file path", "The file path is missing", or "Could not find the file path", with several possible meanings and both noun-style and sentence-style phrasing.
If it's a menu title, it should be cut off as a noun phrase, and if it's a tooltip, it should be written as a sentence, but nobody knows where it will be used lol. So I translated non-English languages and used wording that felt almost similar to those (Japanese was especially helpful because its word order is similar to Korean!), and that made me realize why translated phrases inevitably end up sounding awkward sometimes.


- Conclusion
1) Now that the whole weekend is over, I do wonder what happened to my plan to spend the entire holiday playing Duckov...
2) Thinking about it, even if a Korean language pack is added to dnSpy, a DLL viewer, I wonder how many people in Korea would actually use it. (Would saying 1,000 be too many...)
3) Next week, I should just tinker together a mod for myself.


Previous post: https://frogred8.github.io/
#frogred8 #duckov #dnspy

</pre>

<br>
100% 완성한 모습<br>
<img src="https://i.imgur.com/VPEvoet.png">
<br>
crowdin에서 기여도는 이렇게 표시됨<br>
<img src="https://i.imgur.com/3bMyvBh.png">
