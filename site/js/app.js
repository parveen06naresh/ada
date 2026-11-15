import {
  BADGES, FIELDS, TRACKS, checkIn, fieldOf, tracksIn, decodeProfile, detectSkills, encodeProfile, filterJobs, planRoadmap, recommend, today, unpackJobs,
} from "./match.js";
import { MODEL, buildPrompt, friendlyError, renderMarkdown, runCoach } from "./coach.js";
import * as sync from "./sync.js";
import { fileToText } from "./upload.js";
import { useJobs, useResumeTerms, adaScore, bestTracks, fitJob, gapPlan, parseResume, profileFromResume, rankByFit, resumeChecks, useGraph } from "./resume.js";

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
const SHORT = { python: "Python", git: "Git", math: "Math", stats: "Statistics", sql: "SQL", ml: "ML", pytorch: "PyTorch", llms: "LLMs", rag: "RAG and agents", cv: "Computer vision", nlp: "NLP", rl: "RL", cpp: "C++", cuda: "CUDA", distributed: "Distributed systems", mlops: "MLOps", research: "Research", quantfin: "Markets", dsa: "Algorithms", web: "Web apps", cloud: "Cloud", excel: "Excel", finmodel: "Financial modeling", accounting: "Accounting", casework: "Case work", digital: "Digital marketing", sales: "Sales and CRM", design: "UX design", productsense: "Product sense", circuits: "Circuits", cad: "CAD", embedded: "Embedded", supplychain: "Supply chain", people: "HR", lab: "Lab skills", clinical: "Clinical" };
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
  parsed: null,
  mShown: 30,
  tracker: store.get("tracker", {}),
};

/* ---------- Free account gate ---------- */
// Browsing and your Ada score are open to everyone. The full match list, the skill plan, saving,
// tracking and weekly email need a free account. If sign-in can't load, nothing is locked.
const locked = () => sync.gate && sync.authStatus() !== "off" && !sync.currentUser();
const ASKS = {
  signup: ["Create your free Ada account", "One account turns Ada from a job list into your job search."],
  login: ["Welcome back", "Log in to see your matches, saved roles and applications."],
  save: ["Save it to your free account", "Saved roles follow you to every device, and you can track each one from applied to offer."],
  match: ["See every role you fit", "Your full ranked list and skill plan are one free account away. It takes 20 seconds."],
  plan: ["Unlock your skill plan", "See the skills that would raise your fit on the most roles, with hours and a free place to start."],
  alerts: ["Get your weekly matches", "Every Monday, only the new roles you fit. One click to unsubscribe."],
};
const acct = { mode: "signup", why: "signup", magic: false };
function acctPanel(name) {
  for (const id of ["out", "sent", "reset", "in"]) $(`#acct-${id}`).hidden = id !== name;
}
function setMode(mode, why = acct.why) {
  acct.mode = mode; acct.why = why;
  const [title, sub] = mode === "login" ? ASKS.login : (ASKS[why] || ASKS.signup);
  $("#acct-title").textContent = acct.magic ? (mode === "login" ? "Log in with an email link" : title) : title;
  $("#acct-why").textContent = acct.magic ? "We'll email you a one-tap link. No password needed." : sub;
  $("#acct-perks").hidden = mode === "login" || acct.magic;
  for (const b of document.querySelectorAll(".acct-tabs button")) {
    const on = b.dataset.mode === mode;
    b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
  }
  $("#acct-pw-row").hidden = acct.magic;
  $("#acct-pw").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#acct-pw").placeholder = mode === "login" ? "Your password" : "At least 8 characters";
  $("#acct-go").textContent = acct.magic ? "Email me a link" : mode === "login" ? "Log in" : "Create account";
  $("#acct-forgot").hidden = mode !== "login" || acct.magic;
  $("#acct-magic").textContent = acct.magic ? "Use a password instead" : "Email me a sign-in link instead";
  $("#acct-msg").textContent = "";
}
function askSignup(why = "signup", pending = null) {
  acct.magic = false;
  setMode(why === "login" ? "login" : "signup", why);
  acctPanel("out");
  store.set("pending", pending);
  if (!$("#account-dlg").open) $("#account-dlg").showModal();
  setTimeout(() => $("#acct-email").focus(), 50);
}
const STAGES = [["saved", "Saved"], ["applied", "Applied"], ["interview", "Interviewing"], ["offer", "Offer"], ["closed", "Closed"]];
const stageOf = (id) => { const s = state.tracker[id]?.s; return s && s !== "removed" ? s : "saved"; };
// A small copy of each saved role, so it stays on your board after the listing closes and drops out of the feed.
const snap = (j) => ({ t: j.t, c: j.c, u: j.u, l: j.l.slice(0, 3), k: j.k, dm: j.dm || null, tr: j.tr, d: j.d });
const jobById = (id) => state.byId?.get(id) || null;
function setStage(id, s) {
  const prev = state.tracker[id] || {};
  const j = jobById(id);
  state.tracker[id] = { ...prev, s, t: Date.now(), ...(s === "applied" && !prev.a ? { a: Date.now() } : {}), ...(j ? { j: snap(j) } : {}) };
  store.set("tracker", state.tracker);
}
function setNote(id, n) {
  state.tracker[id] = { ...(state.tracker[id] || { s: "saved" }), n: n.slice(0, 2000), t: Date.now() };
  store.set("tracker", state.tracker);
}
// Save or unsave. Unsaving leaves a dated marker so another device's older copy can't bring it back.
function toggleSave(id, on = !state.saved.has(id)) {
  const j = jobById(id);
  if (on) {
    state.saved.add(id);
    const prev = state.tracker[id];
    state.tracker[id] = { ...(prev && prev.s !== "removed" ? prev : { s: "saved" }), t: Date.now(), ...(j ? { j: snap(j) } : {}) };
  } else {
    state.saved.delete(id);
    state.tracker[id] = { s: "removed", t: Date.now() };
  }
  store.set("tracker", state.tracker);
  store.set("saved", [...state.saved]);
  updateSavedCount();
  return on;
}
// Saved roles, from the live feed when they're still listed, from the saved copy when they're not.
function savedJobs() {
  const out = [];
  for (const id of state.saved) {
    const live = jobById(id);
    const copy = state.tracker[id]?.j;
    if (live) out.push(live);
    else if (copy) out.push({ id, ...copy, l: copy.l || [], co: [], s: [], closed: true });
  }
  return out;
}

function toastAction(msg, label, fn) {
  const t = $("#toast");
  t.replaceChildren(el("span", {}, msg), el("button", { type: "button", class: "link", onclick: () => { t.classList.remove("show"); fn(); } }, label));
  t.classList.add("show");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("show"), 9000);
}

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

function fitRing(f) {
  const r = el("div", { class: "fit", title: `${f.fit}% fit`, "aria-label": `${f.fit} percent fit` }, el("span", {}, `${f.fit}%`));
  r.style.setProperty("--v", f.fit);
  r.style.setProperty("--c", f.fit >= 80 ? "var(--good)" : f.fit >= 60 ? "var(--accent2)" : "var(--warn)");
  return r;
}

