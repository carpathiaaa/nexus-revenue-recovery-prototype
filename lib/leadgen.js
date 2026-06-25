const { db, nowIso, getOpportunity, addEvent } = require("./db");

// A pool of realistic incoming leakage signals the scheduler can inject as "new
// data" arriving over time, so the always-on agent has fresh work to do.
const TEMPLATES = [
  { company: "Resident", segment: "consumer", product: "King hybrid mattress", signal: "Cart abandoned 30 min ago", value: 1600 },
  { company: "Dollar Shave Club", segment: "consumer", product: "Grooming bundle", signal: "Subscription payment failed", value: 240 },
  { company: "Lamps Plus", segment: "consumer", product: "Outdoor lighting set", signal: "Wishlist item back in stock, no purchase", value: 850 },
  { company: "Encoura", segment: "education", product: "Enrollment analytics seat", signal: "Trial expires in 3 days", value: 38000 },
  { company: "Savvas", segment: "education", product: "Math curriculum renewal", signal: "Renewal quote opened, not signed", value: 41000 },
  { company: "NWEA", segment: "education", product: "Assessment add-on", signal: "Usage dropped 60% this month", value: 26000 },
  { company: "CK Snacks", segment: "b2b", product: "Seasonal popcorn SKU", signal: "Sample shipped, no reorder", value: 72000 },
  { company: "HDT Global", segment: "b2b", product: "Field shelter spares", signal: "RFQ viewed 5x, no response", value: 180000 },
  { company: "Sperber", segment: "services", product: "Snow removal contract", signal: "Proposal stalled 8 days", value: 16000 },
  { company: "Arrowhead Products", segment: "b2b", product: "Ducting support renewal", signal: "Contract auto-renew declined", value: 88000 }
];

const FIRST_NAMES = ["Avery", "Jordan", "Riley", "Casey", "Morgan", "Quinn", "Devon", "Harper", "Reese", "Sasha", "Logan", "Emerson"];
const LAST_NAMES = ["Park", "Nguyen", "Okafor", "Silva", "Rossi", "Kowalski", "Haddad", "Mehta", "Larsen", "Bauer"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateLead() {
  const t = pick(TEMPLATES);
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const name = `${first} ${last}`;
  const email = `${first}.${last}@example.com`.toLowerCase();
  // Jitter the value a little so injected leads feel distinct.
  const value = Math.round(t.value * (0.85 + Math.random() * 0.3));
  const ts = nowIso();

  const info = db
    .prepare(
      `INSERT INTO opportunities
        (company, segment, customer_name, customer_email, customer_phone, signal, product, value, status, created_at, updated_at)
       VALUES (@company, @segment, @customer_name, @customer_email, @customer_phone, @signal, @product, @value, 'new', @created_at, @updated_at)`
    )
    .run({
      company: t.company,
      segment: t.segment,
      customer_name: name,
      customer_email: email,
      customer_phone: "(000) 555-0000",
      signal: t.signal,
      product: t.product,
      value,
      created_at: ts,
      updated_at: ts
    });

  addEvent(info.lastInsertRowid, "ingested", `New leakage signal detected: ${t.signal} (${t.company}).`);
  return getOpportunity(info.lastInsertRowid);
}

module.exports = { generateLead };
