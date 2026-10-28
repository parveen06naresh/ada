import {
  BADGES, TRACKS, checkIn, decodeProfile, detectSkills, encodeProfile, filterJobs, planRoadmap, recommend, today, unpackJobs,
} from "./match.js";
import { MODEL, buildPrompt, friendlyError, renderMarkdown, runCoach } from "./coach.js";
import * as sync from "./sync.js";

const REPO = "https://github.com/parveen06naresh/ada";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");

// Browser storage is a convenience only: the app works without it.
const store = {
  get(k, d) { try { const v = localStorage.getItem(`ada:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v, quiet) {
    try {
      localStorage.setItem(`ada:${k}`, JSON.stringify(v));
      if (!quiet && sync.SYNCED.includes(k)) { localStorage.setItem("ada:updated", String(Date.now())); sync.pushSoon(); }
    } catch { /* private mode */ }
  },
};

const SKILL_NAMES = {};
const PROGRAM_TYPES = { all: "All", hackathon: "Hackathons", competition: "Competitions", fellowship: "Fellowships", research: "Research programs", grant: "Grants", startup: "Startup programs", compute: "Free compute" };
const state = {
  jobs: [], programs: [], graph: null, stats: null,
  shown: 40,
  saved: new Set(store.get("saved", [])),
  profile: store.get("profile", { tracks: ["mle", "llm"], kind: "internship", level: "Undergrad", countries: ["United States"], remoteOk: true, known: ["python"], hours: 10 }),
  progress: store.get("progress", {}),
  streak: store.get("streak", {}),
  progType: "all",
  sharedView: null,
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("show"), 2200);
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt("Copy this:", text); }
}

// Stable color per company for the monogram.
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function logo(name, domain) {
  const l = el("div", { class: "logo", "aria-hidden": "true" }, (name.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase());
  l.style.background = `linear-gradient(135deg, hsl(${hue(name)} 70% 52%), hsl(${(hue(name) + 40) % 360} 70% 40%))`;
  if (domain) {  // the company's icon when we know its website; the monogram stays if it fails to load
    const img = el("img", { src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, alt: "", loading: "lazy" });
    img.addEventListener("load", () => { if (img.naturalWidth > 16) { l.textContent = ""; l.classList.add("img"); l.append(img); } });
  }
  return l;
}

function reportLink(subject, url) {
  const body = `What's wrong (closed, wrong role type, wrong location, broken link...):\n\n\nLink: ${url}`;
  return el("a", { class: "report", href: `${REPO}/issues/new?title=${encodeURIComponent(`Problem: ${subject}`)}&body=${encodeURIComponent(body)}`, target: "_blank", rel: "noopener", title: "Report a problem with this listing" }, "Report");
}

function ago(d) {
  const n = today() - d;
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 30) return `${n} days ago`;
  const m = Math.round(n / 30);
  return `${m} month${m > 1 ? "s" : ""} ago`;
}

function jobCard(j, why) {
  const on = state.saved.has(j.id);
  const save = el("button", { class: `save${on ? " on" : ""}`, title: on ? "Saved" : "Save", "aria-label": on ? "Unsave" : "Save", "aria-pressed": String(on) }, on ? "★" : "☆");
  save.addEventListener("click", () => {
    if (state.saved.has(j.id)) state.saved.delete(j.id); else state.saved.add(j.id);
    store.set("saved", [...state.saved]);
    const now = state.saved.has(j.id);
    save.classList.toggle("on", now);
    save.textContent = now ? "★" : "☆";
    save.setAttribute("aria-pressed", String(now));
    updateSavedCount();
  });
  const tags = el("div", { class: "tags" },
    el("span", { class: "tag track" }, TRACKS[j.tr]),
    el("span", { class: "tag" }, j.k === "internship" ? "Internship" : "New grad"),
    j.lv === "PhD" || j.lv === "Masters" ? el("span", { class: "tag" }, j.lv) : null,
    j.r ? el("span", { class: "tag" }, "Remote") : null,
    today() - j.d <= 3 ? el("span", { class: "tag new" }, "New") : null,
    j.p ? el("span", { class: "tag pay" }, `$${Math.round(j.p)}/hr`) : null,
  );
  const where = j.l.length ? j.l.slice(0, 2).join(" · ") + (j.l.length > 2 ? ` +${j.l.length - 2}` : "") : "Location not listed";
  return el("li", { class: "card" },
    logo(j.c, j.dm),
    el("div", {},
      el("h3", {}, el("a", { href: j.u, target: "_blank", rel: "noopener" }, j.t)),
      el("div", { class: "meta" }, el("b", {}, j.c), el("span", {}, where), el("span", {}, ago(j.d))),
      tags,
      why && why.length ? el("div", { class: "why" }, "✓ " + why.join(" · ")) : null,
    ),
    el("div", { class: "side" }, el("a", { class: "btn", href: j.u, target: "_blank", rel: "noopener" }, "Apply"), save, reportLink(`${j.c}: ${j.t}`, j.u)),
  );
}

/* ---------- Explore ---------- */
function readFilters() {
  return {
    text: $("#q").value.trim(),
    kind: $("#f-kind").value,
    track: $("#f-track").value,
    skill: $("#f-skill").value,
    level: $("#f-level").value,
    country: $("#f-country").value,
    days: +$("#f-days").value || 0,
    remote: $("#f-remote").checked,
  };
}

function renderExplore() {
  const q = readFilters();
  const list = filterJobs(state.jobs, q);
  $("#count").textContent = `${fmt(list.length)} open role${list.length === 1 ? "" : "s"}`;
  const ul = $("#results");
  ul.replaceChildren(...list.slice(0, state.shown).map((j) => jobCard(j)));
  if (!list.length) ul.append(el("li", { class: "empty" }, "No roles match. Try removing a filter."));
  $("#more").hidden = list.length <= state.shown;
}

function searchParams() {
  const q = readFilters();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v && v !== "any" && v !== 0) p.set(k, v === true ? "1" : v);
  return p;
}

function applySearchParams(p) {
  const set = (id, k) => { if (p.has(k)) $(id).value = p.get(k); };
  set("#q", "text"); set("#f-kind", "kind"); set("#f-track", "track"); set("#f-skill", "skill");
  set("#f-level", "level"); set("#f-country", "country"); set("#f-days", "days");
  $("#f-remote").checked = p.get("remote") === "1";
}

/* ---------- For you ---------- */
function readProfile() {
  const p = state.profile;
  p.tracks = [$("#p-track").value, $("#p-track2").value].filter((t, i, a) => t && t !== "none" && a.indexOf(t) === i);
  p.kind = $("#p-kind").value;
  p.level = $("#p-level").value;
  p.countries = [...$("#p-countries").selectedOptions].map((o) => o.value);
  p.remoteOk = $("#p-remote").checked;
  p.hours = +$("#p-hours").value;
  store.set("profile", p);
}

function fillProfile() {
  const p = state.profile;
  $("#p-track").value = p.tracks[0] || "mle";
  $("#p-track2").value = p.tracks[1] || "none";
  $("#p-kind").value = p.kind;
  $("#p-level").value = p.level;
  for (const o of $("#p-countries").options) o.selected = (p.countries || []).includes(o.value);
  $("#p-remote").checked = !!p.remoteOk;
  $("#p-hours").value = p.hours;
  $("#p-hours-out").value = p.hours;
  $("#p-known").replaceChildren(...state.graph.skills.filter((s) => s.id !== "portfolio").map((s) => {
    const on = (p.known || []).includes(s.id);
    return el("button", {
      type: "button", class: `chip${on ? " on" : ""}`, "aria-pressed": String(on),
      onclick: (e) => {
        const k = new Set(p.known || []);
        if (k.has(s.id)) k.delete(s.id); else k.add(s.id);
        p.known = [...k];
        e.currentTarget.classList.toggle("on");
        e.currentTarget.setAttribute("aria-pressed", String(k.has(s.id)));
        store.set("profile", p);
        renderForYou();
      },
    }, s.name.split(/[:,]| and /)[0].trim());
  }));
}

function readResume() {
  const text = $("#p-resume").value;
  store.set("resume", text);
  const found = detectSkills(text);
  const p = state.profile;
  const before = new Set(p.known || []);
  p.known = [...new Set([...(p.known || []), ...found])];
  store.set("profile", p);
  fillProfile();
  renderForYou();
  const added = found.filter((s) => !before.has(s)).length;
  toast(found.length ? `Found ${found.length} skills (${added} new). Matches updated.` : "No skills found. Paste the skills and projects part of your resume.");
}

function renderForYou() {
  const p = state.profile;
  const recs = recommend(state.jobs, p, 60);
  const week = recs.filter((r) => today() - r.j.d <= 7);
  const total = recommend(state.jobs, p, 100000).length;
  const goal = TRACKS[p.tracks[0]] || "AI";
  const shareText = `I found ${fmt(total)} ${goal} ${p.kind === "new-grad" ? "new-grad roles" : p.kind === "internship" ? "internships" : "roles"} that fit me on Ada, ${week.length} posted this week. Free and open source: ${location.origin}${location.pathname}`;
  $("#digest").replaceChildren(
    el("div", {},
      el("h2", {}, `${fmt(total)} roles fit you`),
      el("div", { class: "muted" }, `${week.length} of your top matches were posted in the last 7 days. Get new roles in any RSS reader: `, el("a", { href: "data/feed.xml" }, "RSS feed"), "."),
    ),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", onclick: () => copy(weeklyDigest(recs), "This week's digest copied") }, "Copy weekly digest"),
      el("button", { class: "btn", onclick: () => copy(shareText, "Copied. Paste it anywhere.") }, "Share"),
    ),
  );
  const ul = $("#matches");
  ul.replaceChildren(...recs.slice(0, 40).map((r) => jobCard(r.j, r.why)));
  if (!recs.length) ul.append(el("li", { class: "empty" }, "No strong matches yet. Add a country, allow remote, or pick a second role."));
}

