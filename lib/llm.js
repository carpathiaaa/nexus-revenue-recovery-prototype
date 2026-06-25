require("dotenv").config();

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OLLAMA_URL = "http://localhost:11434/api/chat";

function safeJsonParse(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

// Pull structured fields back out of the JSON payload we sent as `user`, so the
// offline fallback can actually react to the live conversation instead of
// returning one canned line every turn.
function parseContext(user) {
  try {
    return JSON.parse(user);
  } catch {
    return {};
  }
}

function firstName(ctx) {
  const full = ctx?.opportunity?.customer_name || "";
  return full.split(" ")[0] || "there";
}

// Conversational fallback for the live voice/chat agent when no LLM is wired
// up. It reads the customer's last line and replies like a real recovery rep:
// acknowledge, address the concern, move toward the next step.
function conversationalReply({ user }) {
  const ctx = parseContext(user);
  const name = firstName(ctx);
  const product = ctx?.opportunity?.product || "your order";
  const company = ctx?.opportunity?.company || "our team";
  const said = String(ctx?.customerText || "").toLowerCase();
  const turn = (ctx?.history || []).filter((t) => t.role === "customer").length;

  // EMPATHY OVERRIDE — if the customer shares something painful, stop selling.
  if (
    /\b(died|die|passed away|passing|funeral|grief|grieving|cancer|terminal|hospice|hospital|sick|illness|ill|lost my (job|wife|husband|mom|mother|dad|father|son|daughter|partner|child)|my (wife|husband|mom|mother|dad|father|son|daughter|partner|child) (died|passed)|divorce|laid off|broke down|can't afford anything)\b/.test(
      said
    )
  ) {
    return `I'm so sorry, ${name} — truly. That's awful, and the last thing that matters right now is anything about ${product}. Please don't give this another thought; I'll step back, and we can pick it up another time only if and when you ever want to. Take care of yourself.`;
  }

  // Opening / silence — greet and set the reason for the call.
  if (!said.trim()) {
    return `Hi ${name}, this is ${company} reaching out about ${product}. I noticed it was left unfinished and wanted to see if I can help you wrap it up — do you have a quick moment?`;
  }

  // Not interested / pushback.
  if (/(not interested|no thanks|stop calling|leave me alone|don't want)/.test(said)) {
    return `Totally understand, ${name} — I won't keep you. If it helps, I can email you a quick summary of ${product} so it's there whenever you're ready. Want me to send that?`;
  }
  if (/(busy|bad time|call later|in a meeting|driving)/.test(said)) {
    return `No problem at all — I'll keep this to one line. Can I email you the details on ${product} and a link to pick it back up on your own time?`;
  }

  // Price / discount concerns.
  if (/(too expensive|price|cost|pricing|cheaper|discount|afford)/.test(said)) {
    return `I hear you on price, ${name}. I can't change the number on this call, but I can email you the full breakdown for ${product} and check what options we have — would that help?`;
  }

  // Shipping / delivery / timing.
  if (/(ship|shipping|deliver|delivery|how long|when will|arrive)/.test(said)) {
    return `Good question — I want to give you the exact timeline rather than guess. I'll email you the confirmed shipping details for ${product} right after this. Does that work?`;
  }

  // Returns / guarantee / risk.
  if (/(return|refund|guarantee|warranty|cancel anytime|risk|trial)/.test(said)) {
    return `That's a fair thing to check before committing. I'd rather send you the written policy than paraphrase it — can I email you the return and guarantee details for ${product}?`;
  }

  // Cancellation / churn.
  if (/(cancel|unsubscribe|close my account|quit)/.test(said)) {
    return `Before you go, ${name} — is there something specific that wasn't working? If it's fixable I'd love the chance, and if not I'll make canceling painless.`;
  }

  // Positive intent / ready to move.
  if (/(yes|sure|interested|sounds good|okay|ok|let's do it|go ahead|send it)/.test(said)) {
    return `Great — I'll get that moving for you right now. I'll send a confirmation email for ${product} so you have everything in writing. Anything else you'd want me to include?`;
  }

  // Confusion / questions.
  if (/(what|how|why|explain|tell me more|details|info)/.test(said)) {
    return `Happy to walk you through it. The short version: I'm here to help you finish up ${product} with no pressure. Want me to email you the specifics so you can review them yourself?`;
  }

  // Generic acknowledgement that still advances the conversation.
  if (turn >= 3) {
    return `Thanks for talking it through, ${name}. I'll follow up with an email recapping ${product} and the next step so nothing slips. Sound good?`;
  }
  return `Got it, ${name} — thanks for sharing that. So I point you the right way, what's the main thing holding you back on ${product}?`;
}

function inferFallback({ system = "", user = "", json = false }) {
  const input = `${system}\n${user}`.toLowerCase();

  if (!json) {
    if (input.includes("you are the customer")) {
      const ctx = (() => {
        try {
          return JSON.parse(user);
        } catch {
          return {};
        }
      })();
      const turns = (ctx.history || []).filter((t) => t.role === "customer").length;
      const lines = [
        "Oh, hi — yeah, I did look at that but I wasn't sure about the price.",
        "I've just been busy, honestly. What would the next step even be?",
        "Okay, that's helpful. How quickly could I actually get it?",
        "Alright, that makes sense. Maybe I'll give it another look."
      ];
      return lines[Math.min(turns, lines.length - 1)];
    }
    return conversationalReply({ user });
  }

  if (input.includes("draft warm")) {
    // The drafting payload embeds the opportunity JSON; pull names out so the
    // offline draft reads like it was written for this customer.
    const name = (user.match(/"customer_name":\s*"([^"]+)"/) || [])[1] || "there";
    const product = (user.match(/"product":\s*"([^"]+)"/) || [])[1] || "your recent request";
    const company = (user.match(/"company":\s*"([^"]+)"/) || [])[1] || "Nexus";
    const firstName = name.split(" ")[0];

    if (input.includes('"channel": "voice"') || input.includes("channel: voice")) {
      return {
        opening_line: `Hi ${firstName}, this is ${company} calling about ${product}. I saw it was left unfinished and wanted to help you wrap it up — is now an okay time?`
      };
    }
    return {
      subject: `Quick question about your ${product}`,
      body: `Hi ${firstName},\n\nI noticed your ${product} with ${company} was left unfinished, and I wanted to personally check in. If anything was unclear — pricing, timing, or the details — just reply here and I'll sort it out for you.\n\nWould you like me to send over what you need to pick this back up?\n\nBest,\nThe ${company} team`
    };
  }

  if (input.includes("deciding what realistically happened")) {
    const touch = Number((user.match(/"touch":\s*(\d+)/) || [])[1] || 1);
    const max = Number((user.match(/"max_touches":\s*(\d+)/) || [])[1] || 4);
    const value = Number((user.match(/"value":\s*(\d+)/) || [])[1] || 0);
    const roll = (value * 7 + touch * 31) % 100; // deterministic pseudo-random
    let outcome;
    if (touch >= max) outcome = roll < 45 ? "recovered" : "lost";
    else if (touch <= 1) outcome = roll < 15 ? "recovered" : "engaged";
    else outcome = roll < 25 ? "recovered" : roll < 92 ? "engaged" : "lost";
    return {
      outcome,
      reason:
        outcome === "recovered"
          ? "Customer responded positively and is moving forward."
          : outcome === "lost"
          ? "No response after repeated outreach; treating as cold."
          : "Replied or still warm — continue the sequence."
    };
  }

  if (input.includes("summary") || input.includes("accepted")) {
    return {
      summary: "Customer discussed the opportunity and asked for follow-up details by email.",
      outcome: "contacted",
      follow_up_needed: true
    };
  }

  if (input.includes("recovery_play") && input.includes("channel")) {
    const approval = input.includes("pricing") || input.includes("quote") || input.includes("contract") || input.includes("rfq");
    if (input.includes("consumer") || input.includes("cart") || input.includes("cancel")) {
      return {
        recovery_play: input.includes("cancel") ? "retention_call" : "voice_call_with_checkout_link",
        channel: "voice",
        requires_human_approval: false
      };
    }
    return {
      recovery_play: input.includes("spec") || input.includes("rfq") ? "email_with_specs" : "email_follow_up",
      channel: "email",
      requires_human_approval: approval
    };
  }

  if (input.includes("opening_line") && !input.includes("subject")) {
    return {
      opening_line: "Hi, this is the Nexus recovery assistant. I noticed your recent interest and wanted to help answer any questions so the next step is easy."
    };
  }

  if (input.includes("subject") || input.includes("body")) {
    return {
      subject: "Following up on your Nexus request",
      body: "Hi there,\n\nI wanted to follow up on your recent request. I can confirm the details you need and help move the next step forward when you are ready.\n\nBest,\nNexus Revenue Recovery"
    };
  }

  if (input.includes("leakage_type")) {
    if (input.includes("cancel")) {
      return {
        leakage_type: "churn_risk",
        urgency: "high",
        reasoning: "The customer has entered a cancellation path, so revenue is at immediate risk."
      };
    }
    if (input.includes("cart")) {
      return {
        leakage_type: "abandoned_cart",
        urgency: "high",
        reasoning: "The buying intent is recent and the checkout did not complete."
      };
    }
    if (input.includes("no reorder") || input.includes("dormant")) {
      return {
        leakage_type: "dormant_account",
        urgency: "medium",
        reasoning: "A previously active customer has gone quiet beyond the normal buying cycle."
      };
    }
    return {
      leakage_type: "stalled_quote",
      urgency: "high",
      reasoning: "The customer showed explicit intent but the opportunity has not progressed."
    };
  }

  return {};
}

async function complete({ system = "", user = "", json = false }) {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const jsonInstruction = json ? "\nReturn only valid JSON. Do not include markdown." : "";

  try {
    let text;
    if (provider === "ollama") {
      const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || "llama3.2",
          messages: [
            { role: "system", content: `${system}${jsonInstruction}` },
            { role: "user", content: user }
          ],
          stream: false,
          format: json ? "json" : undefined
        })
      });
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
      const payload = await response.json();
      text = payload.message?.content || "";
    } else {
      if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          response_format: json ? { type: "json_object" } : undefined,
          messages: [
            { role: "system", content: `${system}${jsonInstruction}` },
            { role: "user", content: user }
          ],
          temperature: 0.3
        })
      });
      if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
      const payload = await response.json();
      text = payload.choices?.[0]?.message?.content || "";
    }

    return json ? safeJsonParse(text) : text;
  } catch (error) {
    console.warn("[llm:fallback]", error.message);
    return inferFallback({ system, user, json });
  }
}

module.exports = { complete };
