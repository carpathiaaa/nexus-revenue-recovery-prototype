const state = {
  opportunities: [],
  selectedVoiceId: null,
  history: [],
  recognition: null,
  listening: false,
  callActive: false,
  config: { emailEnabled: false, maxTouches: 4 },
  expanded: new Set()
};

// Lower number = higher priority. Action-needed items float to the top; resolved
// items sink to the bottom.
const STATUS_PRIORITY = {
  needs_approval: 0,
  new: 1,
  queued: 1,
  calling: 1,
  contacted: 2,
  recovered: 3,
  lost: 3
};

function sortedOpportunities() {
  return [...state.opportunities].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 2;
    const pb = STATUS_PRIORITY[b.status] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.value - a.value;
  });
}

function toggleExpand(id) {
  id = Number(id);
  if (!id) return;
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderOpportunities();
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

// Anything that originates from the LLM, the customer, or an editable field is
// untrusted text — escape it before it touches innerHTML.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toast(message, kind = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.className = "toast";
  }, 3200);
}

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  opportunitiesBody: document.getElementById("opportunitiesBody"),
  refreshBtn: document.getElementById("refreshBtn"),
  autopilotBtn: document.getElementById("autopilotBtn"),
  approveAllBtn: document.getElementById("approveAllBtn"),
  injectLeadBtn: document.getElementById("injectLeadBtn"),
  autopilotPanel: document.getElementById("autopilotPanel"),
  autopilotLog: document.getElementById("autopilotLog"),
  emailMode: document.getElementById("emailMode"),
  schedDot: document.getElementById("schedDot"),
  schedStatus: document.getElementById("schedStatus"),
  schedInterval: document.getElementById("schedInterval"),
  schedLeads: document.getElementById("schedLeads"),
  schedToggleBtn: document.getElementById("schedToggleBtn"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceOpportunity: document.getElementById("voiceOpportunity"),
  voiceCompany: document.getElementById("voiceCompany"),
  voiceProduct: document.getElementById("voiceProduct"),
  voiceStatus: document.getElementById("voiceStatus"),
  transcriptLog: document.getElementById("transcriptLog"),
  callsList: document.getElementById("callsList"),
  startCallBtn: document.getElementById("startCallBtn"),
  muteToggle: document.getElementById("muteToggle"),
  callSummary: document.getElementById("callSummary"),
  metricsRefreshBtn: document.getElementById("metricsRefreshBtn"),
  metricRecovered: document.getElementById("metricRecovered"),
  metricRisk: document.getElementById("metricRisk"),
  metricContacted: document.getElementById("metricContacted"),
  metricConversion: document.getElementById("metricConversion"),
  headerRecovered: document.getElementById("headerRecovered"),
  segmentChart: document.getElementById("segmentChart"),
  eventsList: document.getElementById("eventsList")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setTab(name) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  if (name === "outcomes") loadMetrics();
  // Voice audio + polling only run while the voice tab is the one on screen.
  if (name === "voice") startVoiceWatch();
  else stopVoiceWatch();
}

function statusClass(status) {
  return `status-pill status-${status}`;
}

const STATUS_LABELS = {
  new: "new",
  contacted: "contacted",
  recovered: "recovered",
  lost: "lost",
  needs_approval: "needs approval",
  queued: "queued",
  calling: "on a call"
};

function humanizeStatus(status) {
  return STATUS_LABELS[status] || status;
}

function parseDraft(opportunity) {
  try {
    return JSON.parse(opportunity.draft_outreach || "{}");
  } catch {
    return {};
  }
}

// Read the live values out of an opportunity's inline email composer.
function readComposer(id) {
  const composer = document.querySelector(`[data-composer="${id}"]`);
  if (!composer) return null;
  return {
    subject: composer.querySelector(".draft-subject").value,
    body: composer.querySelector(".draft-body").value
  };
}

// Persist edited subject/body back to the server so every send path uses it.
async function persistDraft(id) {
  const edited = readComposer(id);
  if (!edited) return null;
  const updated = await api(`/api/opportunities/${id}/draft`, {
    method: "PUT",
    body: JSON.stringify(edited)
  });
  state.opportunities = state.opportunities.map((o) => (o.id === updated.id ? updated : o));
  return edited;
}