function weeklyDigest(recs) {
  const lines = recs.filter((r) => today() - r.j.d <= 7).slice(0, 15)
    .map((r) => `• ${r.j.c}: ${r.j.t} (${r.j.l[0] || "location not listed"})\n  ${r.j.u}`);
  return `My AI roles this week (via Ada)\n\n${lines.join("\n") || "No new matches this week."}`;
}

/* ---------- Roadmap ---------- */
function demandMap() {
  return state.stats?.skills || {};
}

function renderRoadmap() {
  const shared = state.sharedView;
  const p = shared || state.profile;
  const track = $("#rm-track").value || p.tracks[0] || "mle";
  const progressKey = track;
  const done = new Set(shared ? (shared.done || []) : [...(p.known || []), ...(state.progress[progressKey] || [])]);
  const plan = planRoadmap(state.graph, track, [...done], p.hours || 10, demandMap());
  const total = plan.steps.length;
  const doneN = plan.steps.filter((s) => s.done).length;
  const openRoles = state.jobs.filter((j) => j.tr === track).length;
  $("#rm-title").textContent = shared ? `${shared.name ? shared.name + "'s" : "A shared"} roadmap: ${TRACKS[track]}` : `Your roadmap: ${TRACKS[track]}`;
  $("#rm-sub").textContent = `${fmt(openRoles)} open ${TRACKS[track]} roles right now. ${plan.totalWeeks ? `About ${plan.totalWeeks} weeks at ${p.hours || 10} hours a week.` : "You've covered every skill on this path."}`;

  const pct = total ? doneN / total : 0;
  const r = 26, c = 2 * Math.PI * r;
  $("#rm-ring").innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="url(#rg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}" transform="rotate(-90 32 32)"/><defs><linearGradient id="rg"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient></defs></svg>`;
  $("#rm-ring").append(el("div", {}, el("b", {}, `${Math.round(pct * 100)}%`), el("span", { class: "muted" }, `${doneN} of ${total} skills`)));

  const st = state.streak;
  const alive = st.last >= today() - 1;
  $("#rm-streak").replaceChildren(el("div", {},
    el("b", {}, `🔥 ${alive ? st.streak || 0 : 0} day${(alive ? st.streak : 0) === 1 ? "" : "s"}`),
    el("span", { class: "muted" }, `Best ${st.best || 0}. `),
    shared ? null : el("button", { class: "link", onclick: () => { state.streak = checkIn(state.streak, today()); store.set("streak", state.streak); toast("Checked in. Keep the streak going."); renderRoadmap(); } }, st.last === today() ? "Checked in today" : "I studied today"),
  ));
  const facts = { done: doneN, total, best: st.best || 0, saved: state.saved.size };
  $("#rm-badges").replaceChildren(...BADGES.map((b) => el("span", { class: `badge${b.test(facts) ? " on" : ""}` }, (b.test(facts) ? "🏅 " : "") + b.name)));

  renderCoach();
  const savedPlan = shared ? "" : store.get(`plan:${track}`, "");
  if (savedPlan && !$("#coach-run").disabled) $("#coach-out").innerHTML = renderMarkdown(savedPlan);
  else if (!$("#coach-run").disabled) $("#coach-out").innerHTML = "";
  $("#rm-steps").replaceChildren(...plan.steps.map((s) => {
    const box = el("input", { type: "checkbox", checked: s.done, disabled: !!shared });
    box.addEventListener("change", () => {
      const list = new Set(state.progress[progressKey] || []);
      if (box.checked) list.add(s.id); else list.delete(s.id);
      state.progress[progressKey] = [...list];
      store.set("progress", state.progress);
      if (box.checked) { state.streak = checkIn(state.streak, today()); store.set("streak", state.streak); toast(`Nice. ${s.name} done.`); }
      renderRoadmap();
    });
    const demand = s.demand != null && s.id !== "python" && s.id !== "portfolio"
      ? el("div", { class: "demand" }, `Core skill in ${Math.round(s.demand * 100)}% of open roles we track`) : null;
    return el("li", { class: `step${s.done ? " done" : ""}` },
      el("div", { class: "step-head" },
        el("div", {},
          el("div", { class: "when" }, s.done ? "Done" : s.start === s.end ? `Week ${s.start}` : `Weeks ${s.start}–${s.end}`),
          el("h3", {}, s.name)),
        el("label", { class: "toggle" }, box, "Done")),
      el("ul", {}, s.learn.map(([name, url]) => el("li", {}, el("a", { href: url, target: "_blank", rel: "noopener" }, name)))),
      el("div", { class: "project" }, el("b", {}, "Build: "), s.project),
      demand,
    );
  }));
}

function renderCoach() {
  const box = $("#coach");
  if (state.sharedView) { box.hidden = true; return; }
  box.hidden = false;
  if (!$("#coach-key").value) $("#coach-key").value = store.get("key", "") || sessionKey || "";
  $("#coach-remember").checked = !!store.get("key", "");
}

let sessionKey = "";
async function runCoachClick() {
  const key = $("#coach-key").value.trim();
  const out = $("#coach-out");
  if (!/^sk-ant-/.test(key)) { out.innerHTML = '<p class="err">Paste an Anthropic API key. It starts with sk-ant-.</p>'; return; }
  sessionKey = key;
  if ($("#coach-remember").checked) store.set("key", key); else store.set("key", "");
  const track = $("#rm-track").value;
  const p = state.profile;
  const known = [...new Set([...(p.known || []), ...(state.progress[track] || [])])];
  const prompt = buildPrompt({
    profile: { ...p, known }, trackName: TRACKS[track],
    roadmap: planRoadmap(state.graph, track, known, p.hours || 10, demandMap()),
    matches: recommend(state.jobs, { ...p, tracks: [track, ...(p.tracks || []).filter((t) => t !== track)] }, 20),
    demand: demandMap(), resume: store.get("resume", ""),
  });
  const btn = $("#coach-run");
  btn.disabled = true;
  btn.textContent = "Writing your plan…";
  let text = "";
  out.innerHTML = '<p class="muted">Claude is reading your profile and today\'s openings…</p>';
  try {
    await runCoach({ key, prompt, onText: (t) => { text += t; out.innerHTML = renderMarkdown(text); } });
    store.set(`plan:${track}`, text);
    toast("Your plan is ready");
  } catch (e) {
    out.innerHTML = `<p class="err">${friendlyError(e).replace(/</g, "&lt;")}</p>` + (text ? renderMarkdown(text) : "");
  } finally {
    btn.disabled = false;
    btn.textContent = "Write my 90-day plan";
  }
}

function shareRoadmap() {
  const track = $("#rm-track").value;
  const p = state.profile;
  const payload = { t: track, hours: p.hours, done: [...new Set([...(p.known || []), ...(state.progress[track] || [])])] };
  const url = `${location.origin}${location.pathname}#roadmap/${encodeProfile(payload)}`;
  copy(`Here's my ${TRACKS[track]} roadmap, built from ${fmt(state.jobs.length)} open AI roles: ${url}`, "Roadmap link copied");
}

