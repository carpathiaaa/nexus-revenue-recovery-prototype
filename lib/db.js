const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "data.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY,
      company TEXT NOT NULL,
      segment TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      signal TEXT NOT NULL,
      product TEXT NOT NULL,
      value REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      leakage_type TEXT,
      recovery_play TEXT,
      draft_outreach TEXT,
      requires_human_approval INTEGER NOT NULL DEFAULT 0,
      call_summary TEXT,
      follow_up_needed INTEGER NOT NULL DEFAULT 0,
      touch_count INTEGER NOT NULL DEFAULT 0,
      last_touch_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      opportunity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    );
  `);

  // Lightweight migration: add follow-up columns to databases seeded before the
  // cadence engine existed, so an existing data.db keeps working.
  const columns = db.prepare("PRAGMA table_info(opportunities)").all().map((c) => c.name);
  if (!columns.includes("touch_count")) {
    db.exec("ALTER TABLE opportunities ADD COLUMN touch_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.includes("last_touch_at")) {
    db.exec("ALTER TABLE opportunities ADD COLUMN last_touch_at TEXT");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function rowToOpportunity(row) {
  if (!row) return null;
  return {
    ...row,
    requires_human_approval: Boolean(row.requires_human_approval),
    follow_up_needed: Boolean(row.follow_up_needed)
  };
}

function allOpportunities() {
  return db
    .prepare("SELECT * FROM opportunities ORDER BY value DESC, id ASC")
    .all()
    .map(rowToOpportunity);
}

function getOpportunity(id) {
  return rowToOpportunity(db.prepare("SELECT * FROM opportunities WHERE id = ?").get(id));
}

function updateOpportunity(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!entries.length) return getOpportunity(id);
  const sets = entries.map(([key]) => `${key} = @${key}`).join(", ");
  const values = Object.fromEntries(
    entries.map(([key, value]) => [key, typeof value === "boolean" ? Number(value) : value])
  );
  db.prepare(`UPDATE opportunities SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
    ...values,
    id,
    updated_at: nowIso()
  });
  return getOpportunity(id);
}

function addEvent(opportunityId, action, detail = "") {
  db.prepare(
    "INSERT INTO events (opportunity_id, action, detail, created_at) VALUES (?, ?, ?, ?)"
  ).run(opportunityId, action, detail, nowIso());
}

function listEvents(limit = 30) {
  return db
    .prepare(
      `SELECT events.*, opportunities.company
       FROM events
       JOIN opportunities ON opportunities.id = events.opportunity_id
       ORDER BY events.id DESC
       LIMIT ?`
    )
    .all(limit);
}

initSchema();

module.exports = {
  db,
  initSchema,
  nowIso,
  allOpportunities,
  getOpportunity,
  updateOpportunity,
  addEvent,
  listEvents
};