function renderOpportunities() {
  els.opportunitiesBody.innerHTML = "";
  for (const opportunity of sortedOpportunities()) {
    const id = opportunity.id;
    const hasDetail = Boolean(opportunity.leakage_type || opportunity.draft_outreach);
    const isExpanded = state.expanded.has(id);
    const needsAction = opportunity.status === "needs_approval";
    const isResolved = ["recovered", "lost"].includes(opportunity.status);

    const row = document.createElement("tr");
    row.className = [
      "opp-row",
      needsAction ? "action-needed" : "",
      isResolved ? "resolved" : "",
      hasDetail ? "clickable" : "",
      isExpanded ? "expanded" : ""
    ]
      .filter(Boolean)
      .join(" ");
    if (hasDetail) row.dataset.expand = id;

    let actionCell;
    if (!hasDetail) {
      actionCell = `<button data-run="${id}">Run agent</button>`;
    } else if (needsAction) {
      actionCell = `<button class="review-btn" data-expand-btn="${id}">Review →</button>`;
    } else {
      actionCell = `<button class="secondary toggle-btn" data-expand-btn="${id}">${isExpanded ? "Hide" : "Details"}</button>`;
    }

    row.innerHTML = `
      <td><strong>${escapeHtml(opportunity.company)}</strong><br><small>${escapeHtml(opportunity.customer_name)}</small></td>
      <td><span class="segment-pill">${escapeHtml(opportunity.segment)}</span></td>
      <td>${escapeHtml(opportunity.signal)}<br><small>${escapeHtml(opportunity.product)}</small></td>
      <td class="value">${money.format(opportunity.value)}</td>
      <td>
        <span class="${statusClass(opportunity.status)}">${humanizeStatus(opportunity.status)}</span>
        ${needsAction ? '<br><small class="action-flag">● needs you</small>' : ""}
        ${opportunity.touch_count ? `<br><small class="touches">Touch ${opportunity.touch_count}/${state.config.maxTouches}</small>` : ""}
      </td>
      <td class="col-action">${actionCell}</td>
    `;
    els.opportunitiesBody.appendChild(row);

    if (hasDetail && isExpanded) {
      els.opportunitiesBody.appendChild(buildDetailRow(opportunity));
    }
  }

  renderVoicePicker();
  refreshApprovalQueue();
}

function buildDetailRow(opportunity) {
  const detailRow = document.getElementById("detailTemplate").content.cloneNode(true);
  const detail = detailRow.querySelector(".agent-detail");
  const draft = parseDraft(opportunity);
  const channel = draft.channel || "pending";
  const id = opportunity.id;

  const diagnosis = `
    <div class="detail-block">
      <span class="detail-label">Why it's leaking</span>
      <strong>${escapeHtml(opportunity.leakage_type || "Not detected")}</strong>
      <p>${escapeHtml(opportunity.recovery_play || "No play chosen")} · ${escapeHtml(channel)}${
        draft.urgency ? ` · ${escapeHtml(draft.urgency)} urgency` : ""
      }</p>
      ${draft.reasoning ? `<p class="reasoning">${escapeHtml(draft.reasoning)}</p>` : ""}
      ${opportunity.requires_human_approval ? '<p class="approval">⚠ Needs your approval — touches pricing/legal terms</p>' : ""}
    </div>`;

  let composer;
  if (channel === "voice") {
    composer = `
      <div class="detail-block">
        <span class="detail-label">Opening line (voice)</span>
        <pre>${escapeHtml(draft.opening_line || "Run the agent to generate an opening line.")}</pre>
      </div>
      <div class="detail-actions">
        <div class="action-primary">
          <button data-voice="${id}">Open conversation</button>
        </div>
        <div class="action-resolve">
          <button class="link-btn" data-resolve="${id}" data-outcome="recovered">Mark recovered</button>
          <button class="link-btn" data-resolve="${id}" data-outcome="lost">Mark lost</button>
        </div>
      </div>`;
  } else {
    const subject = draft.subject || `Following up on ${opportunity.product}`;
    const body =
      draft.body ||
      `Hi ${opportunity.customer_name},\n\nI wanted to follow up on ${opportunity.product}. I can help confirm details and next steps.\n\nBest,\n${opportunity.company}`;
    composer = `
      <div class="detail-block email-composer" data-composer="${id}">
        <span class="detail-label">Email to ${escapeHtml(opportunity.customer_email)}</span>
        <input class="draft-subject" type="text" value="${escapeHtml(subject)}" placeholder="Subject" />
        <textarea class="draft-body" rows="6" placeholder="Body">${escapeHtml(body)}</textarea>
      </div>
      <div class="detail-actions">
        <div class="action-primary">
          <button data-email="${id}">${opportunity.requires_human_approval ? "Approve & send" : "Send email"}</button>
          <button class="secondary" data-copy="${id}">Copy</button>
          <button class="secondary" data-mailto="${id}">Mail app</button>
        </div>
        <div class="action-resolve">
          <button class="link-btn" data-resolve="${id}" data-outcome="recovered">Mark recovered</button>
          <button class="link-btn" data-resolve="${id}" data-outcome="lost">Mark lost</button>
        </div>
      </div>`;
  }

  detail.innerHTML = diagnosis + composer;
  return detailRow;
}