/* ---------- Programs ---------- */
// Days until a program's application deadline (null when it has none). Closed programs are hidden.
function daysLeft(p) {
  if (!p.dl) return null;
  return Math.round((Date.parse(`${p.dl}T23:59:59`) - Date.now()) / 864e5);
}

function closing(p) {
  const d = daysLeft(p);
  if (d == null || d > 21) return null;
  return el("span", { class: "tag soon" }, d === 0 ? "Closes today" : d === 1 ? "Closes tomorrow" : `Closes in ${d} days`);
}

function renderPrograms() {
  const open = state.programs.filter((p) => (daysLeft(p) ?? 0) >= 0);
  const types = ["all", ...Object.keys(PROGRAM_TYPES).filter((t) => t !== "all" && open.some((p) => p.type === t))];
  $("#prog-types").replaceChildren(...types.map((t) => el("button", {
    class: state.progType === t ? "on" : "", role: "tab", "aria-selected": String(state.progType === t),
    onclick: () => { state.progType = t; renderPrograms(); },
  }, `${PROGRAM_TYPES[t]}${t === "all" ? "" : ` (${open.filter((p) => p.type === t).length})`}`)));
  const list = open.filter((p) => state.progType === "all" || p.type === state.progType);
  $("#programs").replaceChildren(...list.map((p) => el("li", { class: "card" },
    logo(p.org),
    el("div", {},
      el("h3", {}, el("a", { href: p.url, target: "_blank", rel: "noopener" }, p.title)),
      el("div", { class: "meta" }, el("b", {}, p.org), el("span", {}, p.where), el("span", {}, p.timing)),
      el("p", { class: "muted", style: "margin:6px 0 0" }, p.summary),
      el("div", { class: "tags" },
        el("span", { class: "tag track" }, PROGRAM_TYPES[p.type].replace(/s$/, "")),
        el("span", { class: "tag" }, p.who),
        p.amount ? el("span", { class: "tag pay" }, p.amount) : null,
        closing(p)),
    ),
    el("div", { class: "side" }, el("a", { class: "btn", href: p.url, target: "_blank", rel: "noopener" }, "Visit"), reportLink(p.title, p.url)),
  )));
}

