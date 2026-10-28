// Resume match: read a resume, build a profile from it, score every role for fit, and say what to fix.
// Pure logic, no DOM, so it runs in Node tests too. The resume never leaves the device.
import { TRACKS, detectSkills, today } from "./match.js";

const YEAR_NOW = () => new Date().getFullYear();
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const ACTION_VERBS = /^(built|fine-?tuned|co-?authored|prototyped|conducted|tested|coordinated|hosted|reached|achieved|earned|placed|ranked|led|designed|developed|created|implemented|launched|shipped|improved|reduced|increased|optimi[sz]ed|automated|deployed|trained|analy[sz]ed|architected|engineered|wrote|published|founded|organi[sz]ed|managed|delivered|scaled|cut|grew|won|ran|taught|mentored|researched|evaluated|benchmarked|migrated|refactored|integrated|accelerated|modeled|predicted|visuali[sz]ed|presented)\b/i;
const WEAK = /\b(responsible for|helped (with|to)|worked on|assisted (with|in)|duties included|tasked with)\b/i;
const NUMBER = /(\d+(\.\d+)?\s?(%|x|×|k|m|ms|s|hrs?|hours|users|students|people|customers|requests|gb|tb)\b|\$\s?\d|\b\d{2,}\b)/i;

// Where the education section says the degree ends: the latest plausible year near a degree or graduation word.
function graduation(text) {
  const near = /(expected|graduat\w*|class of|b\.?s\.?|b\.?a\.?|bachelor|master|m\.?s\.?|ph\.?d|university|college|institute)/i;
  let best = null;
  for (const line of text.split(/\n/)) {
    if (!near.test(line)) continue;
    for (const m of line.matchAll(/\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(20[1-3]\d)\b/gi)) {
      const y = +m[2];
      if (y > YEAR_NOW() + 6) continue;
      const mo = m[1] ? MONTHS[m[1].slice(0, 3).toLowerCase()] : 5;
      if (!best || y * 12 + mo > best.y * 12 + best.m) best = { y, m: mo };
    }
  }
  return best;
}

