// Weekly email alerts, step 1 of 2: build each subscriber's digest of best new matches.
// Reads subscribers from Supabase with the service key (GitHub secret, never in the site),
// scores roles with the same code the site uses (site/js/match.js), and writes one JSON
// file of messages that pipeline/send_alerts.py delivers.
// Usage: node pipeline/alerts.mjs site/data/opportunities.json out/alerts.json
import { readFileSync, writeFileSync } from "node:fs";
import { TRACKS, unpackJobs, weeklyMatches } from "../site/js/match.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const SITE = process.env.SITE_URL || "https://parveen06naresh.github.io/ada/";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function digest(email, profile, jobs, now = Date.now()) {
  const recs = weeklyMatches(jobs, profile, 10, now);
  if (!recs.length) return null;
  const unsub = `${SITE}?unsubscribe=${encodeURIComponent(profile.alertToken || "")}`;
  const goal = TRACKS[(profile.tracks || [])[0]] || "AI";
  const subject = `${recs.length} new ${goal} role${recs.length > 1 ? "s" : ""} that fit you this week`;
  const lines = recs.map((r, i) => `${i + 1}. ${r.j.c}: ${r.j.t} (${r.j.l[0] || "location not listed"})\n   Why: ${r.why.join(" · ")}\n   ${r.j.u}`);
  const text = `Your best new matches on Ada this week:\n\n${lines.join("\n\n")}\n\nSee all your matches: ${SITE}#foryou\n\nYou get this because you turned on weekly matches on Ada. Unsubscribe: ${unsub}\n`;
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#1c1a2b;max-width:600px">
<p style="font-size:18px;font-weight:700;margin:0 0 4px">Your best new matches this week</p>
<p style="color:#6a6782;margin:0 0 18px">${recs.length} roles posted in the last 7 days that fit your Ada profile.</p>
${recs.map((r) => `<div style="padding:12px 0;border-top:1px solid #e3e0f0">
<a href="${esc(r.j.u)}" style="color:#6a4cf0;font-weight:700;text-decoration:none">${esc(r.j.t)}</a><br>
<b>${esc(r.j.c)}</b> · ${esc(r.j.l[0] || "Location not listed")}<br>
<span style="color:#6a6782;font-size:13px">${esc(r.why.join(" · "))}</span></div>`).join("\n")}
<p style="margin:20px 0"><a href="${SITE}#foryou" style="background:#6a4cf0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">See all your matches</a></p>
<p style="color:#9b98b4;font-size:12px">You get this because you turned on weekly matches on Ada, a free student open-source project. <a href="${esc(unsub)}" style="color:#9b98b4">Unsubscribe</a></p></div>`;
  return { to: email, subject, text, html, unsubscribe: unsub };
}

async function api(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function main([oppPath, outPath]) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log("Alerts are off: SUPABASE_URL and SUPABASE_SERVICE_KEY are not set.");
    writeFileSync(outPath, "[]");
    return;
  }
  const jobs = unpackJobs(JSON.parse(readFileSync(oppPath, "utf8")));
  const rows = await api("/rest/v1/user_state?select=user_id,data&data->profile->>alerts=eq.true");
  const emails = {};
  for (let page = 1; ; page++) {
    const { users } = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    for (const u of users) if (u.email && u.email_confirmed_at) emails[u.id] = u.email;
    if (users.length < 1000) break;
  }
  const out = rows.map((r) => emails[r.user_id] && digest(emails[r.user_id], r.data.profile, jobs)).filter(Boolean);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`${rows.length} subscribers, ${out.length} digests with new matches`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
