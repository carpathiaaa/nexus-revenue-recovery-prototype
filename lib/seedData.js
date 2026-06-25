const { db, nowIso } = require("./db");

// The demo opportunity set, shared by the `npm run seed` script (destructive
// reset) and the startup auto-seed (non-destructive, used on ephemeral hosts
// like Render where data.db is wiped on each deploy).
const rows = [
  { company: "Resident", segment: "consumer", customer_name: "Maya Chen", customer_email: "maya.chen@example.com", customer_phone: "(310) 555-0134", signal: "Cart abandoned 2 hrs ago", product: "Queen hybrid mattress", value: 1250 },
  { company: "Dollar Shave Club", segment: "consumer", customer_name: "Jordan Lee", customer_email: "jordan.lee@example.com", customer_phone: "(415) 555-0197", signal: "Cancel flow started", product: "Annual subscription", value: 180 },
  { company: "Encoura", segment: "education", customer_name: "Priya Nair", customer_email: "priya.nair@example.edu", customer_phone: "(512) 555-0181", signal: "No follow-up in 5 days", product: "District data package", value: 45000 },
  { company: "CK Snacks", segment: "b2b", customer_name: "Sam Rivera", customer_email: "sam.rivera@example.com", customer_phone: "(773) 555-0162", signal: "SKU specs requested, no order", product: "Private-label popcorn run", value: 80000 },
  { company: "Sperber", segment: "services", customer_name: "Elena Brooks", customer_email: "elena.brooks@example.com", customer_phone: "(602) 555-0119", signal: "Quote inactive 10 days", product: "Commercial landscape contract", value: 12000 },
  { company: "Lamps Plus", segment: "consumer", customer_name: "Noah Patel", customer_email: "noah.patel@example.com", customer_phone: "(626) 555-0128", signal: "No reorder in 9 months", product: "Lighting fixtures", value: 600 },
  { company: "Savvas", segment: "education", customer_name: "Alicia Moreno", customer_email: "alicia.moreno@example.edu", customer_phone: "(919) 555-0174", signal: "Inbound demo request untouched", product: "K-12 curriculum license", value: 30000 },
  { company: "HDT Global", segment: "b2b", customer_name: "Marcus Wright", customer_email: "marcus.wright@example.com", customer_phone: "(703) 555-0144", signal: "RFQ stalled 14 days", product: "Expeditionary shelter units", value: 250000 },
  { company: "Arrowhead Products", segment: "b2b", customer_name: "Tessa Kim", customer_email: "tessa.kim@example.com", customer_phone: "(562) 555-0151", signal: "Renewal paperwork opened, not signed", product: "Aerospace ducting support agreement", value: 95000 },
  { company: "NWEA", segment: "education", customer_name: "Brian O'Connell", customer_email: "brian.oconnell@example.edu", customer_phone: "(503) 555-0188", signal: "Assessment expansion meeting missed", product: "District assessment add-on", value: 22000 }
];

function insertRows() {
  const insert = db.prepare(`
    INSERT INTO opportunities
      (company, segment, customer_name, customer_email, customer_phone, signal, product, value, status, created_at, updated_at)
    VALUES
      (@company, @segment, @customer_name, @customer_email, @customer_phone, @signal, @product, @value, 'new', @created_at, @updated_at)
  `);
  const tx = db.transaction(() => {
    const ts = nowIso();
    for (const row of rows) insert.run({ ...row, created_at: ts, updated_at: ts });
  });
  tx();
}

// Non-destructive: only seeds when the table is empty. Safe to call on every boot.
function seedIfEmpty() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM opportunities").get();
  if (n > 0) return false;
  insertRows();
  return true;
}

module.exports = { rows, insertRows, seedIfEmpty };