// The opportunity dropdown only feeds the "Start a call" button. Show only the
// opportunities you'd actually call — skip resolved ones and ones already on a
// call — and include the customer name so duplicate companies are distinct.
function renderVoicePicker() {
  const current = els.voiceOpportunity.value;
  const callable = state.opportunities.filter(
    (o) => !["recovered", "lost", "calling"].includes(o.status)
  );
  els.voiceOpportunity.innerHTML = callable
    .map(
      (o) =>
        `<option value="${o.id}">${escapeHtml(o.company)} · ${escapeHtml(o.customer_name)} · ${escapeHtml(o.product)}</option>`
    )
    .join("");
  if (current && callable.some((o) => String(o.id) === current)) {
    els.voiceOpportunity.value = current;
  }
}

async function loadOpportunities() {
  state.opportunities = await api("/api/opportunities");
  renderOpportunities();
}

async function loadConfig() {
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = { emailEnabled: false, maxTouches: 4 };
  }
  if (els.emailMode) {
    const live = state.config.emailEnabled;
    els.emailMode.textContent = live ? "✉ Live email" : "✉ Simulated email";
    els.emailMode.className = `email-mode ${live ? "live" : "sim"}`;
    els.emailMode.title = live
      ? "Autopilot sends real emails via Gmail SMTP."
      : "Autopilot simulates sends. Set EMAIL_ENABLED=true + Gmail creds to send for real.";
  }
}

// Show the batch-approve button only when there's an approval queue to clear.
function refreshApprovalQueue() {
  const held = state.opportunities.filter((o) => o.status === "needs_approval");
  if (!els.approveAllBtn) return;
  els.approveAllBtn.hidden = held.length === 0;
  els.approveAllBtn.textContent = `Approve & send all (${held.length})`;
}

