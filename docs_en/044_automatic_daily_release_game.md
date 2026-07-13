---
layout: page
title: "[etc] Building a web game that’s automatically developed and deployed daily based on user feedback"
date: 2026-05-28
---

<pre>
Until last year, I only used AI occasionally through web chat interfaces, but I was impressed by how much most AI tools improved early this year, so I wanted to develop a personal project mainly through vibe coding.
But instead of making something with a high level of polish, I wanted to try an experimental game using technologies I had not used much before. After making a bunch of idea-level prototypes, I decided to build a small mini game where user feedback gets reflected in daily releases.
This post is a record I wrote as thoughts came to mind while working on everything from the first draft of the project to its design, development, prompt guide writing, and the setup of an automatic update service.
You can access it on mobile too, so keep that in mind. (But since there is no keyboard or mouse hover, it may be a little inconvenient.)
game: https://spiralwave.frogred8.dev
github: https://github.com/frogred8/SpiralWave


- Project overview
After thinking about it for a few days at first, I set the development direction around the concept of a "resource-gathering game." I do not really like games where you compete with others or lose something by dying.

First, I wrote the game and mechanics I was imagining on paper, uploaded it to Gemini on the web, and asked it to organize the content of the drawing into a prompt I could use to request development from the CLI. (See Figure 1.)
I was using gemini-cli for the first time, so I did not know much about it, but when I simply pasted in the dozens of lines of prompt it had organized there, it made the game nicely on its own with typescript, vite, and phaser.
Just like that, a simple-concept game that appears on a web page was done from design to implementation in 30 minutes.

At first, I developed it around a concept where the game starts in black and white and gradually becomes more colorful as you collect colors, but once I actually made it, it was fun to play once and then quickly became boring.
So I decided that users would gather resources, build their own skill trees, and the person who gathers more resources would win, while the requests from the person who earned the highest score would be automatically applied to the next day's update.

Web development is not my specialty either (I do not know CSS), and my knowledge level is just enough to make admin tools, so I had Gemini build most of the features and only adjusted coordinates here and there myself.
I will introduce a few tasks that stood out to me during development.


- Skill tree development
After the playable game foundation was made, the next thing I built was the skill tree. I will show one of the initial prompts from that time.
"Make a skill tree in a form similar to Diablo 2. The skill tree should consist of 3*5 items, and learning a skill should require spending resources and learning prerequisite skills first."
With just this one prompt, it implemented a skill tree setup with both UI and functionality quite well.
I also added, through a prompt, a system for pre-reserving the next skill once a prerequisite skill had been learned, but it did not handle reserving child skills under a reserved prerequisite skill very well.
In particular, when canceling a reserved skill, if you cancel a middle skill rather than the lowest-level skill, all the skills under it also need to be canceled. Even after asking several times, it either did not work as expected or the complexity became unnecessarily high, so I implemented complicated parts like that myself.
This may have been because the Gemini quality I was using at the time was lower than Claude or Codex, but having to think through and write out every constraint in the requirements was more annoying than I expected, so if it does not do well after one try, I tend to just do it myself.

For reference, I intentionally did not set up test code because 1. frequent large-scale design changes were fully expected, 2. it was an environment where AI could easily create test code that only raised coverage pointlessly, and 3. fast development speed was more important than investing maintenance cost and time into test code that would break anyway. So I proceeded without test code. (+ working alone)


- Large-scale refactoring to separate UI code from logic
As I kept adding only features to a single file, it eventually went over a thousand lines, so I proceeded with a refactor.
It was a simple two-line request asking it to separate UI code and initial values into separate files, but it turned into a fairly long task that took about 20 minutes.
To be honest, I was not especially happy with the result, but once I started touching it, I would have had to fix too much, so I just moved on thinking, "This is what vibe coding is." Looking back now, though, if a coworker had put up code like that for review, I probably would have left quite a lot of comments. (Consistency of variable and file names, separation of function responsibilities, and so on.)
Because I thought of it as something AI had done, giving detailed feedback felt tiring too, and since there was none of the social fun of exchanging feedback, I think it felt even more bothersome.

After that, when doing large tasks like this, I first asked it to make a design plan, then refined the prompt based on that plan and passed it to the agent.
But if I did not like the result, it seemed better not to request additional modifications there, but to delete those changes, strengthen the prompt, and make it redo the work. (It is a waste of tokens, though..)

After the refactoring was done, the build worked fine, but a null object reference error occurred in a specific situation.
I told the AI the reproduction scenario and left it to fix the issue, but it only added a bunch of guard code to related functions associated with the error, and of course the problem was not solved.
I rolled back the previous changes and slowly followed the flow, and the issue turned out to be that, after separation into the UI manager, the order of updating the UI after a state change had been reversed.
Changing the order of those two lines cleanly solved every problem.