/* ---------- Trends ---------- */
function bars(rows, max, fmtV = fmt) {
  return el("div", { class: "bars" }, rows.map(([label, v]) => {
    const fill = el("div", { class: "fill" });
    fill.style.width = `${Math.max(2, (v / max) * 100)}%`;
    return el("div", { class: "bar" }, el("span", { class: "lbl", title: label }, label), el("div", { class: "track-bg" }, fill), el("span", {}, fmtV(v)));
  }));
}

function renderTrends() {
  const s = state.stats;
  const tracks = [...s.tracks].sort((a, b) => b[2] - a[2]);
  const skills = Object.entries(s.skills).filter(([k]) => k !== "python" && SKILL_NAMES[k]).map(([k, v]) => [SKILL_NAMES[k], v]);
  const paid = state.jobs.filter((j) => j.p).sort((a, b) => b.p - a.p);
  const payRows = [];
  const seenPay = new Set();
  for (const j of paid) {  // one row per company and title, so a role listed in many cities shows once
    const k = `${j.c}|${j.t}`;
    if (seenPay.has(k)) continue;
    seenPay.add(k);
    payRows.push([`${j.c} · ${j.t}`, j.p]);
    if (payRows.length === 10) break;
  }
  const w = s.weekly;
  const maxW = Math.max(...w.map((x) => x.n), 1);
  const bw = 100 / w.length;
  const spark = `<svg class="spark" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="New roles per week, last 12 weeks">${w.map((x, i) => `<rect class="${i === w.length - 1 ? "now" : ""}" x="${i * bw + bw * 0.15}" y="${50 - (x.n / maxW) * 46}" width="${bw * 0.7}" height="${(x.n / maxW) * 46}" rx="0.8"><title>${x.weeks_ago === 0 ? "This week" : `${x.weeks_ago} weeks ago`}: ${x.n} roles</title></rect>`).join("")}</svg>`;
  const weekly = el("div", { class: "panel wide" }, el("h3", {}, "New roles per week"));
  weekly.insertAdjacentHTML("beforeend", spark);
  weekly.append(el("div", { class: "note" }, `${fmt(w[w.length - 1].n)} roles posted this week, by posting date. Last 12 weeks.`));
  $("#trends").replaceChildren(
    weekly,
    el("div", { class: "panel" }, el("h3", {}, "Open roles by career track"), bars(tracks.map((t) => [t[1], t[2]]), tracks[0][2])),
    el("div", { class: "panel" }, el("h3", {}, "Skills employers ask for"), bars(skills.slice(0, 10), skills[0]?.[1] || 1, (v) => `${Math.round(v * 100)}%`),
      el("div", { class: "note" }, "Share of open roles where the skill is core, read from job titles and role type.")),
    el("div", { class: "panel" }, el("h3", {}, "Best paying roles, where pay is published"), bars(payRows, payRows[0]?.[1] || 1, (v) => `$${Math.round(v)}/hr`),
      el("div", { class: "note" }, `Hourly, with yearly salaries divided by 2,080 hours. Only ${fmt(paid.length)} of ${fmt(state.jobs.length)} roles publish pay, so this is a guide, not the whole market.`)),
    el("div", { class: "panel" }, el("h3", {}, "Most hiring right now"), bars(s.top_companies.slice(0, 12), s.top_companies[0][1])),
    el("div", { class: "panel" }, el("h3", {}, "Where the roles are"), bars(s.countries.filter((c) => c[0] !== "Unknown").slice(0, 10), s.countries[0][1]),
      el("div", { class: "note" }, `${(s.remote_share * 100).toFixed(1)}% of roles are listed as remote.`)),
  );
}

