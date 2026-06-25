require("dotenv").config();

const nodemailer = require("nodemailer");
const { addEvent, getOpportunity, updateOpportunity } = require("./db");

function parseDraft(opportunity) {
  try {
    return JSON.parse(opportunity.draft_outreach || "{}");
  } catch {
    return {};
  }
}

function buildMessage(opportunity) {
  const draft = parseDraft(opportunity);
  const subject = draft.subject || `Following up on ${opportunity.product}`;
  const body =
    draft.body ||
    `Hi ${opportunity.customer_name},\n\nI wanted to follow up on ${opportunity.product}. I can help confirm details and next steps.\n\nBest,\n${opportunity.company}`;
  return { to: opportunity.customer_email, subject, body };
}

// Allow the user to overwrite the agent's draft (or write one from scratch)
// before sending. Stored back into draft_outreach so the rest of the app and
// the manual/SMTP send paths both see the edited copy.
function saveDraft(opportunityId, { subject, body }) {
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error("Opportunity not found");
  const draft = parseDraft(opportunity);
  const next = {
    ...draft,
    channel: draft.channel || "email",
    subject: subject != null ? String(subject) : draft.subject,
    body: body != null ? String(body) : draft.body
  };
  return updateOpportunity(opportunity.id, { draft_outreach: JSON.stringify(next) });
}

async function sendOpportunityEmail(opportunityId) {
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error("Opportunity not found");

  const message = buildMessage(opportunity);
  const emailEnabled = process.env.EMAIL_ENABLED === "true";

  if (emailEnabled) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error("Gmail credentials are required when EMAIL_ENABLED=true");
    }
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: message.to,
      subject: message.subject,
      text: message.body
    });
  } else {
    // EMAIL_ENABLED is off: simulate the send so the autonomous flow still runs
    // end-to-end. Set EMAIL_ENABLED=true + Gmail creds to send for real.
    console.log("[email:simulated]", { to: message.to, subject: message.subject });
  }

  addEvent(opportunity.id, "emailed", `Email ${emailEnabled ? "sent live via Gmail" : "sent (simulated)"}: ${message.subject}`);
  // Sending is the approval — clear the gate so the row no longer reads "needs approval".
  const updated = updateOpportunity(opportunity.id, { status: "contacted", requires_human_approval: false });
  return { opportunity: updated, message, emailEnabled };
}

module.exports = { sendOpportunityEmail, saveDraft, buildMessage };