While solving this issue, it felt strange because the AI's mistake was relatively human.
People sometimes have the experience where everything suddenly goes weird just from changing a small execution order, right? It is a mistake anyone can make when modifying code without fully understanding the role of a function, and I thought AI does not seem to escape that trap easily either.


- Automatic git commits
This was when I first tried applying a prompt guide file (GEMINI.md). It was starting to get annoying that it did not understand things every time I launched it anew.
When I asked it to analyze the current project and output the technologies being used, the game concept, and how each module works in prompt format, it made one right away.
But reviewing the work I had instructed through prompts line by line did not feel very meaningful (most of it was click-and-done), so I configured it to commit immediately after code work was finished. Only then did it finally feel somewhat automated.
In the final commit message, I added the time the agent spent working, the prompt I had given, and a summary of the actual work, and had it structure the message like this.

fix: [45s] Sync satellite orbit with boosted black hole radius (CODEX)
(When the black hole range increases due to a special item, change the satellite so it also moves according to that size.)
- Modified OrbitSystem so it queries the currently effective black hole radius every frame and calculates the satellite orbit distance.
- During the radius boost start and shrink tween, the satellite position is immediately synchronized with boundary changes.

No matter how clearly I wrote the prompt for getting the agent's working time, the agent kept caching and using the time when it was first launched, so I just configured it to write the time to a temporary file with shell at the start of each task.
But if the agent ran for too long, once in a while it would either fail to record the time or fail to commit, so I tend to start it fresh for every task.
This happened often with Gemini, and after moving to Codex the frequency dropped significantly, but it still does not seem to be 100%.


- Thoughts on automatic update design
When I first designed the game, I configured it so that a version incorporating user feedback would be developed directly on the main branch every two hours and automatically deployed.
But while doing vibe coding, runtime issues came out far too often no matter how clearly I delivered the prompt (subjectively, about one in four times there was a runtime bug), so I could not secure build stability. Whether it was UI coordinates or an issue with the flow itself..
It might be possible to reduce issues as much as possible by verifying this with multiple harnesses, but 1. I did not have enough tokens to configure all of that, 2. it was hard to predict the cost of handling the load if it created a server-heavy feature, and 3. I wanted a service that would run stably even if I did not pay attention to it for a while, so I gave up cleanly.
That said, I did not give up on the idea entirely. I changed the design direction to a smaller version where one test build incorporating user feedback is automatically released each day.
I plan to try the test builds myself, and if there is a good version, merge that reliably into the main build.


- cron project setup
For daily automated updates, I used node:cron, though honestly shell would probably have been fine too since it only needed to run periodically.
I set up a simple workflow like the one below and completed it step by step.

1. Collect feedback from leaderboard data
2. Refine the feedback list into a prompt
3. Generate code from the prompt
4. Build and generate release notes
5. Deploy to the server

Looking at each item individually, there is nothing technically difficult, but when I actually implemented it, various additions came in and those tasks grew to about 12 steps. In particular, the part where I kept four ports open on the Oracle server and reused them in a ring each time there was an automatic update was a bit tricky. If I had split the service into multiple services and run them separately, it probably would have become much more complicated. (Currently it is a monolithic structure.)
Besides that, there were things like creating a separate git branch for builds, translating the generated release notes into multiple languages, saving and caching them, and so on..
While doing this, I also optimized work that happens on every user visit, and I really enjoy thinking through and implementing these kinds of parts.

For example, previously, whenever the server list changed, it had to be delivered to every currently running instance (five at the moment), and each one had to be restarted for the update to apply.
I changed this by connecting the server list file inside the docker instances running on the server to a shared volume so that all of them look at the same file, and then making them read that server list file. When a new version is added to the server list, updating that one server list file lets every instance share the same content.
But if you do that, every time you update the server list, you either have to restart the server or read the file again on every user request, right?
Restarting the server is annoying, and since this is a web game, the first screen probably gets the most requests, so I did not want to read the file anew every time. I changed it to store the data in a cache that expires every five minutes and controlled it that way.

When I actually tried turning user requests into prompts, users would submit requests in various languages (Chinese, Japanese, and so on), so when creating the prompt, I told it that this was a multilingual request list and asked it to refine the prompt in English. At that point, I also told it to exclude overly large features or features expected to have security issues, and it does seem to filter them well, but just in case, I set up the execution environment for this cron on a separate local computer. (In case rm -rf / ever gets through..)
Anyway, I use this refined prompt to create release notes, translate them from the English version into multiple languages, and configured things so the release notes appear in the language selected from the server list.
When I tried changing the language in real time, it worked correctly right away, which felt satisfying.