/* ---------- Saved ---------- */
function renderSaved() {
  const list = state.jobs.filter((j) => state.saved.has(j.id));
  $("#saved-sum").textContent = list.length ? `${list.length} saved role${list.length === 1 ? "" : "s"}` : "";
  const ul = $("#saved");
  ul.replaceChildren(...list.map((j) => jobCard(j)));
  if (!list.length) ul.append(el("li", { class: "empty" }, "Tap ☆ on any role to save it here."));
}

function exportCsv() {
  const list = state.jobs.filter((j) => state.saved.has(j.id));
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [["Company", "Title", "Type", "Location", "Posted", "Link"], ...list.map((j) => [j.c, j.t, j.k, j.l.join("; "), new Date(j.d * 864e5).toISOString().slice(0, 10), j.u])];
  const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "ada-saved-roles.csv" });
  document.body.append(a); a.click(); a.remove();
}

function updateSavedCount() { $("#saved-count").textContent = state.saved.size || ""; }

/* ---------- Routing ---------- */
const VIEWS = ["explore", "foryou", "roadmap", "programs", "trends", "saved"];
function route() {
  const [view, arg] = (location.hash.slice(1) || "explore").split("/");
  const v = VIEWS.includes(view) ? view : "explore";
  state.sharedView = null;
  if (v === "roadmap" && arg) {
    const p = decodeProfile(arg);
    if (p && TRACKS[p.t]) { state.sharedView = { ...p, tracks: [p.t] }; $("#rm-track").value = p.t; }
  }
  for (const n of VIEWS) $(`#view-${n}`).hidden = n !== v;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.view === v));
  document.body.classList.toggle("compact", v !== "explore");
  scrollTo(0, 0);
  ({ explore: renderExplore, foryou: renderForYou, roadmap: renderRoadmap, programs: renderPrograms, trends: renderTrends, saved: renderSaved })[v]();
}