async function runAgent(id, button) {
  button.disabled = true;
  button.textContent = "Running...";
  try {
    const updated = await api(`/api/opportunities/${id}/run-agent`, { method: "POST" });
    state.opportunities = state.opportunities.map((opportunity) =>
      opportunity.id === updated.id ? updated : opportunity
    );
    state.expanded.add(Number(id)); // show the draft we just generated
    renderOpportunities();
    await loadMetrics();
    toast("Agent finished — review the draft below", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Run agent";
  }
}

function logAutopilot(text, kind = "") {
  const line = document.createElement("div");
  line.className = `autopilot-line${kind ? ` ${kind}` : ""}`;
  line.textContent = text;
  els.autopilotLog.appendChild(line);
  els.autopilotLog.scrollTop = els.autopilotLog.scrollHeight;
}

// Turn an orchestrator action result into a human-readable activity line.
function describeAction(result) {
  const who = result.company;
  switch (result.action) {
    case "auto_email":
      return [`✓ ${who}: ${result.emailEnabled ? "SENT" : "sent (simulated)"} recovery email automatically`, "ok"];
    case "follow_up":
      return [`↻ ${who}: sent follow-up (touch ${result.touch}/${state.config.maxTouches})`, "ok"];
    case "gave_up":
      return [`✕ ${who}: no reply after ${result.touches} touches — closed as lost`, "muted"];
    case "approved_sent":
      return [`✓ ${who}: approved & sent`, "ok"];
    case "recovered":
      return [`★ ${who}: agent closed as RECOVERED (${money.format(result.opportunity?.value || 0)})`, "ok"];
    case "lost":
      return [`✕ ${who}: agent judged it lost`, "muted"];
    case "voice_call_started":
      return [`📞 ${who}: started a live call (watch it in the Calls tab)`, "ok"];
    case "voice_call":
      return [`📞 ${who}: ran a recovery call → ${result.outcome}`, result.outcome === "recovered" ? "ok" : ""];
    case "await_approval":
      return [`⏸ ${who}: held for your approval (pricing/legal)`, "warn"];
    case "skip":
      return [`– ${who}: ${result.reason}`, "muted"];
    default:
      return [`• ${who}: ${result.action}`, ""];
  }
}

// Agentic driver: walk every unresolved opportunity, ask the server to act on
// it, and stream the decisions into the live log as they happen.
async function runAutopilot() {
  const targets = state.opportunities.filter((o) => !["recovered", "lost"].includes(o.status));
  els.autopilotPanel.hidden = false;
  els.autopilotLog.innerHTML = "";
  els.autopilotBtn.disabled = true;
  els.autopilotBtn.textContent = "Autopilot running…";

  if (!targets.length) {
    logAutopilot("Nothing to do — every opportunity is already resolved.", "muted");
  }

  const tally = { emails: 0, follow_ups: 0, calls: 0, held: 0, closed: 0, recovered: 0 };
  for (const target of targets) {
    logAutopilot(`▸ ${target.company}: working…`);
    try {
      const result = await api(`/api/opportunities/${target.id}/autopilot`, { method: "POST" });
      if (result.opportunity) {
        state.opportunities = state.opportunities.map((o) =>
          o.id === result.opportunity.id ? result.opportunity : o
        );
        renderOpportunities();
      }
      const [line, kind] = describeAction(result);
      logAutopilot(line, kind);
      if (result.action === "auto_email") tally.emails += 1;
      if (result.action === "follow_up") tally.follow_ups += 1;
      if (result.action === "voice_call" || result.action === "voice_call_started") tally.calls += 1;
      if (result.action === "await_approval") tally.held += 1;
      if (result.action === "gave_up" || result.action === "lost") tally.closed += 1;
      if (result.action === "recovered" || result.outcome === "recovered") tally.recovered += 1;
    } catch (error) {
      logAutopilot(`✗ ${target.company}: ${error.message}`, "warn");
    }
  }

  const metrics = await loadMetrics();
  els.autopilotBtn.disabled = false;
  els.autopilotBtn.textContent = "▶ Run Autopilot";

  // Owner digest: what the agent did, and the one thing left for the owner.
  logAutopilot(
    `— Digest: ${tally.emails + tally.follow_ups} emails, ${tally.calls} calls, ★ ${tally.recovered} recovered, ${tally.closed} closed out. ${money.format(
      metrics.recovered_value
    )} recovered to date.`,
    "ok"
  );
  if (tally.held) {
    logAutopilot(`⏸ ${tally.held} need your approval — click "Approve & send all" when ready.`, "warn");
  }
  toast(
    `Autopilot: ${tally.emails + tally.follow_ups} emails sent, ${tally.calls} calls${
      tally.held ? `, ${tally.held} need approval` : ""
    }`,
    "success"
  );
}

// Owner clears the whole approval queue in one click.
async function approveAll() {
  const held = state.opportunities.filter((o) => o.status === "needs_approval");
  if (!held.length) return;
  els.autopilotPanel.hidden = false;
  els.approveAllBtn.disabled = true;
  els.approveAllBtn.textContent = "Sending…";
  logAutopilot(`▸ Owner approved ${held.length} held opportunit${held.length === 1 ? "y" : "ies"}…`, "warn");
  try {
    const { actions } = await api("/api/agent/approve-all", { method: "POST" });
    for (const result of actions) {
      if (result.opportunity) {
        state.opportunities = state.opportunities.map((o) =>
          o.id === result.opportunity.id ? result.opportunity : o
        );
      }
      const [line, kind] = describeAction(result);
      logAutopilot(line, kind);
    }
    renderOpportunities();
    await loadMetrics();
    toast(`Approved & sent ${actions.length}`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    els.approveAllBtn.disabled = false;
    refreshApprovalQueue();
  }
}

// ---- Scheduler ---------------------------------------------------------------
let schedPoll = null;

function renderScheduler(status) {
  state.scheduler = status;
  const active = Boolean(status.active);
  els.schedDot.classList.toggle("on", active);
  els.schedToggleBtn.textContent = active ? "Stop" : "Start";
  els.schedToggleBtn.classList.toggle("danger", active);
  els.schedInterval.disabled = active;
  els.schedLeads.disabled = active;
  if (active) {
    const last = status.lastRun;
    const lastBit = last && last.sent != null ? ` · last tick: ${last.sent} sent, ${last.recovered} recovered` : " · first tick running…";
    els.schedStatus.textContent = `running every ${status.intervalSeconds}s · ${status.runs} run(s)${lastBit}`;
  } else {
    els.schedStatus.textContent = "off";
  }
}

async function loadScheduler() {
  try {
    renderScheduler(await api("/api/scheduler"));
  } catch {
    /* ignore */
  }
}

async function toggleScheduler() {
  try {
    if (state.scheduler?.active) {
      stopSchedPoll();
      renderScheduler(await api("/api/scheduler/stop", { method: "POST" }));
      toast("Scheduler stopped", "info");
    } else {
      const body = JSON.stringify({
        intervalSeconds: Number(els.schedInterval.value),
        generateLeads: els.schedLeads.checked
      });
      renderScheduler(await api("/api/scheduler/start", { method: "POST", body }));
      startSchedPoll();
      toast("Scheduler on — the agent now runs itself", "success");
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

// While the scheduler runs server-side, poll to reflect its work — but don't
// yank the table out from under the user if they're editing a draft.
function startSchedPoll() {
  stopSchedPoll();
  schedPoll = setInterval(async () => {
    await loadScheduler();
    const editing = document.activeElement?.closest?.(".email-composer, .customer-input");
    if (!editing) {
      await loadOpportunities();
      await loadMetrics();
    }
  }, 5000);
}

function stopSchedPoll() {
  if (schedPoll) clearInterval(schedPoll);
  schedPoll = null;
}

async function injectLead() {
  els.injectLeadBtn.disabled = true;
  try {
    const lead = await api("/api/leads/generate", { method: "POST" });
    await loadOpportunities();
    toast(`New lead in: ${lead.company} — ${lead.signal}`, "info");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    els.injectLeadBtn.disabled = false;
  }
}

async function sendEmail(id, button) {
  button.disabled = true;
  button.textContent = "Sending...";
  try {
    await persistDraft(id);
    const result = await api("/api/email/send", {
      method: "POST",
      body: JSON.stringify({ opportunityId: id })
    });
    state.opportunities = state.opportunities.map((opportunity) =>
      opportunity.id === result.opportunity.id ? result.opportunity : opportunity
    );
    state.expanded.delete(Number(id)); // sent — collapse the draft preview
    renderOpportunities();
    await loadMetrics();
    if (result.emailEnabled) {
      toast(`Email sent to ${result.message.to}`, "success");
    } else {
      toast(`Email sent (simulated) to ${result.message.to}. Set EMAIL_ENABLED=true to send for real.`, "info");
    }
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.textContent = "Send email";
  }
}

async function copyDraft(id) {
  const edited = readComposer(id);
  const opportunity = state.opportunities.find((o) => Number(o.id) === Number(id));
  if (!edited || !opportunity) return;
  const text = `To: ${opportunity.customer_email}\nSubject: ${edited.subject}\n\n${edited.body}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Email copied — paste it into your mail client", "success");
  } catch {
    toast("Clipboard blocked — select the text and copy manually", "error");
  }
  persistDraft(id).catch(() => {});
}

function openMailClient(id) {
  const edited = readComposer(id);
  const opportunity = state.opportunities.find((o) => Number(o.id) === Number(id));
  if (!edited || !opportunity) return;
  const url = `mailto:${encodeURIComponent(opportunity.customer_email)}?subject=${encodeURIComponent(
    edited.subject
  )}&body=${encodeURIComponent(edited.body)}`;
  window.location.href = url;
  persistDraft(id).catch(() => {});
}

async function resolveOpportunity(id, outcome) {
  try {
    const updated = await api(`/api/opportunities/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome })
    });
    state.opportunities = state.opportunities.map((opportunity) =>
      opportunity.id === updated.id ? updated : opportunity
    );
    renderOpportunities();
    await loadMetrics();
    toast(`Marked ${outcome}`, outcome === "recovered" ? "success" : "info");
  } catch (error) {
    toast(error.message, "error");
  }
}