export function levelOf(text) {
  if (/\b(ph\.?\s?d\.?|doctor of philosophy|doctoral)\b/i.test(text)) return "PhD";
  if (/(^|[^a-z])(master'?s|m\.\s?s\.?|m\.?sc\.?|m\.?eng\.?|mba|ms (in|of))(?![a-z])/i.test(text)) return "Masters";
  return "Undergrad";
}

// Read a resume into the facts Ada can use. Everything here is a guess the student can correct.
export function parseResume(text, now = Date.now()) {
  const t = (text || "").replace(/\r/g, "");
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[•●▪◦\-*–]\s*/.test(l) || (l.length > 40 && ACTION_VERBS.test(l)))
    .map((l) => l.replace(/^[•●▪◦\-*–]\s*/, ""));
  const grad = graduation(t);
  const d = new Date(now);
  const monthsLeft = grad ? (grad.y - d.getFullYear()) * 12 + (grad.m - (d.getMonth() + 1)) : null;
  const level = levelOf(t);
  return {
    skills: detectSkills(t),
    level,
    grad,
    // A student finishing within about a year applies to new-grad roles; earlier than that, internships.
    kind: monthsLeft == null ? "internship" : monthsLeft <= 12 ? "new-grad" : "internship",
    words: (t.match(/\S+/g) || []).length,
    email: /[\w.+-]+@[\w-]+\.[\w.]+/.test(t),
    phone: /(\+?\d[\d\s().-]{8,}\d)/.test(t),
    linkedin: /linkedin\.com\/in\//i.test(t),
    github: /github\.com\/[\w-]+/i.test(t),
    sections: {
      education: /\beducation\b/i.test(t),
      experience: /\b(experience|employment|internships?)\b/i.test(t),
      projects: /\bprojects?\b/i.test(t),
      skills: /\b(skills|technologies|tech stack|tools)\b/i.test(t),
    },
    bullets: bullets.length,
    quantified: bullets.filter((b) => NUMBER.test(b)).length,
    actionLed: bullets.filter((b) => ACTION_VERBS.test(b)).length,
    weak: [...new Set(lines.map((b) => b.match(WEAK)?.[0].toLowerCase()).filter(Boolean))].slice(0, 3),
  };
}

// Concrete fixes, most important first. Each one is something a recruiter or an applicant tracking system checks.
export function resumeChecks(r) {
  const out = [];
  const add = (ok, title, fix) => out.push({ ok, title, fix });
  add(r.email && r.phone, "Contact details", "Put your email and phone number at the top.");
  add(r.linkedin || r.github, "Links to your work", "Add your GitHub and LinkedIn URLs so a recruiter can check your projects in one click.");
  const missing = Object.entries(r.sections).filter(([, v]) => !v).map(([k]) => k);
  add(!missing.length, "Standard sections", `Add clear headings for ${missing.join(", ")}. Applicant tracking systems look for them by name.`);
  const q = r.bullets ? r.quantified / r.bullets : 0;
  add(r.bullets >= 3 && q >= 0.5, "Numbers in your bullets",
    r.bullets >= 3 ? `${r.quantified} of ${r.bullets} bullets have a number. Aim for at least half: users, speed-ups, accuracy, time saved, scale.`
      : "Write your experience and projects as bullet points, each opening with a verb and ending with a result you can measure.");
  add(!r.bullets || r.actionLed / r.bullets >= 0.6, "Opening verbs", "Start each bullet with what you did: Built, Led, Cut, Trained, Shipped.");
  add(!r.weak.length, "Weak phrases", `Replace phrases like "${r.weak[0] || "responsible for"}" with the action and its result.`);
  add(r.words >= 250 && r.words <= 850, "Length", r.words < 250 ? "It reads thin. Add projects with results, coursework or competitions." : "Trim to one page. Cut the oldest and least relevant lines first.");
  add(r.skills.length >= 5, "Skills a matcher can find", "Name the tools you used inside your bullets (Python, PyTorch, SQL…), not only in a skills list.");
  return out.sort((a, b) => a.ok - b.ok);
}

// What a role needs: the skills read from its title plus the core skills of its career track.
let TRACK_NEEDS = {};
export function useGraph(graph) {
  TRACK_NEEDS = Object.fromEntries(Object.entries(graph.tracks).map(([id, t]) => [id, t.skills.filter((s) => !["python", "git", "portfolio"].includes(s))]));
}
const core = (j) => [...new Set([...(TRACK_NEEDS[j.tr] || []), ...j.s.filter((s) => s !== "python")])];

// Words in a job title that say what the work is, and the words in the resume, for a relevance check.
const GENERIC = new Set("intern internship internships summer fall spring winter co op coop new grad graduate engineer engineering program associate i ii iii iv the and of for in to a an with early career entry level university student students undergraduate undergrad phd masters ms bs us usa remote team role position full time part hybrid onsite based campus start starting junior jr sr global general apprentice trainee fellow fellowship rotational".split(" "));
const words = (t) => (t.toLowerCase().match(/[a-z][a-z+#]*/g) || []).filter((w) => w.length > 1 || w === "c" || w === "r");
let TERMS = null;
let IDF = null;
// A skill on the resume also counts for the words job titles use for it.
const SKILL_WORDS = {
  ml: "ml machine learning ai model models modeling", pytorch: "ml machine learning deep ai neural", llms: "llm llms genai generative language models ai",
  rag: "agents agentic llm genai ai retrieval", nlp: "nlp natural language processing speech text", cv: "vision computer image perception imaging",
  rl: "reinforcement robotics robot control autonomy", cuda: "gpu cuda kernel kernels accelerator", cpp: "c++ systems performance",
  distributed: "distributed systems infrastructure platform", mlops: "mlops infrastructure platform deployment", stats: "statistics statistical data analytics analysis",
  sql: "data analytics analysis database", research: "research researcher scientist science", quantfin: "quant quantitative trading trader finance markets",
};
export function useResumeTerms(text) {
  if (!text) { TERMS = null; return; }
  TERMS = new Set(words(text));
  for (const k of detectSkills(text)) for (const w of (SKILL_WORDS[k] || "").split(" ")) if (w) TERMS.add(w);
}
// Rare title words ("sensory", "embedding") say more about a role than common ones ("data", "science").
export function useJobs(jobs) {
  const df = new Map();
  for (const j of jobs) for (const w of new Set(words(j.t))) df.set(w, (df.get(w) || 0) + 1);
  IDF = { n: jobs.length, df };
}
const weight = (w) => (IDF ? Math.log((IDF.n + 1) / ((IDF.df.get(w) || 0) + 1)) + 0.1 : 1);
function relevance(title) {
  if (!TERMS) return 0.5;
  const tw = [...new Set(words(title))].filter((w) => !GENERIC.has(w));
  if (!tw.length) return 0.5;
  const all = tw.reduce((a, w) => a + weight(w), 0);
  return tw.filter((w) => TERMS.has(w)).reduce((a, w) => a + weight(w), 0) / all;
}
// The pipeline files titles it can't place under Machine Learning Engineer; only trust that when the title says so.
const ML_TITLE = /\b(ml|machine learning|ai|a\.i\.|artificial intelligence|deep learning|llm|genai|model\w*|neural|data scien\w*|applied scien\w*)\b/i;

// Fit from 0 to 100, with what the student has and lacks for this role. A guide, not a probability of an offer.
export function fitJob(j, p, now = Date.now()) {
  const known = new Set(p.known || []);
  const tracks = p.tracks || [];
  const onTrack = j.tr !== "mle" || ML_TITLE.test(j.t);
  let pts = !onTrack ? 4 : tracks[0] === j.tr ? 22 : tracks.includes(j.tr) ? 18 : 4;
  const need = core(j);
  const have = need.filter((s) => known.has(s));
  const missing = need.filter((s) => !known.has(s));
  pts += need.length ? 28 * (have.length / need.length) : 18;
  pts += 25 * relevance(j.t);  // does the resume talk about what this title is about?
  pts += !p.kind || p.kind === "any" || p.kind === j.k ? 10 : 0;
  pts += j.lv === "PhD" && p.level !== "PhD" ? 0 : j.lv === "Masters" && p.level === "Undergrad" ? 3 : 8;
  const places = p.countries || [];
  pts += !places.length || j.co.some((c) => places.includes(c)) || (p.remoteOk && j.r) ? 7 : 0;
  if (today(now) - j.d > 60) pts -= 5;  // older postings are more likely to be filled
  return { fit: Math.max(0, Math.min(100, Math.round(pts))), have, missing };
}

// One number to improve: 60% how well your skills fit your best 50 roles, 40% the resume checks you pass.
export function adaScore(ranked, checks) {
  const top = ranked.slice(0, 50);
  const fit = top.length ? top.reduce((a, x) => a + x.fit, 0) / top.length : 0;
  const pass = checks.length ? checks.filter((c) => c.ok).length / checks.length : 0;
  return Math.round(0.6 * fit + 40 * pass);
}

export function rankByFit(jobs, p, n = 50, now = Date.now()) {
  return jobs.map((j) => ({ j, ...fitJob(j, p, now) }))
    .sort((a, b) => b.fit - a.fit || b.j.d - a.j.d)
    .slice(0, n);
}

// Which career tracks a set of skills already covers best, from the roadmap's skill lists.
export function bestTracks(graph, known, n = 3) {
  const k = new Set(known);
  return Object.entries(graph.tracks).map(([id, t]) => {
    const need = t.skills.filter((s) => s !== "portfolio" && s !== "python");
    return { id, name: TRACKS[id], cover: need.length ? need.filter((s) => k.has(s)).length / need.length : 0 };
  }).sort((a, b) => b.cover - a.cover).slice(0, n);
}

// The skills you lack that the most of your target roles ask for, with how many roles each one opens up.
export function gapPlan(jobs, p, graph, n = 4, now = Date.now()) {
  const tracks = new Set(p.tracks || []);
  const count = new Map();
  for (const j of jobs) {
    if (tracks.size && !tracks.has(j.tr)) continue;
    for (const s of fitJob(j, p, now).missing) count.set(s, (count.get(s) || 0) + 1);
  }
  const byId = Object.fromEntries(graph.skills.map((s) => [s.id, s]));
  return [...count.entries()].filter(([s]) => byId[s]).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([id, roles]) => ({ id, name: byId[id].name, hours: byId[id].hours, roles, learn: byId[id].learn?.[0] || null }));
}

// Turn a parsed resume into a profile, keeping anything the student already chose by hand.
export function profileFromResume(r, graph, prev = {}) {
  const known = [...new Set([...(prev.known || []), ...r.skills])];
  const tracks = prev.tracksFromUser ? prev.tracks : bestTracks(graph, known, 2).map((t) => t.id);
  return { ...prev, known, tracks, level: r.level === "Undergrad" && r.kind === "new-grad" ? "New grad" : r.level, kind: r.kind };
}
