const { runAutopilot } = require("./orchestrator");
const { generateLead } = require("./leadgen");

// A simple in-process scheduler. When active it ticks on an interval: optionally
// injects a fresh lead (simulating new leakage arriving), then runs autopilot
// over everything unresolved. Runs server-side, so it keeps working with no
// browser open. Overlapping ticks are skipped.
let timer = null;
let busy = false;
let intervalSeconds = 60;
let generateLeads = false;
let lastRun = null;
let runs = 0;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const injected = generateLeads ? generateLead() : null;
    const actions = await runAutopilot();
    runs += 1;
    lastRun = {
      at: new Date().toISOString(),
      injected: injected ? `${injected.company} — ${injected.signal}` : null,
      worked: actions.length,
      recovered: actions.filter((a) => a.action === "recovered").length,
      sent: actions.filter((a) => ["auto_email", "follow_up", "approved_sent"].includes(a.action)).length
    };
  } catch (error) {
    console.error("[scheduler] tick failed:", error.message);
    lastRun = { at: new Date().toISOString(), error: error.message };
  } finally {
    busy = false;
  }
}

function start(options = {}) {
  stop();
  intervalSeconds = Math.max(15, Number(options.intervalSeconds) || 60);
  generateLeads = Boolean(options.generateLeads);
  timer = setInterval(tick, intervalSeconds * 1000);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  // Kick off an immediate first tick so the user sees activity right away.
  tick();
  return status();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  return status();
}

function status() {
  return {
    active: Boolean(timer),
    intervalSeconds,
    generateLeads,
    runs,
    lastRun
  };
}

module.exports = { start, stop, status, tick };