- Changing from Gemini to Codex
For the first two months, I felt Gemini was enough and just kept using it, but with Gemini it was not easy to maintain code stability enough to deploy the generated code as-is, and above all, it took so long that I could not predict working time.
Later, after several experiences of waiting an hour only for it to time out and shut off, I ended up moving to Codex.
The biggest things I felt after switching were speed and the way it communicates. Gemini did not really tell me what it was doing, and only gave pointless English jokes, which was frustrating. But Codex keeps giving updates as it works, like "I am looking at these things to set up that feature," so that was nice.
It is like the difference between assigning work to two junior developers, where one gives no intermediate updates until the task is done, while the other shares progress every morning. The work speed is much faster too, but because of this communication, it was easier to understand the work context.


- Other features dropped during development
+ A feature where users can press "like" on leaderboard messages
If it was a good suggestion, I wanted it to have influence even if it did not make the top 10.
But rankings are based on score, so it was ambiguous whether it made sense to sort again by the number of likes, and to prevent duplicate likes I would need some kind of identifier, but since I was not going to make accounts, that would also take quite a bit of work.
Especially because users would write messages in various languages, multilingual translation would also be needed so people could recognize what they were liking on the leaderboard. At that point, I did not want to call AI every time a message was saved, so after building about half of this feature, I decided it would be better not to do it and deleted it.

+ Skill tool development
Originally, I wanted to make a high-quality skill tree like Diablo rather than random skill placement.
So I passed the skill data JSON to AI and requested a tool, and it worked much better than expected, so I was satisfied using it, but thinking up dozens of skills was not easy. (Limits of imagination.)
Also, when I first tried it with the skill tree fixed, repeating the game became increasingly boring, but when skills were placed randomly at the start, that part became much better.
In the end, for simple data changes it was faster to edit the JSON directly, so I did not develop it further and left it as-is.

+ Docker distribution by service
This is a part I accepted for ease of management.
The current final structure is that when one docker image is created and run, it includes client+server+db.
If I had separated docker by service, every time a new version came out each day, there would be the management complexity of running multiple docker containers.
I have done plenty of this kind of thing in real work, and there was no need to over-engineer it here too, so I simplified it as much as possible.

+ Sending an email notification when a build reflecting someone's feedback is released
Since this is a lightweight web game concept, I expected the revisit rate to be low, so I wanted to let people know to come check it out if their feedback was reflected.
When I tried leaving an identifier on the leaderboard as an email instead of a name, emails entered without signup were not highly valid, and if someone used someone else's email and messages went out to other people, that would also be a nuisance, so it was hard to build this casually.
It did not seem like the effect would be large either, so I only tried it briefly locally and then deleted it.

+ Adding ads on the side
Even if there was not a lot of traffic, I looked into this a bit because it would be nice to at least cover server+domain costs, but gave up.
Google AdSense takes so long that people call it an "ad exam," and especially there were many reviews saying it is frustrating because they do not tell you the reason for rejection. Other ad platforms mostly had low-quality ads or rewarded video formats, so I did not want to add them. And domestic platforms pay so little that it did not feel worth it..
So I just added one Buy me a coffee link on the leaderboard screen and called it done.
I am going to think of this project as a toy using AI plus good writing material. I had fun making it, and that is enough.


- Reflections on a click-and-done project
Developing using only AI did have a kind of fun that is different from pure coding. Productivity goes up by about 10x, but the time required to test the generated features does not decrease, so as I kept doing only testing to the point where I could not tell whether I was a developer or QA, development gradually became less fun. (That is why this project was also finally completed after being abandoned for a month.. If I had left it a little longer, it might have remained unfinished.)
Also, the code developed by AI is decent in quality at the function level, but the overall code flow is hard to read. I aim for code that is easy to read, so even inside functions I tend to group code by meaning and pay attention to the order of function definitions, but this thing defines and uses things anywhere, so instead of reading downward like a novel, it feels like I have to roam all over the place looking for things.
Also, localized hard coding can sometimes keep the structure cleaner, but AI tries to generalize even that, so it tends to introduce unnecessarily large patterns often. I wonder if it would make features a bit better if the prompt also specified whether to add extensibility..


- Conclusion
1) We have reached an era where you can make an HTML web game without even knowing CSS.
2) While working on an AI project, the abilities I lacked most were planning + imagination (+ repetitive testing).
3) Harnesses (guides) can be configured flexibly according to the current scale and situation, only to the extent needed.
4) Switching from Gemini to Codex felt like seeing the light. Expensive things really are better.


Previous post: https://blog.frogred8.dev
#frogred8 #game #vibe_coding

</pre>
<br><br>
초기 설계 문서 (그림1)<br>
<img src="https://i.imgur.com/bpq6yYp.jpeg">

<br><br>
게임 시작 화면<br>
<img src="https://i.imgur.com/LGsSiLi.png">

<br><br>
플레이 화면<br>
<img src="https://i.imgur.com/ICAyKOO.png">

