---
layout: page
title: "[etc] Advanced caching techniques used in practice"
date: 2023-02-05
---

<pre>
I’d always meant to write about caching someday, and recently my thoughts on it became a bit more organized, so I decided to put them down.
When you look at the cache design sections in books about software architecture, they tend to be overly abstract, so you often run into a lot of obstacles when trying to apply them in practice.
The many trade-offs that come up in real work don’t really show up there.
So here, I’ll briefly explain caching, then walk through an example and gradually refine it, looking at the problems that can arise along the way and how to address them.


- Definition and purpose of a cache
It’s hard to find wording better than the definition on AWS’s caching page. (https://aws.amazon.com/ko/caching/)
"The primary purpose of a cache is to increase data retrieval performance by reducing the need to access the underlying slower storage layer."
Slower storage usually refers to DB, file, or network access, and using redis or in-memory storage to hold data in order to reduce the cost of accessing that storage can be called caching.


- Example scenario
Suppose I’m developing a home shopping service, and the business team has set up a 40% discount event for the clothing category on December 25.
Let’s say the rule is that, among discount events, the highest discount rate is applied.

This event data looks like this and is stored in eventDB.
{
  id: "20221225001",
  type: "sale",
  category: "cloth",
  value: 0.4,
  startat: "2022-12-25T00:00:00",
  endat: "2022-12-25T23:59:59"
}

Now, every time a user views a product in the clothing category, you need to show them the estimated payment amount. Imagine that each time, you query eventDB to find the applicable events for the price calculation.
If there are 100 users connected, the load is probably manageable. But what if there are a thousand? Ten thousand? What if the page suddenly gets shared as a hot deal?
A huge number of requests will hit eventDB, and the probability of a problem will be high.
Below, I’ll keep adding harsh conditions like this and apply refinements.


- Refinement
1) Store in-memory at initialization time
At service startup, I prefetch the data and manage it in a singleton object like EventDataManager so it can be accessed from anywhere in the service.
getSalePrice is roughly a simple structure that gets item and events, filters them according to the conditions, and calculates the highest salePer.

init() {
  EventDataManager.init();
}
getSalePrice(long itemid) {
  let item = getItem(itemid);
  let salePer = 0;
  const events = EventDataManager.getEventsByTime(Date.Now());
  for (let ev of events) {
    if (ev.category === item.category && ev.type === "sale") {
      salePer = Math.max(salePer, ev.value);
    }
  }
  const retPrice = item.price * salePer;
  return retPrice;
}
EventDataManager::init() {
  this.events = eventDB.findAll();
}
EventDataManager::getEventsByTime(time) {
  return this.events.filter(ev => {
    return time >= ev.startat && time <= ev.endat;
  });
}

With this, load is generated only when the service first starts, and after that it should be fine. In general, this isn’t a bad approach.
But imagine the number of registered events grows and fetching them all at once becomes 5 MB.
If you start hundreds of services at the same time in this situation, it will be hard to avoid delayed DB responses.


2) Lazy loading
If you configure things so the load does not concentrate at service initialization time, load balancing will naturally happen.
There are a few ways to do this: delay for a random amount of time at startup before requesting the load, or load the data at the point it is first used.
The random delay method has the downside that initialization is not complete during that time, so service startup is delayed, but I think of that as a trade-off.

EventDataManager::init() {
  const randSec = Math.floor(Math.rand() * 30 + 1);
  setTimeout(() => {
    this.events = eventDB.findAll();
  }, randSec * 1000);
}

The method of loading at the point of use requires checking at call time, and this does leave a bit of a bad aftertaste. That’s because:
1. You have to check a branch every time even though it runs only once
2. The latency of the first API call can become excessively long
3. It feels uncomfortable that idempotency is not guaranteed in a function whose role is get

EventDataManager::getEventsByTime(time) {
  if (!this.events) {
    EventDataManager.init();
  }
  return this.events.filter(ev => {
    return time >= ev.startat && time <= ev.endat;
  });
}

Anyway, after choosing roughly between these options and reaching a point where this can handle 10,000 concurrent users, a requirement comes in from the business team.
'We want to change events in real time. Without maintenance.'


3) Propagating cache refresh events
Now it’s time to expand the structure.
When an API call that changes a discount event comes in, every service needs to be able to know at that point.
Polling is not used much, so here I’ll assume we receive it as an event.
For the event system, you would typically use mq, kafka, or redis(pubsub), but anything is fine.

The sender of the cache invalidation message will be the service that receives the event change API (usually an admin tool?), and when this service creates an event and sends it to mq, every service connected to mq receives the cache invalidation message.
At this point, you have to choose whether to receive only the changed parts or refresh everything. If the message is small, send only the diff; if the data is prone to consistency issues, receiving everything is safer.
However, each option’s strengths are also its weaknesses, so there is no single right answer. Choose based on the frequency and volume of the actual business data.

Even if things may change later, this is why the initial requirements need to be clear: they have a big impact on this kind of design. If you implement full refresh because you think changes will almost never happen, but in reality they change several times in a short period, the load will be enormous on every refresh, and keeping consistency will also become difficult.
Below is logic that receives only the changes and updates them, handling new/delete/edit cases.