function appendTranscriptTurn(role, text) {
  const empty = els.transcriptLog.querySelector(".transcript-empty");
  if (empty) empty.remove();
  const turn = document.createElement("div");
  turn.className = `turn ${role}`;
  turn.innerHTML = `<b>${role === "agent" ? "Agent" : "Customer"}</b><span>${escapeHtml(text)}</span>`;
  els.transcriptLog.appendChild(turn);
  els.transcriptLog.scrollTop = els.transcriptLog.scrollHeight;
}

// ---- Natural voice engine ----------------------------------------------------
// Browser default voices sound robotic. We rank the installed voices and prefer
// the neural/online ones (Microsoft "...Online (Natural)", Google, etc.), then
// give the agent and the (simulated) customer two distinct voices.
const voiceEngine = { voices: [], agent: null, customer: null, rate: 1, ready: false };

// ElevenLabs is the primary voice when the server has a key configured; the
// browser speechSynthesis path below stays as a graceful fallback. The agent
// voice is user-selectable from a curated set of premade ElevenLabs voices; the
// customer keeps the server's default so the two sides sound distinct.
const eleven = { enabled: false, agentVoice: "21m00Tcm4TlvDq8ikWAM" };
const ELEVEN_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel — warm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah — soft" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam — casual" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni — calm" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh — friendly" }
];

async function loadElevenConfig() {
  try {
    const cfg = await api("/api/tts/config");
    eleven.enabled = Boolean(cfg.enabled);
  } catch {
    eleven.enabled = false;
  }
  if (eleven.enabled) populateVoicePicker();
}

function rankVoice(v) {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  let score = 0;
  if (n.includes("natural")) score += 120;
  if (n.includes("online")) score += 60;
  if (n.includes("google")) score += 55;
  if (/\b(aria|jenny|guy|emma|ava|andrew|libby|sonia|nova|michelle|roger)\b/.test(n)) score += 45;
  if (v.localService === false) score += 25;
  if ((v.lang || "").toLowerCase().startsWith("en-us")) score += 20;
  else if ((v.lang || "").toLowerCase().startsWith("en")) score += 12;
  if (/david|zira|mark|hazel/.test(n)) score -= 20; // legacy robotic SAPI voices
  return score;
}

function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const all = window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
  if (!all.length) return;
  voiceEngine.voices = all.slice().sort((a, b) => rankVoice(b) - rankVoice(a));
  if (!voiceEngine.agent) voiceEngine.agent = voiceEngine.voices[0];
  voiceEngine.customer =
    voiceEngine.voices.find((v) => v.name !== voiceEngine.agent.name) || voiceEngine.agent;
  voiceEngine.ready = true;
  populateVoicePicker();
}