function jobCard(j, why, f, track) {
  const on = state.saved.has(j.id);
  const save = el("button", { class: `save${on ? " on" : ""}`, title: on ? "Saved" : "Save", "aria-label": on ? "Unsave" : "Save", "aria-pressed": String(on) }, on ? "★" : "☆");
  save.addEventListener("click", (e) => {
    e.stopPropagation();
    if (locked() && !state.saved.has(j.id)) return askSignup("save", { save: j.id });
    const now = toggleSave(j.id);
    save.classList.toggle("on", now);
    save.textContent = now ? "★" : "☆";
    save.title = now ? "Saved" : "Save";
    save.setAttribute("aria-pressed", String(now));
    save.setAttribute("aria-label", now ? "Unsave" : "Save");
    toast(now ? "Saved. Track it under Applications." : "Removed from Applications");
  });
  const tags = el("div", { class: "tags" },
    el("span", { class: "tag track" }, TRACKS[j.tr]),
    el("span", { class: "tag" }, j.k === "internship" ? "Internship" : "New grad"),
    j.lv === "PhD" || j.lv === "Masters" ? el("span", { class: "tag" }, j.lv) : null,
    j.r ? el("span", { class: "tag" }, "Remote") : null,
    j.v ? el("span", { class: "tag visa", title: "The listing says the employer sponsors visas" }, "Sponsors visas") : null,
    today() - j.d <= 3 ? el("span", { class: "tag new" }, "New") : null,
    !f && state.parsed ? el("span", { class: "tag fitTag" }, `${fitJob(j, state.profile).fit}% fit`) : null,
    j.p ? el("span", { class: "tag pay" }, `$${Math.round(j.p)}/hr`) : null,
    j.closed ? el("span", { class: "tag closed", title: "No longer in today's listings. It may have closed." }, "No longer listed") : null,
    !track && on && stageOf(j.id) !== "saved" ? el("span", { class: `tag st s-${stageOf(j.id)}` }, STAGES.find((x) => x[0] === stageOf(j.id))[1]) : null,
  );
  const where = j.l.length ? j.l.slice(0, 2).join(" · ") + (j.l.length > 2 ? ` +${j.l.length - 2}` : "") : "Location not listed";
  const skills = f && (f.have.length || f.missing.length) ? el("div", { class: "skillrow" },
    ...f.have.map((s) => el("span", { class: "have" }, `✓ ${SHORT[s] || s}`)),
    ...f.missing.map((s) => el("span", { class: "miss" }, `+ ${SHORT[s] || s}`))) : null;
  return el("li", { class: `card${f ? " has-fit" : ""}` },
    f ? fitRing(f) : null,
    logo(j.c, j.dm),
    el("div", {},
      el("h3", {}, el("button", { type: "button", class: "title-btn", onclick: () => openJob(j) }, j.t)),
      el("div", { class: "meta" }, el("b", {}, j.c), el("span", {}, where), j.d ? el("span", {}, ago(j.d)) : null),
      tags,
      why && why.length ? el("div", { class: "why" }, "✓ " + why.join(" · ")) : null,
      skills,
    ),
    el("div", { class: "side" }, el("a", { class: "btn", href: j.u, target: "_blank", rel: "noopener", onclick: (e) => { e.stopPropagation(); appliedNudge(j); } }, "Apply"), save,
      track ? stagePicker(j.id) : null, reportLink(`${j.c}: ${j.t}`, j.u)),
  );
}

// After someone opens an application, offer to mark it applied when they come back to the tab.
function appliedNudge(j) {
  if (stageOf(j.id) !== "saved" && state.saved.has(j.id)) return;
  const back = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", back);
    toastAction(`Did you apply to ${j.c}?`, "Yes, track it", () => {
      if (locked()) return askSignup("save", { save: j.id });
      if (!state.saved.has(j.id)) toggleSave(j.id, true);
      setStage(j.id, "applied");
      toast("Marked as applied. See it under Applications.");
      if (location.hash.startsWith("#saved")) renderSaved();
    });
  };
  setTimeout(() => document.addEventListener("visibilitychange", back), 500);
}

/* ---------- Role detail ---------- */
function openJob(j, push = true) {
  const dlg = $("#job-dlg");
  const f = state.parsed && !j.closed ? fitJob(j, state.profile) : null;
  const saved = state.saved.has(j.id);
  const tr = state.tracker[j.id] || {};
  const others = state.jobs.filter((x) => x.c === j.c && x.id !== j.id).sort((a, b) => b.d - a.d).slice(0, 5);
  const similar = state.jobs.filter((x) => x.tr === j.tr && x.c !== j.c && x.k === j.k)
    .map((x) => ({ x, f: state.parsed ? fitJob(x, state.profile).fit : 0 }))
    .sort((a, b) => b.f - a.f || b.x.d - a.x.d).slice(0, 4).map((r) => r.x);
  const mini = (x) => el("li", {}, el("button", { type: "button", class: "mini", onclick: () => openJob(x, false) },
    logo(x.c, x.dm), el("span", {}, el("b", {}, x.t), el("span", { class: "muted small" }, `${x.c} · ${x.l[0] || "Location not listed"} · ${ago(x.d)}`))));
  const stageRow = el("div", { class: "seg stages", role: "group", "aria-label": "Application status" }, STAGES.map(([v, label]) => el("button", {
    type: "button", class: saved && stageOf(j.id) === v ? "on" : "", "aria-pressed": String(saved && stageOf(j.id) === v),
    onclick: () => {
      if (locked()) return askSignup("save", { save: j.id });
      if (!state.saved.has(j.id)) toggleSave(j.id, true);
      setStage(j.id, v);
      if (v === "offer") toast("An offer! Congratulations 🎉");
      openJob(j, false);
      refreshBehind();
    },
  }, label)));
  const note = el("textarea", { rows: 3, placeholder: "Notes: referral, recruiter name, interview dates…", "aria-label": "Notes" });
  note.value = tr.n || "";
  note.addEventListener("input", () => { clearTimeout(note.h); note.h = setTimeout(() => { if (state.saved.has(j.id)) setNote(j.id, note.value); }, 400); });
  const saveBtn = el("button", { type: "button", class: `btn ghost${saved ? " on" : ""}`, onclick: () => {
    if (locked() && !saved) return askSignup("save", { save: j.id });
    toggleSave(j.id); openJob(j, false); refreshBehind();
  } }, saved ? "★ Saved" : "☆ Save");
  $("#job-body").replaceChildren(
    el("div", { class: "jd-head" }, logo(j.c, j.dm), el("div", {},
      el("p", { class: "muted small" }, j.c),
      el("h2", { id: "job-title" }, j.t),
      el("div", { class: "meta" }, el("span", {}, j.k === "internship" ? "Internship" : "New grad"), el("span", {}, j.l.length ? j.l.join(" · ") : "Location not listed"), j.d ? el("span", {}, `Posted ${ago(j.d)}`) : null))),
    el("div", { class: "tags" },
      TRACKS[j.tr] ? el("span", { class: "tag track" }, TRACKS[j.tr]) : null,
      j.lv && j.lv !== "Undergrad" ? el("span", { class: "tag" }, j.lv) : null,
      j.r ? el("span", { class: "tag" }, "Remote") : null,
      j.v ? el("span", { class: "tag visa" }, "Sponsors visas") : null,
      j.p ? el("span", { class: "tag pay" }, `$${Math.round(j.p)}/hr`) : null,
      j.closed ? el("span", { class: "tag closed" }, "No longer listed") : null),
    el("div", { class: "jd-actions" },
      el("a", { class: "btn", href: j.u, target: "_blank", rel: "noopener", onclick: () => appliedNudge(j) }, "Apply on company site ↗"),
      saveBtn,
      el("button", { type: "button", class: "btn ghost", onclick: () => copy(`${location.origin}${location.pathname}#job/${encodeURIComponent(j.id)}`, "Link copied") }, "Copy link")),
    f ? el("section", { class: "jd-sec" }, el("h3", {}, "How you fit"),
      el("div", { class: "jd-fit" }, fitRing(f), el("div", {},
        el("p", {}, f.fit >= 80 ? "Strong fit. Apply soon." : f.fit >= 60 ? "Good fit. Worth applying." : "A stretch for now. See what's missing below."),
        el("div", { class: "skillrow" }, ...f.have.map((x) => el("span", { class: "have" }, `✓ ${SHORT[x] || x}`)), ...f.missing.map((x) => el("span", { class: "miss" }, `+ ${SHORT[x] || x}`)))))) :
      !j.closed ? el("section", { class: "jd-sec muted small" }, "Add your resume on the Explore page to see how well you fit this role.") : null,
    el("section", { class: "jd-sec" }, el("h3", {}, "Your application"), stageRow,
      saved ? note : el("p", { class: "muted small" }, "Pick a status to add this role to your Applications board."),
      tr.a ? el("p", { class: "muted small" }, `Applied ${new Date(tr.a).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`) : null),
    others.length ? el("section", { class: "jd-sec" }, el("h3", {}, `More at ${j.c}`), el("ul", { class: "minis" }, others.map(mini))) : null,
    similar.length ? el("section", { class: "jd-sec" }, el("h3", {}, "Similar roles"), el("ul", { class: "minis" }, similar.map(mini))) : null,
    el("p", { class: "muted small jd-foot" }, "Ada lists roles from public trackers and employer career sites. Details can change, so check the company page before you apply. ", reportLink(`${j.c}: ${j.t}`, j.u)),
  );
  if (!dlg.open) dlg.showModal();
  $("#job-body").scrollTop = 0;
}
// Redraw the page under the role panel so saved stars and statuses match.
function refreshBehind() {
  updateSavedCount();
  const v = (location.hash.slice(1) || "explore").split("/")[0];
  if (v === "saved") renderSaved();
  else if (v === "explore" || v === "job") renderExplore();
  else if (v === "match") renderMatch();
}

