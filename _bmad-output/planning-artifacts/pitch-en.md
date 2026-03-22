# Desert — Early Team Pitch

## Part 1: The Problem

There's a specific feeling every driver knows.

You pull into a station. You see the price. And before you've even turned off the engine, a thought flickers: *is this the cheapest one nearby, or am I about to overpay?*

You don't know. You can't know. You might have a vague memory of a price you saw last week, or a sign you passed three kilometres back. But you have no real information. So you shrug, and you pay.

Polish drivers fill up roughly **700 million times a year**. Every single time, they make a financial decision with no data. In a market where the price gap between the cheapest and most expensive station within a few kilometres routinely hits 30–40 groszy per litre.

On a 50-litre tank, that's 15–20 złoty. Per fill-up. Across a year of driving, that's real money — quietly disappearing because good information didn't exist at the right moment.

The data exists. Stations set prices. Prices change. The problem is that no one has assembled it into something that works **in real time, at scale, and in the place where the decision actually happens.**

---

## Part 2: The Insight

### Why crowdsourcing works here — and why it hasn't worked before

Desert builds its price database through crowdsourcing. Users photograph the price board while fuelling. The app does the rest.

Before you say "another reporting app" — there are a few things worth understanding about why this one is different.

**First: the timing.**

The user is photographing the board *while already fuelling*. They didn't go out of their way to report anything. They're already there — they've already paid, and they're standing next to the pump waiting for the tank to fill. They have 90 seconds and nothing to do. That is the moment. The contribution costs them nothing they weren't already spending.

**Second: the psychology.**

Crowdsourced apps usually die for one reason: the cost of contributing is too high, and the reward is too abstract. Desert flips this.

Cost of contribution: 10 seconds. One photo, one tap.

Reward: *immediate* and *personal*. Right after submitting, the user sees current prices at nearby stations. Were they cheap or expensive today? Now they know. This isn't some vague "you helped the community" message — it's a piece of information about *them*, *right now*.

Add **reciprocity** — the data they're seeing was put there by someone else who did the same thing. The natural impulse to give back is well-documented and doesn't need reinforcing.

Add **competition** — contribution leaderboards create a lightweight game layer. Not prize-driven. Just "I want to be top 10 in my neighbourhood." That's enough.

**The network effect here is asymmetric in our favour.** With 500 active contributors in Warsaw, we have a live price for nearly every station in the city. The barrier to replication grows exponentially every month we operate.

---

## Part 3: The Model

### Where the money comes from

Desert isn't a single-revenue-stream app. There are three, and each is independently scalable.

**Stream 1: Station Promotions**

A fuel station with the lowest price in its area wants you to know about it. Desert becomes the channel through which that information reaches the driver at the exact moment it matters — when they're deciding where to go.

Formats: promoted placement on the map, promotional banners, push alerts to users within radius. Not advertising — **precision marketing at the point of purchase decision.** Station chains have budgets. We know they spend them — today they spend them on roadside billboards.

**Stream 2: Data Licensing**

Collected, validated, historical fuel price data — at station level, updated in near real-time — is a valuable commodity. Buyers: commodity funds, analytics firms, fuel companies benchmarking regional pricing, insurers, strategic consultancies.

Data sold as anonymised aggregates — no personal data, full GDPR compliance. API model: monthly subscription or per-endpoint access.

**Stream 3: Fleet Subscriptions**

Companies running vehicle fleets spend tens or hundreds of thousands of złoty on fuel every month. Desert gives them something they don't currently have: **real-time visibility** — where their drivers are fuelling, what they're paying, how that compares to the market.

The fleet module is a B2B subscription. Purchase decision sits with a fleet manager or CFO. Short sales cycle, recurring revenue.

---

## Part 4: Why Now, Why Poland, Why This Team

### Why this makes sense here, and at this moment

**Poland is the right first market.**

Roughly 33 million registered vehicles. High infrastructure density — over 8,000 stations in a geographically compact country. Fuel prices are a genuine cultural touchpoint — a media topic, a political topic, a daily conversation. Polish drivers are more price-sensitive about fuel than almost any comparable market in Europe.

And yet: **the market is empty.** There's no local player with a current, validated price database. There are apps — incomplete, stale, built on manual reporting that works for two weeks and then collapses. Desert solves this with a mechanism, not an appeal to civic virtue.

**The technology window is open right now.**

OCR at a quality level that enables reliable price extraction from a casual photograph — this is new. Two years ago it would have cost multiples more and delivered worse results. Today, the cost of processing a single image is a fraction of a grosz. The proof of concept confirmed this: 80% accuracy on typical real-world photos, 100% on clear images.

**The PoC is done.**

This isn't a hypothesis. The architecture is designed, the technology is validated, the pipeline works. What's ahead is building the product — not running an experiment.

---

*Desert — know what you're paying. Before you pay it.*