function populateVoicePicker() {
  if (!els.voiceSelect) return;
  // When ElevenLabs is live, the picker chooses the agent's ElevenLabs voice.
  if (eleven.enabled) {
    els.voiceSelect.innerHTML = ELEVEN_VOICES.map(
      (v) => `<option value="${v.id}"${v.id === eleven.agentVoice ? " selected" : ""}>${escapeHtml(v.name)}</option>`
    ).join("");
    return;
  }
  const current = voiceEngine.agent?.name;
  els.voiceSelect.innerHTML = voiceEngine.voices
    .map((v) => {
      const natural = /natural|online|google/i.test(`${v.name} ${v.voiceURI}`) ? " ✦" : "";
      return `<option value="${escapeHtml(v.name)}"${v.name === current ? " selected" : ""}>${escapeHtml(v.name)}${natural}</option>`;
    })
    .join("");
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// Speak and resolve when finished (or immediately if muted / unsupported).
function speakAsync(text, voice) {
  return new Promise((resolve) => {
    if (els.muteToggle?.checked || !("speechSynthesis" in window) || !text) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = voiceEngine.rate;
    utterance.pitch = 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    // Safety net: some browsers drop onend, so resolve on a generous estimate.
    setTimeout(finish, 4000 + text.length * 90);
  });
}

function setVoiceStatus(text, kind = "") {
  els.voiceStatus.textContent = text;
  els.voiceStatus.className = `status-pill${kind ? ` status-${kind}` : ""}`;
}

// ---- Speech queue ------------------------------------------------------------
// Speak turns one after another (never overlapping) and, crucially, stop all
// audio the moment the user leaves the tab so nothing leaks in the background.
// Each item carries a role ("agent"/"customer"); the voice is resolved at play
// time so the same queue works for both ElevenLabs and the browser fallback.
const speakQueue = [];
let speaking = false;
let currentAudio = null; // the <audio> currently playing an ElevenLabs clip

function enqueueSpeak(text, role) {
  if (els.muteToggle?.checked || !text) return;
  if (!eleven.enabled && !("speechSynthesis" in window)) return;
  speakQueue.push({ text, role });
  if (!speaking) drainSpeakQueue();
}

function drainSpeakQueue() {
  if (!speakQueue.length || !isVoiceAudible()) {
    speaking = false;
    return;
  }
  speaking = true;
  const { text, role } = speakQueue.shift();
  if (eleven.enabled) {
    playEleven(text, role);
  } else {
    speakBrowser(text, role);
  }
}

// Stream one line from our ElevenLabs proxy and play it. On any failure we fall
// back to the browser voice so a call never goes silent mid-conversation.
function playEleven(text, role) {
  const voiceParam = role === "agent" ? eleven.agentVoice : "customer";
  const url = `/api/tts?voice=${encodeURIComponent(voiceParam)}&text=${encodeURIComponent(text)}`;
  const audio = new Audio(url);
  currentAudio = audio;
  audio.playbackRate = voiceEngine.rate;
  const next = () => {
    if (currentAudio === audio) currentAudio = null;
    drainSpeakQueue();
  };
  audio.onended = next;
  audio.onerror = () => {
    if (currentAudio === audio) currentAudio = null;
    speakBrowser(text, role); // graceful fallback for this one line
  };
  audio.play().catch(() => speakBrowser(text, role));
}

function speakBrowser(text, role) {
  if (!("speechSynthesis" in window)) {
    drainSpeakQueue();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = role === "agent" ? voiceEngine.agent : voiceEngine.customer;
  if (voice) utterance.voice = voice;
  utterance.rate = voiceEngine.rate;
  utterance.onend = drainSpeakQueue;
  utterance.onerror = drainSpeakQueue;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  speakQueue.length = 0;
  speaking = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// Audio is only allowed when the voice tab is the active tab AND the browser tab
// is actually visible. This is the fix for audio bleeding across tab switches.
function isVoiceVisible() {
  return (
    document.visibilityState === "visible" &&
    document.getElementById("tab-voice").classList.contains("active")
  );
}

function isVoiceAudible() {
  return isVoiceVisible() && !els.muteToggle?.checked;
}

// ---- Live call watching ------------------------------------------------------
// Calls run server-side as pods. Here we just poll and render them — like
// watching a live feed. We never drive the conversation from the browser.
const voiceWatch = { selectedId: null, renderedTurns: 0, spokenTurns: 0, poll: null, listSig: "" };

// Highlight the selected call without rebuilding the list (instant, no flicker).
function highlightSelectedCall() {
  els.callsList.querySelectorAll(".call-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.call) === voiceWatch.selectedId);
  });
}

function renderCallsList(calls) {
  // STABLE order by opportunity id so rows never jump under the cursor mid-click.
  const ordered = calls.slice().sort((a, b) => a.opportunityId - b.opportunityId);
  // Only rebuild when something actually changed (membership, status, turn count,
  // or selection) — otherwise the constant polling would thrash the DOM.
  const sig =
    ordered.map((c) => `${c.opportunityId}:${c.status}:${c.turns}`).join("|") + `#${voiceWatch.selectedId}`;
  if (sig === voiceWatch.listSig) return;
  voiceWatch.listSig = sig;

  if (!ordered.length) {
    els.callsList.innerHTML = '<p class="calls-empty">No calls yet. Start one above, or turn on the scheduler.</p>';
    return;
  }
  els.callsList.innerHTML = ordered
    .map((c) => {
      const live = c.status === "live";
      const badge = live
        ? '<span class="live-badge"><span class="live-dot"></span>live</span>'
        : `<span class="outcome-badge ${c.outcome || ""}">${c.outcome || "ended"}</span>`;
      return `
        <button class="call-item ${c.opportunityId === voiceWatch.selectedId ? "active" : ""}" data-call="${c.opportunityId}">
          <span class="call-item-top"><strong>${escapeHtml(c.company)}</strong>${badge}</span>
          <small>${escapeHtml(c.customer)} · ${escapeHtml(c.product)}</small>
          <small class="call-last">${escapeHtml(c.lastText || "")}</small>
        </button>`;
    })
    .join("");
}

async function loadCalls() {
  let calls;
  try {
    calls = await api("/api/calls");
  } catch {
    return;
  }
  renderCallsList(calls);
  // Auto-select a live call (or the most recent) so the user lands on something.
  if (voiceWatch.selectedId == null && calls.length) {
    const target = calls.find((c) => c.status === "live") || calls[0];
    selectCall(target.opportunityId);
  }
}

function selectCall(id) {
  id = Number(id);
  if (voiceWatch.selectedId === id) return;
  voiceWatch.selectedId = id;
  voiceWatch.renderedTurns = 0;
  voiceWatch.spokenTurns = 0;
  stopSpeaking();
  els.transcriptLog.innerHTML = "";
  els.callSummary.textContent = "";
  highlightSelectedCall(); // instant feedback, no waiting for the next poll
  refreshSelectedCall(true);
}

// Pull the selected pod and render any turns we haven't shown yet. New turns are
// spoken aloud — but only the ones that arrive while we're watching (we never
// dump the backlog when first opening a call).
async function refreshSelectedCall(initial = false) {
  if (voiceWatch.selectedId == null) return;
  let pod;
  try {
    pod = await api(`/api/calls/${voiceWatch.selectedId}`);
  } catch {
    return;
  }

  els.voiceCompany.textContent = `${pod.company} · ${pod.customer}`;
  els.voiceProduct.textContent = pod.product;
  const live = pod.status === "live";
  setVoiceStatus(live ? "● live" : pod.outcome || "ended", live ? "contacted" : pod.outcome || "");

  for (let i = voiceWatch.renderedTurns; i < pod.turns.length; i += 1) {
    appendTranscriptTurn(pod.turns[i].role, pod.turns[i].text);
  }
  voiceWatch.renderedTurns = pod.turns.length;

  if (initial || pod.status !== "live") {
    // Opening a call, or a call that's already over: show it, never replay audio.
    voiceWatch.spokenTurns = pod.turns.length;
  } else if (isVoiceAudible()) {
    for (let i = voiceWatch.spokenTurns; i < pod.turns.length; i += 1) {
      enqueueSpeak(pod.turns[i].text, pod.turns[i].role === "agent" ? "agent" : "customer");
    }
    voiceWatch.spokenTurns = pod.turns.length;
  } else {
    voiceWatch.spokenTurns = pod.turns.length; // caught up without speaking
  }

  els.callSummary.textContent = pod.status === "ended" && pod.summary ? `Outcome: ${pod.outcome} — ${pod.summary}` : "";
}

function startVoiceWatch() {
  stopVoiceWatch();
  voiceWatch.listSig = "";
  loadOpportunities(); // refresh the "Start a call" dropdown with current opportunities
  loadCalls().then(() => {
    // Re-entering the tab: catch up the selected transcript silently (no replay).
    if (voiceWatch.selectedId != null) refreshSelectedCall(true);
  });
  voiceWatch.poll = setInterval(async () => {
    await loadCalls();
    await refreshSelectedCall();
  }, 1800);
}

function stopVoiceWatch() {
  if (voiceWatch.poll) clearInterval(voiceWatch.poll);
  voiceWatch.poll = null;
  stopSpeaking();
}

// Manually launch a call pod for the selected opportunity (calls also start on
// their own via autopilot/scheduler — this is just for an on-demand one).
async function startCallManual() {
  const id = Number(els.voiceOpportunity.value);
  if (!id) return;
  els.startCallBtn.disabled = true;
  try {
    await api(`/api/calls/${id}/start`, { method: "POST" });
    voiceWatch.selectedId = null; // force re-select onto the new call
    await loadCalls();
    selectCall(id);
    toast("Call started — watching live", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    els.startCallBtn.disabled = false;
  }
}

function drawSegmentChart(segments) {
  const canvas = els.segmentChart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const max = Math.max(1, ...segments.map((segment) => segment.recovered_value));
  const barHeight = 34;
  const gap = 26;
  const left = 120;
  const top = 34;
  const chartWidth = width - left - 32;

  ctx.font = "14px system-ui, sans-serif";
  segments.forEach((segment, index) => {
    const y = top + index * (barHeight + gap);
    const barWidth = Math.round((segment.recovered_value / max) * chartWidth);
    ctx.fillStyle = "#607080";
    ctx.fillText(segment.segment, 18, y + 23);
    ctx.fillStyle = "#0f766e";
    ctx.fillRect(left, y, Math.max(2, barWidth), barHeight);
    ctx.fillStyle = "#18212f";
    ctx.fillText(money.format(segment.recovered_value), left + barWidth + 10, y + 23);
  });
}

async function loadMetrics() {
  const metrics = await api("/api/metrics");
  els.metricRecovered.textContent = money.format(metrics.recovered_value);
  els.headerRecovered.textContent = money.format(metrics.recovered_value);
  els.metricRisk.textContent = money.format(metrics.total_value);
  els.metricContacted.textContent = String(metrics.contacted || 0);
  els.metricConversion.textContent = `${Math.round((metrics.conversion_rate || 0) * 100)}%`;
  drawSegmentChart(metrics.by_segment || []);
  els.eventsList.innerHTML = (metrics.events || [])
    .map(
      (event) => `
        <div class="event">
          <strong>${event.company} · ${event.action}</strong>
          <small>${new Date(event.created_at).toLocaleString()}</small>
          <small>${event.detail || ""}</small>
        </div>
      `
    )
    .join("");
  return metrics;
}

els.tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
els.refreshBtn.addEventListener("click", loadOpportunities);
els.autopilotBtn.addEventListener("click", runAutopilot);
els.approveAllBtn.addEventListener("click", approveAll);
els.injectLeadBtn.addEventListener("click", injectLead);
els.schedToggleBtn.addEventListener("click", toggleScheduler);
els.voiceSelect.addEventListener("change", (event) => {
  if (eleven.enabled) {
    eleven.agentVoice = event.target.value; // an ElevenLabs voice id
    return;
  }
  const chosen = voiceEngine.voices.find((v) => v.name === event.target.value);
  if (chosen) voiceEngine.agent = chosen;
  voiceEngine.customer = voiceEngine.voices.find((v) => v.name !== voiceEngine.agent.name) || voiceEngine.agent;
});
els.metricsRefreshBtn.addEventListener("click", loadMetrics);
els.startCallBtn.addEventListener("click", startCallManual);
els.callsList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-call]");
  if (item) selectCall(item.dataset.call);
});