changeEventData(id, eventData) {
  let changeType = '';
  for (let i = 0; i < this.events.length; i++) {
    if (this.events[i].id === id) {
      if (eventData) {
        changeType = 'edit';
        this.events[i] = eventData;
      } else {
        changeType = 'delete';
        this.events[i].splice(i, 1);
      }
      break;
    }
  }
  if (!changeType) {
    changeType = 'new';
    this.events.push(eventData);
  }
  console.log(`changedEventData: ${changeType}/${id}/${eventData}`);
}

But this alone is far from enough. That’s because shared caches across multiple services break concurrency more often than you might expect.
For example, another event update message may arrive while an event update is already in progress, or event order consistency may not be guaranteed, and so on.
It’s a problem if everyone has an incorrect cache, but it’s actually an even bigger problem if only some instances have an incorrect cache. Issues like that are hard to find and not easy to reproduce locally.
Next, let’s look at several scenarios that cause these kinds of concurrency problems and some ways to address them.


4) Maintaining concurrency for cache invalidation
When sending only diffs, the thing you need to pay the most attention to is event order consistency.
If update messages created in the order new, delete arrive but are processed in the order delete, new, you end up with an incorrect dataset.
There are many ways to solve this, but I’ll imagine just a few of them.

The basic idea is that when the event change API is received, the change message is written to a separate DB, and at that time a sequentially increasing unique id is received and delivered to each service.
Data will accumulate in the change message DB like this.

{no:14, eventData:~~}, {no:15, eventData:~~}...

When an individual service receives a notification message containing no, it fetches the changed items from that DB and applies them.

Then what do you do if the order gets reversed? Keep the last no value that was previously applied, and fetch the values in between.
If the last no updated by the service is 13 and the next no that arrives is 15, fetch and apply 14 and 15.
Later, even if message no 14 arrives and requests an update, this service has already applied up to 15, so it can simply ignore it.
At initial service initialization time, the service must have the latest no. That’s how it knows from which point in the data it should start applying changes.

But maintaining diffs by writing to a DB separately for data order consistency that almost never occurs is a bit bothersome. 
Is there no way to do something similar by receiving messages, without recording the changed data somewhere else as in the beginning?

To do that, first store one shared sequentially increasing no somewhere (redis is an easy choice?), and if the change message no received by a service is not sequential compared with the previous one, use a somewhat lazy method of refreshing the entire cache.
This method is easy to control because it receives messages containing the changed data, and it can resolve event order consistency problems that are expected to occur very rarely.
ex) If the last no stored in the service is 13 and the next incoming message is 15, perform a full refresh; if the no increased by +1 (14 here), update only the changed data

{no:15, id:event.id, eventData:~~}


So far, we’ve only thought about the invalidation point. Now let’s look at the refresh point as well.

This time, assume that when invalidation is received, the entire cache is refreshed.
If you refresh immediately upon receiving the invalidation message, instances of the same service may have different caches, right?
If 9 out of 10 instances have completed the refresh but the remaining 1 has not refreshed yet, from the user’s perspective, 9 requests will receive the changed value and 1 request will receive the old value.
Of course, under normal circumstances this inconsistent state should not last long, but what if cache refresh takes more than a minute?


5) Maintaining concurrency for cache refresh
To solve this, the requirements given so far are not enough, and you need to discuss it with the department that created the requirement.
To make the refresh point identical everywhere, you need to notify and agree that event changes are not applied immediately, but are applied about 5 minutes later. After all, during operation, that team is the user.
Once this agreement (=notification) is done, you can design the details.

To make the change point identical, the easiest method is to use time as the reference, assuming that each server’s clock is the same.
Imagine a system where, when a message about a change is received, every instance guarantees the refresh 5 minutes after the change.

{type: 'event_refresh', changed: '2023-02-02T12:37:23'}

If every instance receives this message, they will know that the refresh should happen at 42 minutes and 23 seconds.
Then should they all fetch it simultaneously after 5 minutes? That makes the same problem likely to happen again.
Here, when the invalidation message arrives, we’ll fetch the data in advance and store it, then switch only the pointer. (Like double buffering.)
I also added a random time when fetching so the requests do not temporarily concentrate.

let new_events;
refreshCache(changed) {
  // get new events within 30 sec
  const randSec = Math.floor(Math.rand() * 30 + 1);
  setTimeout(() => {
    new_events = eventDB.findAll();
  }, randSec * 1000);

  // change event to new
  const five_min = 5 * 60 * 1000;
  const refreshTime = changed.getTime() + five_min;
  const waitTime = refreshTime - Date.now();
  setTimeout(() => {
    this.events = new_events;
  }, waitTime);
}

In this example, I added requirements and wrote simple pseudocode, but a real service can be far more complex than this.
No matter how carefully you design it, cache consistency can break in an instant, and it is not easy to detect.
So, separately from cache invalidation, some systems check every 5 minutes whether the cache is up to date. Since fetching the entire dataset every time is difficult, they also build secondary and tertiary safeguards, such as checking with a hash value.


Conclusion)
1) A cache is used to reduce the cost of accessing slow storage and to improve data retrieval performance
2) Efficient cache design is possible only when you clearly understand the requirements of the feature being implemented and discuss them accordingly
3) You need to know exactly when cache invalidation and refresh happen
4) Design a cache system that fits the characteristics of the service so it does not become overengineered


It’s hard to reply to every comment, but thank you as always for your valuable thoughts.
The new year has long since passed, but I hope this is a year where everyone achieves what they wish for.

#frogred8 #cache #architecture
</pre>
