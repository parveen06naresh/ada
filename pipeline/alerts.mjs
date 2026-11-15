// Weekly email alerts, step 1 of 2: build each subscriber's digest of best new matches.
// Reads subscribers from Supabase with the service key (GitHub secret, never in the site),
// scores roles with the same code the site uses (site/js/match.js), and writes one JSON
// file of messages that pipeline/send_alerts.py delivers.
// Usage: node pipeline/alerts.mjs site/data/opportunities.json out/alerts.json
import { readFileSync, writeFileSync } from "node:fs";
import { TRACKS, unpackJobs, weeklyMatches } from "../site/js/match.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const SITE = process.env.SITE_URL || "https://parveen06naresh.github.io/ada/";
const LAYOUT = readFileSync(new URL("./email_layout.html", import.meta.url), "utf8");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function digest(email, profile, jobs, now = Date.now()) {
  const recs = weeklyMatches(jobs, profile, 10, now);
  if (!recs.length) return null;
  const unsub = `${SITE}?unsubscribe=${encodeURIComponent(profile.alertToken || "")}`;
  const goal = TRACKS[(profile.tracks || [])[0]] || "AI";
  const subject = `${recs.length} new ${goal} role${recs.length > 1 ? "s that fit" : " that fits"} you this week`;
  const lines = recs.map((r, i) => `${i + 1}. ${r.j.c}: ${r.j.t} (${r.j.l[0] || "location not listed"})\n   Why: ${r.why.join(" · ")}\n   ${r.j.u}`);
  const text = `Your best new matches on Ada this week:\n\n${lines.join("\n\n")}\n\nSee all your matches: ${SITE}#match\n\nYou get this because you turned on weekly matches on Ada. Unsubscribe: ${unsub}\n`;
  const rows = recs.map((r) => `<tr><td style="padding:14px 0;border-top:1px solid #efedf7;">
<a href="${esc(r.j.u)}" style="color:#15142a;font-weight:700;text-decoration:none;font-size:15px;">${esc(r.j.t)}</a><br>
<span style="color:#2b2940;"><b>${esc(r.j.c)}</b> · ${esc(r.j.l[0] || "Location not listed")}</span><br>
<span style="color:#6a6782;font-size:13px;">${esc(r.why.join(" · "))}</span><br>
<a href="${esc(r.j.u)}" style="color:#6a4cf0;font-size:13px;font-weight:600;text-decoration:none;">View and apply &rarr;</a></td></tr>`).join("\n");
  const body = `<p style="margin:0 0 10px;color:#5d5b78;">${recs.length} role${recs.length > 1 ? "s" : ""} posted in the last 7 days that fit your Ada profile, best fit first.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr><td style="background:#6a4cf0;border-radius:10px;"><a href="${SITE}#match" style="display:inline-block;padding:12px 22px;font-weight:700;color:#ffffff;text-decoration:none;">See all your matches</a></td></tr></table>`;
  const foot = `You're getting this because you turned on weekly matches on Ada. <a href="${esc(unsub)}" style="color:#8a87a3;">Unsubscribe in one click</a> or turn it off in For you.<br>Ada is a free, open-source careers project built by a student.`;
  const html = LAYOUT.replace("[[TITLE]]", esc(subject)).replace("[[PREHEADER]]", esc(`${recs[0].j.c}: ${recs[0].j.t} and more`))
    .replace("[[HEADING]]", "Your best new matches this week").replace("[[BODY]]", body).replace("[[FOOTER]]", foot);
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