/* ---------- Explore ---------- */
function readFilters() {
  return {
    text: $("#q").value.trim(),
    kind: $("#f-kind").value,
    field: $("#f-field").value,
    track: $("#f-track").value,
    skill: $("#f-skill").value,
    level: $("#f-level").value,
    country: $("#f-country").value,
    days: +$("#f-days").value || 0,
    remote: $("#f-remote").checked,
    visa: $("#f-visa").checked,
  };
}

const FILTER_LABELS = { kind: { internship: "Internships", "new-grad": "New grad" }, days: { 1: "Last 24 hours", 7: "Posted this week", 30: "Last 30 days" } };
function sortJobs(list, how) {
  if (how === "fit" && state.parsed) {
    const fit = new Map(list.map((j) => [j.id, fitJob(j, state.profile).fit]));
    return list.sort((a, b) => fit.get(b.id) - fit.get(a.id) || b.d - a.d);
  }
  if (how === "pay") return list.sort((a, b) => (b.p || 0) - (a.p || 0) || b.d - a.d);
  if (how === "company") return list.sort((a, b) => a.c.localeCompare(b.c) || b.d - a.d);
  return list.sort((a, b) => b.d - a.d);
}

function syncChips(q) {
  for (const c of document.querySelectorAll(".f-chips .chip[data-chip]")) {
    const [k, v] = c.dataset.chip.split(":");
    const on = v === undefined ? !!q[k] : String(q[k]) === v;
    c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on));
  }
  const adv = ["field", "track", "skill", "level", "country"].filter((k) => q[k] && q[k] !== "any").length;
  $("#f-n").textContent = adv || "";
  // Active filters as removable pills, with one tap to clear them all.
  const pills = [];
  const add = (label, clear) => pills.push(el("button", { type: "button", class: "fpill", "aria-label": `Remove filter ${label}`, onclick: () => { clear(); rerunExplore(); } }, label, " ✕"));
  if (q.text) add(`“${q.text}”`, () => { $("#q").value = ""; });
  if (q.kind !== "any") add(FILTER_LABELS.kind[q.kind], () => { $("#f-kind").value = "any"; });
  if (q.field !== "any") add(FIELDS[q.field], () => { $("#f-field").value = "any"; fillRoleFilter(); });
  if (q.track !== "any") add(TRACKS[q.track], () => { $("#f-track").value = "any"; });
  if (q.skill !== "any") add(SKILL_NAMES[q.skill]?.split(/[:,]| and /)[0] || q.skill, () => { $("#f-skill").value = "any"; });
  if (q.level !== "any") add(q.level, () => { $("#f-level").value = "any"; });
  if (q.country !== "any") add(q.country, () => { $("#f-country").value = "any"; });
  if (q.days) add(FILTER_LABELS.days[q.days], () => { $("#f-days").value = "0"; });
  if (q.remote) add("Remote", () => { $("#f-remote").checked = false; });
  if (q.visa) add("Sponsors visas", () => { $("#f-visa").checked = false; });
  if (pills.length > 1) pills.push(el("button", { type: "button", class: "link small", onclick: clearFilters }, "Clear all"));
  $("#active-f").replaceChildren(...pills);
}

function clearFilters() {
  $("#q").value = "";
  for (const id of ["#f-kind", "#f-field", "#f-skill", "#f-level", "#f-country"]) $(id).value = "any";
  fillRoleFilter(); $("#f-track").value = "any";
  $("#f-days").value = "0"; $("#f-remote").checked = false; $("#f-visa").checked = false;
  rerunExplore();
}

function rerunExplore() { state.shown = 40; renderExplore(); }

function renderExplore() {
  const q = readFilters();
  const how = $("#f-sort").value;
  const list = sortJobs(filterJobs(state.jobs, q), how);
  syncChips(q);
  $("#count").textContent = `${fmt(list.length)} open role${list.length === 1 ? "" : "s"}${how === "fit" && !state.parsed ? " · add your resume to sort by fit" : ""}`;
  const ul = $("#results");
  ul.replaceChildren(...list.slice(0, state.shown).map((j) => jobCard(j)));
  if (!list.length) ul.append(el("li", { class: "empty" }, "No roles match all of these filters. ", el("button", { type: "button", class: "link", onclick: clearFilters }, "Clear filters")));
  $("#more").hidden = list.length <= state.shown;
  $("#more").textContent = `Show more (${fmt(Math.max(0, list.length - state.shown))} left)`;
}

function searchParams() {
  const q = readFilters();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v && v !== "any" && v !== 0) p.set(k, v === true ? "1" : v);
  if ($("#f-sort").value !== "new") p.set("sort", $("#f-sort").value);
  return p;
}

function applySearchParams(p) {
  const set = (id, k) => { if (p.has(k)) $(id).value = p.get(k); };
  set("#q", "text"); set("#f-kind", "kind"); set("#f-field", "field"); fillRoleFilter(); set("#f-track", "track"); set("#f-skill", "skill");
  set("#f-level", "level"); set("#f-country", "country"); set("#f-days", "days"); set("#f-sort", "sort");
  $("#f-remote").checked = p.get("remote") === "1";
  $("#f-visa").checked = p.get("visa") === "1";
}

/* ---------- My matches (resume first) ---------- */
const STRONG = 75;
let ready;
const readyP = new Promise((ok) => { ready = ok; });