/* ---------- Boot ---------- */
function options(sel, rows, first) {
  sel.replaceChildren(...(first ? [el("option", { value: first[0] }, first[1])] : []), ...rows.map(([v, l]) => el("option", { value: v }, l)));
}

function initTheme() {
  const saved = store.get("theme", null);
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").textContent = saved === "light" ? "☾" : "☀";
  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    $("#theme").textContent = next === "light" ? "☾" : "☀";
    store.set("theme", next);
  });
}

function renderStats() {
  const s = state.stats;
  $("#stats").replaceChildren(
    el("div", { class: "stat" }, el("b", {}, fmt(s.total)), el("span", {}, "open AI roles")),
    el("div", { class: "stat" }, el("b", {}, fmt(s.new_7d)), el("span", {}, "posted this week")),
    el("div", { class: "stat" }, el("b", {}, fmt(s.companies)), el("span", {}, "companies hiring")),
    el("div", { class: "stat" }, el("b", {}, fmt(state.programs.filter((p) => (daysLeft(p) ?? 0) >= 0).length)), el("span", {}, "hackathons, fellowships and grants")),
  );
}

/* ---------- Optional sign-in ---------- */
function syncedState() {
  return { saved: [...state.saved], profile: state.profile, progress: state.progress, streak: state.streak,
    resume: store.get("resume", ""), updated: store.get("updated", 0) };
}

