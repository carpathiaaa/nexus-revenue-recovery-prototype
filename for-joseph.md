# Revenue Recovery Agent, the business case

**For: Joseph**

**One line:** software that finds the deals slipping out of the pipeline and wins
them back on its own. It sends the emails, runs the follow-ups, places the calls,
and closes each one, so a rep never has to remember to.

It runs live on Render today. This doc covers what it does for the business, how
it differs from a Claude skill or an n8n flow, and where it fits Nexus.

## The problem it solves

Companies lose money on deals they already half-won:

- Carts abandoned at checkout
- Quotes opened but never signed
- Trials about to expire
- Subscriptions that failed a payment
- Customers who used to buy and went quiet
- RFQs viewed five times with no reply

These people already showed intent. The money sits one nudge away. It leaks for a
boring reason: no rep has time to chase every one, on time, every time, forever.

The agent does that chasing. It runs around the clock and never forgets a deal.

## What it does

1. **Spots the leak.** It reads each at-risk deal and labels the problem, an
   abandoned cart, a stalled quote, a churn risk, a dormant account, and rates how
   urgent it is.
2. **Picks the move.** It chooses the recovery play and the channel, an email or a
   phone call.
3. **Does the work.** It writes the message in a warm, human voice and sends it.
   For voice plays it runs a recovery call.
4. **Follows up.** When nobody responds, it sends the next follow-up, then the one
   after, each a little more urgent. After a set number of tries with no result, it
   marks the deal lost and moves on. This part saves the most time.
5. **Reports the money.** It decides what happened, recovered, still warm, or lost,
   and the dashboard shows recovered revenue, conversion rate, and every action it
   took.

A person steps in only for the risky moves. Anything touching discounts, pricing,
contracts, legal, or warranty terms waits in an approval queue. You clear the queue
with one click. The agent runs everything else without you.

It also runs itself. Turn on the scheduler and it works the list on a cadence,
server-side, with no browser open, even pulling in new leaks as they arrive.

## The rule that protects the brand

When a customer says something painful in a conversation, a death, an illness, a
job loss, real hardship, the agent stops selling at once. It responds with human
compassion and backs off. It will not return to the product. This rule outranks
every sales instruction and stays hard-wired into the live agent, the voice calls,
and the offline fallback. It separates an automation you can put in front of
customers from one that embarrasses you.

## How it differs from a Claude skill or an n8n flow

You will ask this, so here it is straight.

### Against a Claude skill or chatbot

A chatbot answers when you talk to it. It has no list of deals, no memory of who it
already contacted, no sense that this one has been chased three times and should
close. The agent works the other way around:

- It owns a pipeline, not a conversation. It tracks every open deal, its value, its
  status, and how many times it reached out.
- It acts first. It sends, calls, follows up, and closes without a prompt.
- It keeps state in SQLite. The follow-up cadence and the "give up after four
  touches" logic depend on that memory. A stateless skill cannot hold it.

A Claude skill gives you a sharp brain. The agent adds the memory, the work list,
the hands for email and voice, and the judgment about when to quit.

### Against n8n or Zapier

A workflow builder handles "when X happens, do Y." Recovery work breaks that
straight line, because each step needs a decision:

- Email or call?
- Risky enough to need a human?
- Did that touch land, recovered, warm, or dead?
- Time for follow-up two, or time to give up?

In n8n you wire every branch, every condition, every template by hand, then rewire
them when the situation changes. The agent makes those calls from the details of
each deal and writes every message fresh for that customer and product. n8n
automates the steps you define. The agent defines the steps.

One practical gap remains. The agent ships as a finished product with a leakage
dashboard, a live call viewer, an outcomes report, and an approval queue. n8n hands
you a flow diagram, not something you give to a sales lead.

### The summary

| Capability | Chatbot / skill | n8n / Zapier | This agent |
|---|---|---|---|
| Starts work on its own | No | On a trigger | Sweeps the whole list |
| Remembers who it chased | No | You build it | Built in |
| Decides email vs. call | No | You hard-code it | Decides per deal |
| Writes custom copy per customer | If asked | No | Every touch |
| Knows when to stop | No | You hard-code it | Closes lost on its own |
| Holds risky moves for a human | No | You build it | Built in |
| Ships with a usable UI | No | No | Yes |

It does not bolt an AI step onto a workflow. It runs the whole play.

## Where it fits Nexus

Nexus runs a portfolio across consumer, education, services, and B2B. They share
one leak: earned revenue walks out because follow-up does not scale with headcount.
The agent targets that leak across the spread. The demo set already runs a $1,200
mattress cart, a $45,000 school district license, and a $95,000 aerospace renewal
through the same agent.

Where it pays off:

- **One recovery layer for the whole portfolio.** The same agent works a $180
  subscription save and a $250,000 RFQ. On the high-value B2B deals, one recovered
  account covers the cost of the whole thing many times over.
- **More reach from the team you have.** It does not replace reps. It clears the
  long tail of follow-ups they never reach and routes the pricing and contract
  calls back to a human. Reps spend their hours where they move the deal.
- **A working product.** It runs on Render now, works with paid AI, and sends real email when you flip one switch. You can show it
  to a portfolio company this week.
- **Automation that respects the customer.** The empathy rule and the approval gate
  let you point it at real customers without fear it commits to a discount or
  talks over someone in a hard moment.

## How to see it

Open the Render URL and:

1. Watch the Leakage dashboard fill with at-risk deals.
2. Hit **Run Autopilot** and watch it send, call, and queue the risky ones.
3. Turn on the scheduler and walk away. It keeps working and pulling in new leaks.
4. Open Voice Agent to watch a recovery call play out live.
5. Check Outcomes for recovered dollars and the audit trail.

You need no setup to demo it. To send real email, flip one config switch and add a
Gmail app password.

---

*Built as a Nexus portfolio prototype. Technical details in
[`README.md`](./README.md).*