async function takeResume(getText) {
  const drop = $("#drop"), status = $("#drop-status");
  drop.classList.add("busy");
  status.textContent = "Reading your resume on this device…";
  try {
    const text = (await getText()).trim();
    const r = parseResume(text);
    if (text.split(/\s+/).length < 40 || r.skills.length < 1) throw new Error("We couldn't read much from that. If it's a scanned PDF, paste your resume as text instead.");
    status.textContent = "Matching you against every open role…";
    await readyP;
    store.set("resume", text);
    $("#p-resume").value = text;
    state.parsed = r;
    useResumeTerms(text);
    state.profile = profileFromResume(r, state.graph, state.profile);
    store.set("profile", state.profile);
    fillProfile();
    state.mShown = 30;
    status.textContent = "";
    $("#paste").hidden = true;
    $("#tour").hidden = true;
    store.set("toured", true);
    if (location.hash === "#match") renderMatch(); else location.hash = "match";
  } catch (e) {
    status.textContent = e.message;
    toast(e.message);
  } finally {
    drop.classList.remove("busy");
  }
}

function strongCount(p) {
  let n = 0, week = 0;
  for (const j of state.jobs) {
    if (fitJob(j, p).fit >= STRONG) { n++; if (today() - j.d <= 7) week++; }
  }
  return { n, week };
}

function renderMatch() {
  const has = !!state.parsed;
  $("#m-empty").hidden = has;
  $("#m-out").hidden = !has;
  if (!has || !state.jobs.length) return;
  const p = state.profile, r = state.parsed;
  const kind = p.kind || "any";
  const pool = kind === "any" ? state.jobs : state.jobs.filter((j) => j.k === kind);
  const ranked = rankByFit(pool, p, 2000);
  const checks = resumeChecks(r);
  const score = adaScore(ranked, checks);
  const { n, week } = strongCount({ ...p, kind });
  const tracks = bestTracks(state.graph, p.known || [], 3, r.major);
  const kindWord = kind === "internship" ? "internships" : kind === "new-grad" ? "new-grad roles" : "roles";
  state.card = { n, kindWord, top: ranked[0], score, track: TRACKS[p.tracks?.[0]] || tracks[0]?.name };

  const R = 56, C = 2 * Math.PI * R;
  const ring = el("div", { class: "big-ring" });
  ring.innerHTML = `<svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="66" cy="66" r="${R}" fill="none" stroke="url(#mg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * score / 100} ${C}" transform="rotate(-90 66 66)"/><defs><linearGradient id="mg"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient></defs></svg>`;
  ring.append(el("div", {}, el("b", {}, String(score)), el("span", {}, "Ada score")));
  const grad = r.grad ? `Graduating ${new Date(r.grad.y, r.grad.m - 1).toLocaleString("en-US", { month: "short", year: "numeric" })}` : null;
  $("#m-card").replaceChildren(
    ring,
    el("div", { class: "sc-main" },
      el("h2", {}, `${fmt(n)} ${kindWord} are a strong fit for you`),
      el("div", { class: "muted" }, `${fmt(week)} of them were posted this week. Your Ada score is 60% how well your skills fit your best 50 roles and 40% the resume checks you pass, so fixing your resume raises it.`),
      el("div", { class: "sc-facts" },
        el("span", { class: "tag" }, p.level === "New grad" ? "Bachelor's" : p.level === "Masters" ? "Master's" : p.level),
        grad ? el("span", { class: "tag" }, grad) : null,
        el("span", { class: "tag" }, `${(p.known || []).length} skills found`),
        el("a", { class: "tag track", href: "#foryou" }, "Edit what we read →")),
      el("div", { class: "sc-tracks" }, tracks.map((t) => {
        const fill = el("div", { class: "fill" });
        fill.style.width = `${Math.max(3, t.cover * 100)}%`;
        return el("div", { class: "sc-track" }, el("span", {}, t.name), el("div", { class: "track-bg" }, fill), el("b", {}, `${Math.round(t.cover * 100)}%`));
      })),
    ),
    el("div", { class: "actions" },
      el("button", { class: "btn", onclick: shareCard }, "Share my card"),
      el("button", { class: "btn ghost", onclick: () => $("#resume-file").click() }, "Try another resume")),
  );

  const gaps = gapPlan(state.jobs, p, state.graph, 4);
  $("#m-gaps").replaceChildren(
    el("h3", {}, "Raise your odds: learn these next"),
    el("p", { class: "muted small" }, "The skills you lack that the most of your target roles ask for. Each one you learn raises your fit on all of them."),
    ...(gaps.length ? gaps.map((g) => el("div", { class: "gap" },
      el("b", {}, g.name),
      el("span", { class: "plus" }, `${fmt(g.roles)} roles`),
      el("span", { class: "muted" }, `About ${g.hours} hours. `, g.learn ? el("a", { href: g.learn[1], target: "_blank", rel: "noopener" }, `Start: ${g.learn[0]}`) : null, " · ", el("a", { href: "#roadmap" }, "Full roadmap")),
    )) : [el("p", {}, "You already cover the core skills for your target roles. Ship a project that proves it.")]),
  );

  const passed = checks.filter((c) => c.ok).length;
  $("#m-checks").replaceChildren(
    el("h3", {}, `Resume fixes · ${passed} of ${checks.length} passed`),
    el("p", { class: "muted small" }, "What recruiters and applicant tracking systems check first. Fix the ⚠ ones before you apply."),
    el("ul", { class: "checks" }, checks.map((c) => el("li", { class: c.ok ? "ok" : "bad" },
      el("span", { class: "ic" }, c.ok ? "✓" : "⚠"),
      el("div", {}, el("b", {}, c.title), el("div", { class: "fix" }, c.fix))))),
  );

  $("#m-kind").replaceChildren(...[["internship", "Internships"], ["new-grad", "New grad"], ["any", "Both"]].map(([k, label]) => el("button", {
    class: kind === k ? "on" : "", role: "tab", "aria-selected": String(kind === k),
    onclick: () => { state.profile.kind = k; store.set("profile", state.profile); state.mShown = 30; fillProfile(); renderMatch(); },
  }, label)));
  const lock = locked();
  $("#m-gaps").classList.toggle("locked", lock);
  if (lock) $("#m-gaps").append(el("div", { class: "lock-over" }, el("button", { class: "btn", onclick: () => askSignup("plan", { view: "match" }) }, "🔒 Unlock my skill plan")));
  $("#m-list").replaceChildren(...ranked.slice(0, lock ? 3 : state.mShown).map((x) => jobCard(x.j, null, x)));
  $("#m-more").hidden = lock || ranked.length <= state.mShown;
  $("#m-lock").hidden = !lock;
  if (lock) {
    const peek = el("ul", { class: "cards peek", inert: true, "aria-hidden": "true" }, ranked.slice(3, 6).map((x) => jobCard(x.j, null, x)));
    $("#m-lock").replaceChildren(peek, el("div", { class: "unlock-cta" },
      el("h3", {}, `${fmt(Math.max(0, n - 3))} more strong matches are waiting`),
      el("p", { class: "muted" }, "Create a free account to see every role ranked by your fit, your skill plan, and to save and track applications. No password, about 20 seconds."),
      el("button", { class: "btn", onclick: () => askSignup("match", { view: "match" }) }, "Unlock all my matches, free"),
      el("button", { class: "link small", onclick: () => askSignup("login", { view: "match" }) }, "I already have an account")));
  }
}