function applySynced(m) {
  state.saved = new Set(m.saved); state.profile = m.profile; state.progress = m.progress; state.streak = m.streak;
  for (const k of sync.SYNCED) store.set(k, k === "saved" ? m.saved : m[k], true);
  store.set("updated", m.updated, true);
  $("#p-resume").value = m.resume || "";
  fillProfile(); updateSavedCount();
  if (state.jobs.length) route();
}

function initAccount() {
  const btn = $("#account"), dlg = $("#account-dlg");
  if (!sync.enabled) return;
  btn.hidden = false;
  const show = (user) => {
    btn.textContent = user ? "✓ Synced" : "Sign in";
    btn.title = user ? `Signed in as ${user.email || "you"}` : "Sign in to sync across devices";
    $("#acct-out").hidden = !!user; $("#acct-in").hidden = !user;
    $("#acct-who").textContent = user?.email || "";
    $("#profile-note").textContent = user ? "Synced to your account, so it follows you to any device." : "Stays in your browser. Nothing is sent anywhere.";
    $("#p-alerts").checked = !!(user && state.profile.alerts);
    $("#alerts-note").textContent = user ? `Sent to ${user.email}. One email a week, unsubscribe in one click.` : "Free. Sign in with your email to turn it on.";
  };
  $("#alerts-box").hidden = false;
  $("#p-alerts").addEventListener("change", (e) => {
    if (!sync.currentUser()) { e.target.checked = false; dlg.showModal(); return; }
    const p = state.profile;
    p.alerts = e.target.checked;
    if (p.alerts && !p.alertToken) p.alertToken = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("profile", p);
    toast(p.alerts ? "Done. Your first email comes Monday." : "Weekly emails turned off");
  });
  const unsub = new URLSearchParams(location.search).get("unsubscribe");
  if (unsub) {
    sync.unsubscribe(unsub)
      .then((ok) => toast(ok ? "You're unsubscribed. No more weekly emails." : "That unsubscribe link has already been used."))
      .catch(() => toast("Could not unsubscribe. Try again, or turn emails off in For you."));
    history.replaceState(null, "", location.pathname + location.hash);
  }
  btn.addEventListener("click", () => dlg.showModal());
  $("#acct-email-go").addEventListener("click", async () => {
    const email = $("#acct-email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter your email first");
    try { await sync.signInWithEmail(email); $("#acct-msg").textContent = `Check ${email} for a sign-in link.`; }
    catch (e) { $("#acct-msg").textContent = `Could not send the link: ${e.message}`; }
  });
  $("#acct-github").hidden = !sync.github;
  $("#acct-github").addEventListener("click", () => sync.signInWithGitHub().catch((e) => { $("#acct-msg").textContent = e.message; }));
  $("#acct-signout").addEventListener("click", async () => { await sync.signOut(); dlg.close(); toast("Signed out. Your data stays on this device."); });
  $("#acct-delete").addEventListener("click", async () => {
    if (!confirm("Delete your synced data from the cloud? This device keeps its copy.")) return;
    await sync.deleteMyData(); dlg.close(); toast("Cloud copy deleted");
  });
  show(null);
  sync.initSync({ read: syncedState, write: applySynced, onChange: show }).catch((e) => console.warn("Ada sync:", e.message));
}

