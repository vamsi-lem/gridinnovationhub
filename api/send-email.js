import { createHash } from "node:crypto";

// Vercel serverless function: POST /api/send-email
// Sends a waitlist notification to the client through Resend.
// Needs RESEND_API_KEY in Vercel > Project > Settings > Environment Variables.

const FROM = "Reliability Waitlist <waitlist@reliability.gridinnovationhub.com>";
const DEFAULT_TO = "ashaw@integconsulting.com,mgangumalla@integconsulting.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Light per-IP limit (per warm instance) to stop bursts and bots.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_MAX;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { email, form_name, website } = body;

  // Honeypot: real visitors never fill this hidden field. Pretend success for bots.
  if (typeof website === "string" && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!cleanEmail || cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is missing");
    return res.status(500).json({ error: "Email service is not configured" });
  }

  const to = (process.env.WAITLIST_TO || DEFAULT_TO)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const formName = typeof form_name === "string" && form_name.trim()
    ? form_name.trim().slice(0, 100)
    : "Reliability Waitlist";

  // Same email = same key, so Resend sends it only once within 24 hours,
  // even if the visitor clicks many times or submits from two tabs.
  const idempotencyKey = "waitlist-" + createHash("sha256").update(cleanEmail).digest("hex");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      // Keep this payload identical for the same email (no timestamps),
      // otherwise Resend rejects the repeat instead of treating it as a duplicate.
      body: JSON.stringify({
        from: FROM,
        to,
        reply_to: cleanEmail,
        subject: `New ${formName} signup: ${cleanEmail}`,
        text: [
          `A new visitor joined the ${formName}.`,
          "",
          `Email: ${cleanEmail}`,
          `Form: ${formName}`,
          `Source: reliability.gridinnovationhub.com`,
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
            <p>A new visitor joined the <strong>${escapeHtml(formName)}</strong>.</p>
            <table cellpadding="6" style="border-collapse:collapse">
              <tr><td style="color:#666">Email</td><td><a href="mailto:${escapeHtml(cleanEmail)}">${escapeHtml(cleanEmail)}</a></td></tr>
              <tr><td style="color:#666">Form</td><td>${escapeHtml(formName)}</td></tr>
              <tr><td style="color:#666">Source</td><td>reliability.gridinnovationhub.com</td></tr>
            </table>
          </div>`,
      }),
    });

    // 409 = this email was already sent (idempotent duplicate). Treat as success.
    if (response.status === 409) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Resend error:", response.status, result);
      return res.status(502).json({ error: "Unable to send notification" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Email request failed:", error);
    return res.status(500).json({ error: "Email service error" });
  }
}