// A share image with no personal details: counts and the top track only.
async function shareCard() {
  const c = state.card;
  const cv = document.createElement("canvas");
  cv.width = 1200; cv.height = 630;
  const g = cv.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, "#0b0920"); bg.addColorStop(1, "#071a24");
  g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
  const glow = g.createRadialGradient(1000, 80, 10, 1000, 80, 520);
  glow.addColorStop(0, "rgba(124,92,255,.45)"); glow.addColorStop(1, "rgba(124,92,255,0)");
  g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
  const font = (w, px) => `${w} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif`;
  g.fillStyle = "#7c5cff"; g.beginPath(); g.moveTo(80, 118); g.lineTo(104, 74); g.lineTo(128, 118); g.closePath(); g.fill();
  g.fillStyle = "#ecebf5"; g.font = font(700, 36); g.fillText("Ada", 144, 112);
  g.font = font(800, 96); g.fillText(`${fmt(c.n)} ${c.kindWord}`, 80, 290);
  g.fillStyle = "#9a98b3"; g.font = font(500, 40); g.fillText("are a strong fit for me right now.", 80, 350);
  const grad = g.createLinearGradient(80, 0, 700, 0);
  grad.addColorStop(0, "#7c5cff"); grad.addColorStop(1, "#22d3ee");
  g.fillStyle = grad; g.font = font(700, 40); g.fillText(`Best track: ${c.track}`, 80, 440);
  g.fillStyle = "#9a98b3"; g.font = font(500, 30); g.fillText(`Ada score ${c.score} · find yours free at parveen06naresh.github.io/ada`, 80, 550);
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
  const file = new File([blob], "my-ada-matches.png", { type: "image/png" });
  const text = `${fmt(c.n)} ${c.kindWord} are a strong fit for me right now. Find yours free: ${location.origin}${location.pathname}`;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch { /* cancelled */ }
  }
  const a = el("a", { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
  copy(text, "Card saved. Caption copied too.");
}

function initDrop() {
  const drop = $("#drop"), input = $("#resume-file");
  input.addEventListener("change", () => { const f = input.files[0]; if (f) takeResume(() => fileToText(f)); input.value = ""; });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) takeResume(() => fileToText(f)); });
  $("#paste-open").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); $("#paste").hidden = false; $("#paste-text").focus(); });
  $("#paste-cancel").addEventListener("click", () => { $("#paste").hidden = true; });
  $("#paste-go").addEventListener("click", () => takeResume(async () => $("#paste-text").value));
  $("#m-pick").addEventListener("click", () => input.click());
  $("#m-more").addEventListener("click", () => { state.mShown += 40; renderMatch(); });
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
  if (text.trim().split(/\s+/).length >= 40) { state.parsed = parseResume(text); useResumeTerms(text); }
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
  return `My best-fit roles this week (via Ada)\n\n${lines.join("\n") || "No new matches this week."}`;
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
  copy(`Here's my ${TRACKS[track]} roadmap, built from ${fmt(state.jobs.length)} open roles: ${url}`, "Roadmap link copied");
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
  const byField = {};
  for (const [k, , n] of s.tracks) byField[fieldOf(k)] = (byField[fieldOf(k)] || 0) + n;
  const fields = Object.entries(byField).sort((a, b) => b[1] - a[1]).map(([f, n]) => [FIELDS[f], n]);
  const aiTracks = s.tracks.filter((t) => fieldOf(t[0]) === "ai").sort((a, b) => b[2] - a[2]);
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
    el("div", { class: "panel" }, el("h3", {}, "Open roles by field"), bars(fields, fields[0][1])),
    el("div", { class: "panel" }, el("h3", {}, "Inside AI & Data"), bars(aiTracks.map((t) => [t[1], t[2]]), aiTracks[0][2])),
    el("div", { class: "panel" }, el("h3", {}, "Skills employers ask for"), bars(skills.slice(0, 10), skills[0]?.[1] || 1, (v) => `${Math.round(v * 100)}%`),
      el("div", { class: "note" }, "Share of open roles where the skill is core, read from job titles and role type.")),
    el("div", { class: "panel" }, el("h3", {}, "Best paying roles, where pay is published"), bars(payRows, payRows[0]?.[1] || 1, (v) => `$${Math.round(v)}/hr`),
      el("div", { class: "note" }, `Hourly, with yearly salaries divided by 2,080 hours. Only ${fmt(paid.length)} of ${fmt(state.jobs.length)} roles publish pay, so this is a guide, not the whole market.`)),
    el("div", { class: "panel" }, el("h3", {}, "Most hiring right now"), bars(s.top_companies.slice(0, 12), s.top_companies[0][1])),
    el("div", { class: "panel" }, el("h3", {}, "Where the roles are"), bars(s.countries.filter((c) => c[0] !== "Unknown").slice(0, 10), s.countries[0][1]),
      el("div", { class: "note" }, `${(s.remote_share * 100).toFixed(1)}% of roles are listed as remote.`)),
  );
}

/* ---------- Saved and tracked ---------- */
function stagePicker(id) {
  const sel = el("select", { class: `stage s-${stageOf(id)}`, "aria-label": "Application status" },
    STAGES.map(([v, label]) => el("option", { value: v, selected: stageOf(id) === v }, label)));
  sel.addEventListener("change", () => {
    setStage(id, sel.value);
    sel.className = `stage s-${sel.value}`;
    if (sel.value === "offer") toast("An offer! Congratulations 🎉");
    renderSaved();
  });
  return sel;
}

function renderPipeline(list) {
  const n = Object.fromEntries(STAGES.map(([v]) => [v, 0]));
  for (const j of list) n[stageOf(j.id)]++;
  $("#pipeline").hidden = !list.length;
  $("#pipeline").replaceChildren(...STAGES.map(([v, label]) => el("div", { class: `stage-box s-${v}` }, el("b", {}, String(n[v])), el("span", {}, label))));
}