// Stop all speech the instant the browser tab is hidden (alt-tab, minimize, etc).
document.addEventListener("visibilitychange", () => {
  if (!isVoiceVisible()) stopSpeaking();
});

els.opportunitiesBody.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) {
    if (button.dataset.expandBtn) return toggleExpand(button.dataset.expandBtn);
    if (button.dataset.run) return runAgent(Number(button.dataset.run), button);
    if (button.dataset.voice) {
      els.voiceOpportunity.value = button.dataset.voice;
      setTab("voice");
      selectCall(Number(button.dataset.voice));
      return;
    }
    if (button.dataset.email) return sendEmail(Number(button.dataset.email), button);
    if (button.dataset.copy) return copyDraft(Number(button.dataset.copy));
    if (button.dataset.mailto) return openMailClient(Number(button.dataset.mailto));
    if (button.dataset.resolve) return resolveOpportunity(Number(button.dataset.resolve), button.dataset.outcome);
    return;
  }
  // Clicking anywhere on a row (but not its buttons or expanded detail) toggles it.
  const row = event.target.closest("tr.opp-row");
  if (row && row.dataset.expand) toggleExpand(row.dataset.expand);
});

loadVoices(); // browser fallback voices; onvoiceschanged refines later
loadElevenConfig(); // prefer ElevenLabs when the server has a key
Promise.all([loadConfig(), loadOpportunities(), loadScheduler()])
  .then(loadMetrics)
  .catch((error) => toast(error.message, "error"));

// If the scheduler is already running (e.g. page reload), resume live polling.
loadScheduler().then(() => {
  if (state.scheduler?.active) startSchedPoll();
});