async function boot() {
  initTheme();
  initAccount();
  const get = (f) => fetch(`data/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });
  // Small files first so the page paints right away; the big role list follows.
  const big = get("opportunities.json");
  big.catch(() => {});  // reported below if it fails
  let opp;
  try {
    let latest;
    [state.programs, state.graph, state.stats, latest] = await Promise.all([get("programs.json"), get("skills.json"), get("stats.json"), get("latest.json").catch(() => null)]);
    renderStats();
    if (latest && (location.hash.slice(1) || "explore") === "explore" && !location.search) {
      for (const s of state.graph.skills) SKILL_NAMES[s.id] = s.name;
      $("#view-explore").hidden = false;
      $("#count").textContent = `Newest roles · loading all ${fmt(state.stats.total)}…`;
      $("#results").replaceChildren(...unpackJobs(latest).map((j) => jobCard(j)));
    }
    opp = await big;
  } catch (e) {
    $("#stats").replaceChildren(el("div", { class: "empty" }, `Could not load data (${e.message}). Run "python -m pipeline.build" or refresh.`));
    return;
  }
  state.jobs = unpackJobs(opp);
  for (const s of state.graph.skills) SKILL_NAMES[s.id] = s.name;
  const s = state.stats;
  $("#updated").textContent = `Updated ${new Date(opp.updated * 1000).toLocaleString()}`;

  const trackRows = Object.entries(TRACKS);
  options($("#f-track"), trackRows, ["any", "Any role"]);
  options($("#rm-track"), trackRows);
  options($("#p-track"), trackRows);
  options($("#p-track2"), trackRows, ["none", "None"]);
  options($("#f-skill"), state.graph.skills.filter((k) => !["portfolio", "git", "research", "ml", "rag", "quantfin"].includes(k.id)).map((k) => [k.id, k.name]), ["any", "Any skill"]);
  const countries = s.countries.map((c) => c[0]).filter((c) => c !== "Unknown");
  const allCountries = [...new Set([...countries, ...state.jobs.flatMap((j) => j.co)])].filter((c) => c !== "Unknown");
  options($("#f-country"), allCountries.map((c) => [c, c]), ["any", "Any country"]);
  options($("#p-countries"), allCountries.map((c) => [c, c]));
  $("#rm-track").value = state.profile.tracks[0] || "mle";
  fillProfile();

  applySearchParams(new URLSearchParams(location.search));
  let timer;
  const rerun = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.shown = 40; renderExplore(); }, e?.target?.id === "q" ? 120 : 0);
  };
  $("#filters").addEventListener("input", rerun);
  $("#more").addEventListener("click", () => { state.shown += 60; renderExplore(); });
  $("#share-search").addEventListener("click", () => copy(`${location.origin}${location.pathname}?${searchParams()}#explore`, "Search link copied"));
  $("#profile").addEventListener("input", (e) => {
    if (e.target.id === "p-resume" || e.target.id === "p-alerts") return;
    if (e.target.id === "p-hours") $("#p-hours-out").value = e.target.value;
    readProfile();
    renderForYou();
  });
  $("#rm-track").addEventListener("change", () => { if (state.sharedView) location.hash = "roadmap"; else renderRoadmap(); });
  $("#rm-share").addEventListener("click", shareRoadmap);
  $("#export").addEventListener("click", exportCsv);
  $("#p-resume").value = store.get("resume", "");
  $("#p-read").addEventListener("click", readResume);
  $("#coach-run").addEventListener("click", runCoachClick);
  $("#coach-model").textContent = MODEL;
  addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      if (location.hash && location.hash !== "#explore") location.hash = "explore";
      setTimeout(() => $("#q").focus(), 0);
    }
  });
  if (!store.get("toured", false)) {
    $("#tour").hidden = false;
    $("#tour-close").addEventListener("click", () => { $("#tour").hidden = true; store.set("toured", true); });
  }
  updateSavedCount();
  addEventListener("hashchange", route);
  route();
}

boot();
// Cache the app for instant repeat visits and offline use (only when served over http(s), not file://).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