function boardCard(j) {
  const tr = state.tracker[j.id] || {};
  const card = el("li", { class: `bcard${j.closed ? " is-closed" : ""}`, draggable: "true", "data-id": j.id },
    el("div", { class: "bc-top" }, logo(j.c, j.dm), el("div", {},
      el("button", { type: "button", class: "title-btn", onclick: () => openJob(j) }, j.t),
      el("div", { class: "muted small" }, j.c))),
    tr.n ? el("p", { class: "bc-note" }, tr.n.length > 90 ? tr.n.slice(0, 90) + "…" : tr.n) : null,
    el("div", { class: "bc-foot" },
      j.closed ? el("span", { class: "tag closed" }, "No longer listed") : el("span", { class: "muted small" }, tr.a ? `Applied ${new Date(tr.a).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : `Posted ${ago(j.d)}`),
      stagePicker(j.id)),
  );
  card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", j.id); card.classList.add("dragging"); });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  return card;
}

function renderSaved() {
  const list = savedJobs();
  const rank = Object.fromEntries(STAGES.map(([v], i) => [v, i]));
  list.sort((a, b) => rank[stageOf(b.id)] - rank[stageOf(a.id)] || (state.tracker[b.id]?.t || 0) - (state.tracker[a.id]?.t || 0));
  const active = list.filter((j) => ["applied", "interview"].includes(stageOf(j.id))).length;
  $("#saved-sum").textContent = list.length ? `${list.length} role${list.length === 1 ? "" : "s"} saved · ${active} in progress. Drag a card or pick a status to move it.` : "Save roles with ☆ and track each one from saved to offer.";
  renderPipeline(list);
  const mode = store.get("boardMode", "board");
  for (const b of document.querySelectorAll("#board-mode button")) b.classList.toggle("on", b.dataset.mode === mode);
  const ul = $("#saved"), board = $("#board");
  $("#export").hidden = !list.length;
  if (!list.length) {
    board.replaceChildren(); board.hidden = true;
    ul.replaceChildren(locked()
      ? el("li", { class: "empty big" },
        el("h2", {}, "Track every application in one place"),
        el("p", {}, "Save roles with ☆, then move each one from saved to applied, interviewing and offer, with notes. Free with an account."),
        el("button", { class: "btn", onclick: () => askSignup("save") }, "Create free account"))
      : el("li", { class: "empty big" },
        el("h2", {}, "No applications yet"),
        el("p", {}, "Tap ☆ on any role to save it here. When you apply, move it along: applied, interviewing, offer."),
        el("a", { class: "btn", href: "#explore" }, "Find roles")));
    return;
  }
  board.hidden = mode !== "board"; ul.hidden = mode === "board";
  if (mode === "list") { ul.replaceChildren(...list.map((j) => jobCard(j, null, null, true))); return; }
  ul.replaceChildren();
  board.replaceChildren(...STAGES.map(([v, label]) => {
    const items = list.filter((j) => stageOf(j.id) === v);
    const col = el("section", { class: `col s-${v}`, "aria-label": label },
      el("h3", {}, label, el("span", { class: "pill" }, String(items.length))),
      el("ul", {}, items.length ? items.map(boardCard) : el("li", { class: "col-empty muted small" }, v === "saved" ? "Saved roles land here" : "Drag a card here")));
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain");
      if (id && stageOf(id) !== v) { setStage(id, v); if (v === "offer") toast("An offer! Congratulations 🎉"); renderSaved(); }
    });
    return col;
  }));
}

function exportCsv() {
  const list = savedJobs();
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
  const rows = [["Company", "Title", "Type", "Location", "Status", "Applied", "Notes", "Link"],
    ...list.map((j) => [j.c, j.t, j.k, j.l.join("; "), STAGES.find((x) => x[0] === stageOf(j.id))[1], date(state.tracker[j.id]?.a), state.tracker[j.id]?.n || "", j.u])];
  const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "ada-applications.csv" });
  document.body.append(a); a.click(); a.remove();
}

function updateSavedCount() {
  const n = state.saved.size || "";
  $("#saved-count").textContent = n; $("#saved-count-m").textContent = n;
}

/* ---------- Routing ---------- */
const VIEWS = ["explore", "match", "foryou", "roadmap", "programs", "trends", "saved"];
function route() {
  const [view, arg] = (location.hash.slice(1) || "explore").split("/");
  if (view === "job" && arg) {
    const j = jobById(decodeURIComponent(arg));
    if ($("#view-explore").hidden) { for (const n of VIEWS) $(`#view-${n}`).hidden = n !== "explore"; renderExplore(); }
    if (j) openJob(j); else toast("That role is no longer listed.");
    return;
  }
  if ($("#job-dlg").open) $("#job-dlg").close();
  const v = VIEWS.includes(view) ? view : "explore";
  state.sharedView = null;
  if (v === "roadmap" && arg) {
    const p = decodeProfile(arg);
    if (p && TRACKS[p.t]) { state.sharedView = { ...p, tracks: [p.t] }; $("#rm-track").value = p.t; }
  }
  for (const n of VIEWS) $(`#view-${n}`).hidden = n !== v;
  $("#more-btn")?.classList.toggle("on", ["foryou", "roadmap", "trends"].includes(v));
  document.querySelectorAll(".tabs a, .bottom-nav a").forEach((a) => { a.classList.toggle("on", a.dataset.view === v); if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.body.classList.toggle("compact", v !== "explore");
  scrollTo(0, 0);
  ({ explore: renderExplore, match: renderMatch, foryou: renderForYou, roadmap: renderRoadmap, programs: renderPrograms, trends: renderTrends, saved: renderSaved })[v]();
}

/* ---------- Boot ---------- */
function options(sel, rows, first) {
  sel.replaceChildren(...(first ? [el("option", { value: first[0] }, first[1])] : []), ...rows.map(([v, l]) => el("option", { value: v }, l)));
}

// Every career track, grouped under its field.
function trackOptions(sel, first) {
  const groups = Object.entries(FIELDS).map(([f, name]) => {
    const ts = tracksIn(f);
    return ts.length === 1 ? el("option", { value: ts[0] }, name)
      : el("optgroup", { label: name }, ts.map((t) => el("option", { value: t }, TRACKS[t])));
  });
  sel.replaceChildren(...(first ? [el("option", { value: first[0] }, first[1])] : []), ...groups);
}

// The role filter only matters inside AI & Data, the one field with several tracks.
function fillRoleFilter() {
  const f = $("#f-field").value;
  const ts = f === "any" ? Object.keys(TRACKS) : tracksIn(f);
  const keep = $("#f-track").value;
  options($("#f-track"), ts.map((t) => [t, TRACKS[t]]), ["any", "Any role"]);
  $("#f-track").value = ts.includes(keep) ? keep : "any";
  $("#f-track").hidden = f !== "any" && ts.length < 2;
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
    el("div", { class: "stat" }, el("b", {}, fmt(s.total)), el("span", {}, "open roles in 10 fields")),
    el("div", { class: "stat" }, el("b", {}, fmt(s.new_7d)), el("span", {}, "posted this week")),
    el("div", { class: "stat" }, el("b", {}, fmt(s.companies)), el("span", {}, "companies hiring")),
    el("div", { class: "stat" }, el("b", {}, fmt(state.programs.filter((p) => (daysLeft(p) ?? 0) >= 0).length)), el("span", {}, "hackathons, fellowships and grants")),
  );
}

/* ---------- Optional sign-in ---------- */
function syncedState() {
  return { saved: [...state.saved], profile: state.profile, progress: state.progress, streak: state.streak, tracker: state.tracker,
    resume: store.get("resume", ""), updated: store.get("updated", 0) };
}

function applySynced(m) {
  state.saved = new Set(m.saved); state.profile = m.profile; state.progress = m.progress; state.streak = m.streak; state.tracker = m.tracker || {};
  for (const k of sync.SYNCED) store.set(k, k === "saved" ? m.saved : m[k], true);
  store.set("updated", m.updated, true);
  $("#p-resume").value = m.resume || "";
  fillProfile(); updateSavedCount();
  if (state.jobs.length) route();
}

function initAccount() {
  const btn = $("#account"), login = $("#login"), dlg = $("#account-dlg");
  if (!sync.enabled) return;
  btn.hidden = false; login.hidden = false;
  // A sign-in or reset link that failed (expired, already used) comes back with an error in the address.
  // Shown once we know whether this browser is already signed in.
  const bad = sync.linkError();
  if (bad) history.replaceState(null, "", location.pathname + "#explore");
  const linkProblem = (user) => {
    const msg = /expired|invalid/i.test(bad.code + bad.text) ? "That link has expired or was already used." : `That link didn't work: ${bad.text || bad.code}.`;
    if (user) { toast(`${msg} You're already signed in.`); return; }
    askSignup("login");
    $("#acct-msg").textContent = `${msg} Log in below, or ask for a new link.`;
  };
  const fillAccount = (user) => {
    $("#acct-who").textContent = user?.email || "";
    $("#acct-avatar").textContent = (user?.email || "?")[0].toUpperCase();
    $("#acct-n-saved").textContent = fmt(state.saved.size);
    $("#acct-n-apps").textContent = fmt(Object.values(state.tracker).filter((t) => ["applied", "interview"].includes(t.s)).length);
    $("#acct-alerts").textContent = state.profile.alerts ? "On, Mondays" : "Off";
  };
  const show = (user, event) => {
    btn.textContent = user ? (user.email || "Account")[0].toUpperCase() : "Sign up free";
    btn.classList.toggle("me", !!user);
    btn.title = user ? `Your account (${user.email || "signed in"})` : "Create your free account";
    btn.setAttribute("aria-label", user ? "Your account" : "Sign up free");
    login.hidden = !!user || sync.authStatus() === "off";
    btn.hidden = sync.authStatus() === "off";
    fillAccount(user);
    $("#profile-note").textContent = user ? "Synced to your account, so it follows you to any device." : "Stays in your browser. Nothing is sent anywhere.";
    $("#p-alerts").checked = !!(user && state.profile.alerts);
    $("#alerts-note").textContent = user ? `Sent to ${user.email}. One email a week, unsubscribe in one click.` : "Free with an account.";
    if (bad && event && event !== "OFF" && !acct.linkShown) { acct.linkShown = true; setTimeout(() => linkProblem(user), 0); }
    if (event === "PASSWORD_RECOVERY") {
      acctPanel("reset");
      if (!dlg.open) dlg.showModal();
      setTimeout(() => $("#reset-pw").focus(), 50);
      return;
    }
    if (user) finishPending(event);
    else if (dlg.open && !$("#acct-in").hidden) dlg.close();
    if (state.jobs.length && ["match", "saved"].includes(location.hash.slice(1))) route();
  };
  // Finish what the visitor was doing when we asked them to sign up (the link may open in a new tab).
  function finishPending(event) {
    const p = store.get("pending", null);
    store.set("pending", null);
    if (dlg.open && $("#acct-in").hidden && $("#acct-reset").hidden) dlg.close();
    if (p?.save && !state.saved.has(p.save)) { toggleSave(p.save, true); }
    if (p?.view && location.hash.slice(1) !== p.view) location.hash = p.view;
    if (event === "SIGNED_IN" && (p || acct.justSent)) toast(p?.save ? "You're in. Role saved." : "You're in. Everything is unlocked.");
    acct.justSent = false;
  }
  $("#alerts-box").hidden = false;
  $("#p-alerts").addEventListener("change", (e) => {
    if (!sync.currentUser()) { e.target.checked = false; askSignup("alerts", { view: "foryou" }); return; }
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
  btn.addEventListener("click", () => {
    if (sync.currentUser()) { fillAccount(sync.currentUser()); acctPanel("in"); dlg.showModal(); } else askSignup("signup");
  });
  login.addEventListener("click", () => askSignup("login"));
  for (const b of document.querySelectorAll(".acct-tabs button")) b.addEventListener("click", () => setMode(b.dataset.mode));
  $("#acct-magic").addEventListener("click", () => { acct.magic = !acct.magic; setMode(acct.mode); });
  $("#acct-pw-show").addEventListener("click", (e) => {
    const pw = $("#acct-pw"), hide = pw.type === "text";
    pw.type = hide ? "password" : "text";
    e.target.textContent = hide ? "Show" : "Hide";
    e.target.setAttribute("aria-label", hide ? "Show password" : "Hide password");
  });

  // "Check your inbox", with a resend that waits 60 seconds between tries.
  let resendAt = 0, resendTimer;
  const sent = (kind, email) => {
    const t = { confirm: ["Confirm your email", "We sent a confirmation link to"], link: ["Check your inbox", "We sent a sign-in link to"], reset: ["Reset your password", "We sent a password reset link to"] }[kind];
    acct.sent = { kind, email };
    $("#sent-title").textContent = t[0];
    $("#sent-text").replaceChildren(`${t[1]} `, el("b", { id: "acct-sent-to" }, email), ". Open it on this device and you're in.");
    $("#sent-msg").textContent = "";
    acctPanel("sent");
    resendAt = Date.now() + 60000;
    tick();
  };
  const tick = () => {
    clearTimeout(resendTimer);
    const left = Math.ceil((resendAt - Date.now()) / 1000);
    const r = $("#acct-resend");
    r.disabled = left > 0;
    r.textContent = left > 0 ? `Send it again in ${left}s` : "Send it again";
    if (left > 0) resendTimer = setTimeout(tick, 1000);
  };
  const busy = (button, on, label) => { button.disabled = on; if (label) button.textContent = label; };
  const fail = (box, e, email) => {
    const m = sync.authMessage(e);
    box.replaceChildren(m.text);
    if (m.code === "exists") box.append(" ", el("button", { type: "button", class: "link", onclick: () => setMode("login") }, "Log in"));
    if (m.code === "bad_login") box.append(" ", el("button", { type: "button", class: "link", onclick: () => forgot() }, "Reset password"));
    if (m.code === "unconfirmed") box.append(" ", el("button", { type: "button", class: "link", onclick: () => run(() => sync.resendConfirmation(email), "confirm", email) }, "Resend confirmation"));
  };
  async function run(task, kind, email) {
    const go = $("#acct-go"), label = go.textContent;
    busy(go, true, "One moment…");
    $("#acct-msg").textContent = "";
    try {
      const r = await task();
      acct.justSent = true;
      if (kind === "signup") { if (r === "confirm") sent("confirm", email); }
      else if (kind) sent(kind, email);
    } catch (e) { fail($("#acct-msg"), e, email); }
    finally { busy(go, false, label); }
  }
  const valid = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  function forgot() {
    const email = $("#acct-email").value.trim();
    if (!valid(email)) { $("#acct-msg").textContent = "Enter your email above, then tap Forgot password."; $("#acct-email").focus(); return; }
    run(() => sync.sendPasswordReset(email), "reset", email);
  }
  $("#acct-forgot").addEventListener("click", forgot);
  $("#acct-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#acct-email").value.trim(), pw = $("#acct-pw").value;
    if (!valid(email)) { $("#acct-msg").textContent = "Enter a valid email address."; $("#acct-email").focus(); return; }
    if (acct.magic) return run(() => sync.signInWithEmail(email), "link", email);
    if (acct.mode === "signup" && pw.length < 8) { $("#acct-msg").textContent = "Use a password of at least 8 characters."; $("#acct-pw").focus(); return; }
    if (!pw) { $("#acct-msg").textContent = "Enter your password."; $("#acct-pw").focus(); return; }
    if (acct.mode === "signup") run(() => sync.signUp(email, pw), "signup", email);
    else run(() => sync.signInWithPassword(email, pw), null, email);
  });
  $("#acct-resend").addEventListener("click", async () => {
    const { kind, email } = acct.sent || {};
    if (!email || Date.now() < resendAt) return;
    const task = { confirm: () => sync.resendConfirmation(email), link: () => sync.signInWithEmail(email), reset: () => sync.sendPasswordReset(email) }[kind];
    try { await task(); $("#sent-msg").textContent = "Sent again."; resendAt = Date.now() + 60000; tick(); }
    catch (e) { $("#sent-msg").textContent = sync.authMessage(e).text; }
  });
  $("#acct-change").addEventListener("click", () => { acctPanel("out"); $("#acct-email").select(); });
  $("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#reset-pw").value, go = $("#reset-go");
    if (pw.length < 8) { $("#reset-msg").textContent = "Use a password of at least 8 characters."; return; }
    busy(go, true);
    try { await sync.updatePassword(pw); dlg.close(); toast("Password saved. You're signed in."); finishPending("SIGNED_IN"); }
    catch (err) { $("#reset-msg").textContent = sync.authMessage(err).text; }
    finally { busy(go, false); }
  });
  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#pw-new").value;
    if (pw.length < 8) { $("#pw-msg").textContent = "Use a password of at least 8 characters."; return; }
    try { await sync.updatePassword(pw); $("#pw-new").value = ""; $("#pw-msg").textContent = "Password updated."; }
    catch (err) { $("#pw-msg").textContent = sync.authMessage(err).text; }
  });
  for (const [id, provider, on] of [["#acct-github", "github", sync.github], ["#acct-google", "google", sync.google]]) {
    $(id).hidden = !on;
    $(id).addEventListener("click", () => sync.signInWith(provider).catch((e) => fail($("#acct-msg"), e)));
  }
  $("#acct-signout").addEventListener("click", async () => { await sync.signOut(); dlg.close(); toast("Signed out. Your data stays on this device."); });
  $("#acct-delete").addEventListener("click", async () => {
    if (!confirm("Delete your Ada account? This removes your login and everything synced to it. This device keeps its own copy.")) return;
    try {
      const full = await sync.deleteAccount();
      dlg.close();
      toast(full ? "Your account is deleted." : "Your synced data is deleted.");
    } catch (e) { toast(sync.authMessage(e).text); }
  });
  show(null);
  sync.initSync({ read: syncedState, write: applySynced, onChange: show }).catch((e) => console.warn("Ada sync:", e.message));
}

