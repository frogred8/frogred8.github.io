---
layout: page
title: "[etc] How i ended up developing a mod while playing duckov"
date: 2025-11-08
---

<pre>

This is related to the previous post.
https://frogred8.github.io/docs/039_story_for_contribution

In the game Duckov, your movement slows down when your inventory weight ratio goes over 75%, but since that is not shown in the UI, whenever my inventory filled up I would keep putting items in and taking them out while sorting them, trying to stay right on that threshold.
That was pretty inconvenient, so I thought it would be nice to have a UI that shows it. I searched around but could not find any particular mod for it, so I decided to make one myself.


- Day 1
First, I skimmed through the DLLs in Duckov to see what classes and functions they had. While looking through them, I roughly bookmarked things by keyword, and that helped a lot later. After that, I opened other mods in a DLL decompiler to see how they were developed, and also looked for information on GitHub.

- Day 2
The goal was to set up a mod project, hook it up, and display anything at all on the game screen, but I think I spent about 70% of the time just configuring the C# DLL build environment. As expected, the initial setup is the hardest. Ugh..
But since this is a DLL for a process launched through Steam, even when I attached the process in Visual Studio, breakpoints would not get hit. So I had to develop based on logs, but the logs were not written to the DLL's current folder and instead ended up somewhere completely different. I am not sure if Unity projects are always like that, but in any case I found the path and developed while watching the real-time logs with SnakeTail.
C:\Users\[YourUsername]\AppData\LocalLow\TeamSoda\Duckov\Player.log
After getting through that ordeal and past the project setup, making the thing itself was not especially difficult. Though building an entirely new UI controller would probably be a different area altogether..
That day, I was satisfied with having more than met the goal: I created a rough text box in the middle of the screen and even hooked it up to the current weight value.

- Day 3
Once I positioned the text box at specific coordinates under the HP bar, it looked pretty convincing, but later I changed the resolution and fell into despair. Ugh..
Since the configured coordinates needed to change depending on the resolution, I spent quite a while wondering whether I should just use it as an FHD-only tool, then pulled myself together and decided to make it properly.
When creating the text box, I found the HP bar object, set it as the parent, and changed the positioning to relative coordinates. After that, it appeared properly in sync with the other controls, and even changing the resolution caused no issues, so I was satisfied.
Because I linked it to the HP bar this way, it turns off together when the HP bar turns off, so I still had the task of creating it separately in LootView(the looting screen).
It was only a one- or two-line task, but since mod development is done without the full code, tracking it down with logs alone was not easy. I must have restarted the game about 100 times.
Still, time is on my side.

- Day 4
I figured out the main reason for the weird behavior that had been happening since yesterday.
In LootView(the looting screen), I found a WeightHUD instance that I assumed would be where the weight is displayed and placed my text box under it, but the position of that text box would change randomly. It seemed to work fine a few times, but then it would sometimes move somewhere else(probably outside the screen) and disappear, so I had a hard time even knowing whether it had been created at all.
After suffering through that for quite a while, I found out that the WeightHUD object was not unique. Two separate UIs each created and used one, so the object I retrieved was different each time depending on the creation order. The existing logic was only taking the first object, but once I realized this, I searched the full list of objects of that type and connected to the exact one under the inventory window. Only then did the text box finally appear properly in a fixed position.

At the point when the OnActiveViewChanged event is called as the View changes, the parent UI objects I need to attach to have not been created yet. So I had to handle small things like adjusting the creation timing of my object, updating the UI only when the value changes, and doing my own QA to check whether there were any other bugs during scene transitions. Only after that was I finally able to publish the completed mod on Steam.
https://steamcommunity.com/sharedfiles/filedetails/?id=3601687155


- Reflections
I tried this because I wanted to make the game a bit more convenient, and somehow I managed to finish it.
Whenever I ran into obstacles while developing the mod, searching the internet mostly turned up only mod installation guides, so I wanted to write up at least a simple post about mod development.
Seeing the number of subscribers grow after uploading it to the Steam Workshop makes me feel pretty pleased.
I have published the mod on GitHub, so anyone with some time to spare can take a look.
https://github.com/frogred8/duckov_weightviewer


Previous post: https://frogred8.github.io/
#frogred8 #duckov #mod

</pre>
<br><br>
steam workshop(창작마당)<br>
<img src="https://i.imgur.com/vcAdafU.png">

<br>
계속 올라가는 구독자<br>
<img src="https://i.imgur.com/dgl7zGh.png">

<br>
실제 개발환경<br>
<img src="https://i.imgur.com/xUTMUoY.png">