/* ---------- First visit: three taps to a useful feed ---------- */
function initOnboarding() {
  const dlg = $("#onboard");
  const pick = { kind: null, field: null, where: null };
  let step = 1;
  $("#ob-fields").replaceChildren(...Object.entries(FIELDS).map(([f, name]) => el("button", { type: "button", "data-v": f }, el("b", {}, name))));
  const show = () => {
    for (const p of dlg.querySelectorAll(".ob-pane")) p.hidden = +p.dataset.step !== step;
    $("#ob-step").textContent = `Step ${step} of 3`;
    $("#ob-back").hidden = step === 1;
    $("#ob-next").textContent = step === 3 ? "Show my roles" : "Next";
    $("#ob-next").disabled = !pick[["kind", "field", "where"][step - 1]];
  };
  for (const box of dlg.querySelectorAll(".ob-opts")) box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    pick[box.dataset.key] = b.dataset.v;
    for (const x of box.querySelectorAll("button")) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }
    show();
  });
  $("#ob-back").addEventListener("click", () => { step = Math.max(1, step - 1); show(); });
  $("#ob-next").addEventListener("click", () => {
    if (step < 3) { step++; show(); return; }
    const p = state.profile;
    p.kind = pick.kind;
    const ts = tracksIn(pick.field);
    p.tracks = ts.slice(0, 2);
    p.tracksFromUser = true;
    p.countries = pick.where === "any" ? [] : [pick.where];
    p.remoteOk = true;
    if ($("#ob-visa").checked) p.visa = true;
    store.set("profile", p);
    store.set("onboarded", true); store.set("toured", true);
    $("#tour").hidden = true;
    fillProfile();
    // Explore opens on the same choices, so the first list is already theirs.
    $("#f-kind").value = pick.kind; $("#f-field").value = pick.field; fillRoleFilter();
    $("#f-country").value = pick.where === "any" ? "any" : pick.where;
    $("#f-visa").checked = $("#ob-visa").checked;
    dlg.close();
    if (location.hash === "#explore" || !location.hash) { rerunExplore(); route(); } else location.hash = "explore";
    toast("Your feed is set. Save roles with ☆ to track them.");
  });
  dlg.addEventListener("close", () => store.set("onboarded", true));
  show();
  const fresh = !store.get("onboarded", false) && !store.get("toured", false) && !store.get("resume", "") && !location.search && (!location.hash || location.hash === "#explore");
  if (fresh) setTimeout(() => { if (!document.querySelector("dialog[open]")) dlg.showModal(); }, 900);
}

async function boot() {
  initTheme();
  initAccount();
  initDrop();
  const savedResume = store.get("resume", "");
  if (savedResume) { state.parsed = parseResume(savedResume); useResumeTerms(savedResume); }
  const get = (f) => fetch(`data/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });
  // Small files first so the page paints right away; the big role list follows.
  const big = get("opportunities.json");
  big.catch(() => {});  // reported below if it fails
  let opp;
  try {
    let latest;
    [state.programs, state.graph, state.stats, latest] = await Promise.all([get("programs.json"), get("skills.json"), get("stats.json"), get("latest.json").catch(() => null)]);
    renderStats();
    $("#k-companies").textContent = `${fmt(state.stats.companies)}`;
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
  state.byId = new Map(state.jobs.map((j) => [j.id, j]));
  for (const s of state.graph.skills) SKILL_NAMES[s.id] = s.name;
  useGraph(state.graph);
  useJobs(state.jobs);
  const s = state.stats;
  $("#updated").textContent = `Updated ${new Date(opp.updated * 1000).toLocaleString()}`;

  options($("#f-field"), Object.entries(FIELDS), ["any", "All fields"]);
  fillRoleFilter();
  $("#f-field").addEventListener("change", fillRoleFilter);
  trackOptions($("#rm-track"));
  trackOptions($("#p-track"));
  trackOptions($("#p-track2"), ["none", "None"]);
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
  $("#f-sort").addEventListener("change", () => { if ($("#f-sort").value === "fit" && !state.parsed) toast("Add your resume at the top of Explore to sort by fit."); });
  for (const c of document.querySelectorAll(".f-chips .chip[data-chip]")) c.addEventListener("click", () => {
    const [k, v] = c.dataset.chip.split(":");
    const on = c.getAttribute("aria-pressed") !== "true";
    if (k === "kind") $("#f-kind").value = on ? v : "any";
    if (k === "days") $("#f-days").value = on ? v : "0";
    if (k === "remote") $("#f-remote").checked = on;
    if (k === "visa") $("#f-visa").checked = on;
    rerunExplore();
  });
  $("#f-more").addEventListener("click", () => {
    const open = !$("#filters").classList.contains("adv-open");
    $("#filters").classList.toggle("adv-open", open);
    $("#f-more").setAttribute("aria-expanded", String(open));
  });
  for (const b of document.querySelectorAll("#board-mode button")) b.addEventListener("click", () => { store.set("boardMode", b.dataset.mode); renderSaved(); });
  $("#job-dlg").addEventListener("close", () => {
    if (location.hash.startsWith("#job/")) history.replaceState(null, "", location.pathname + location.search + "#explore");
    refreshBehind();
  });
  $("#job-dlg").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  initOnboarding();
  const more = $("#more-btn"), sheet = $("#more-sheet");
  more.addEventListener("click", (e) => { e.stopPropagation(); sheet.hidden = !sheet.hidden; more.setAttribute("aria-expanded", String(!sheet.hidden)); });
  addEventListener("click", (e) => { if (!sheet.hidden && !sheet.contains(e.target)) { sheet.hidden = true; more.setAttribute("aria-expanded", "false"); } });
  addEventListener("hashchange", () => { sheet.hidden = true; more.setAttribute("aria-expanded", "false"); });
  $("#more").addEventListener("click", () => { state.shown += 60; renderExplore(); });
  $("#share-search").addEventListener("click", () => copy(`${location.origin}${location.pathname}?${searchParams()}#explore`, "Search link copied"));
  $("#profile").addEventListener("input", (e) => {
    if (e.target.id === "p-resume" || e.target.id === "p-alerts") return;
    if (e.target.id === "p-hours") $("#p-hours-out").value = e.target.value;
    if (e.target.id === "p-track" || e.target.id === "p-track2") state.profile.tracksFromUser = true;
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
    $("#tour-setup").addEventListener("click", () => $("#onboard").showModal());
  }
  updateSavedCount();
  addEventListener("hashchange", route);
  route();
  ready();
}

boot();
// Cache the app for instant repeat visits and offline use (only when served over http(s), not file://).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
