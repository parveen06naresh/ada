// Pure logic: filtering, matching and roadmap planning. No DOM, so it runs in Node tests too.

export const TRACKS = {
  mle: "Machine Learning Engineer",
  llm: "LLM & GenAI Engineer",
  research: "AI Research Scientist",
  vision: "Computer Vision Engineer",
  nlp: "NLP & Speech Engineer",
  robotics: "Robotics & Autonomy Engineer",
  infra: "AI Infrastructure & GPU Engineer",
  mlops: "MLOps & Data Engineer",
  quant: "Quant Researcher",
  ds: "Data Scientist",
};

export const today = (now = Date.now()) => Math.floor(now / 86400000);

export function filterJobs(jobs, q = {}, now = Date.now()) {
  const words = (q.text || "").toLowerCase().split(/\s+/).filter(Boolean);
  const t0 = today(now);
  return jobs.filter((j) => {
    if (q.kind && q.kind !== "any" && j.k !== q.kind) return false;
    if (q.track && q.track !== "any" && j.tr !== q.track) return false;
    if (q.level && q.level !== "any" && j.lv !== q.level) return false;
    if (q.country && q.country !== "any" && !j.co.includes(q.country)) return false;
    if (q.remote && !j.r) return false;
    if (q.skill && q.skill !== "any" && !j.s.includes(q.skill)) return false;
    if (q.days && t0 - j.d > q.days) return false;
    if (words.length) {
      const hay = `${j.t} ${j.c} ${j.l.join(" ")} ${TRACKS[j.tr] || ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

// Matching: a transparent points system. Every point comes with the reason shown to the user.
export function scoreJob(j, p, now = Date.now()) {
  let score = 0;
  const why = [];
  const tracks = p.tracks || [];
  if (tracks[0] === j.tr) { score += 4; why.push(`Your goal: ${TRACKS[j.tr]}`); }
  else if (tracks.includes(j.tr)) { score += 3; why.push(`Your goal: ${TRACKS[j.tr]}`); }
  const known = new Set(p.known || []);
  const core = j.s.filter((s) => s !== "python");
  if (core.length) {
    const have = core.filter((s) => known.has(s));
    score += 2 * (have.length / core.length);
    if (have.length) why.push(`You know ${have.length} of ${core.length} core skills`);
  }
  if (p.kind && p.kind !== "any") {
    if (j.k === p.kind) score += 1.5; else score -= 3;
  }
  if (p.level && p.level !== "any") {
    if (j.lv === p.level) { score += 1; why.push(`Fits ${p.level}`); }
    else if (j.lv === "PhD" && p.level !== "PhD") score -= 2;
  }
  const places = p.countries || [];
  if (places.length) {
    if (j.co.some((c) => places.includes(c))) { score += 1; why.push(`In ${j.co.find((c) => places.includes(c))}`); }
    else if (p.remoteOk && j.r) { score += 1; why.push("Remote"); }
    else score -= 2;
  } else if (p.remoteOk && j.r) { score += 0.5; why.push("Remote"); }
  const age = today(now) - j.d;
  if (age <= 7) { score += 1; why.push("Posted this week"); }
  else if (age <= 30) score += 0.4;
  else if (age > 90) score -= 0.5;
  if (j.p) score += 0.2;
  return { score: Math.round(score * 100) / 100, why };
}

export function recommend(jobs, profile, n = 30, now = Date.now()) {
  return jobs
    .map((j) => ({ j, ...scoreJob(j, profile, now) }))
    .filter((r) => r.score > 2)
    .sort((a, b) => b.score - a.score || b.j.d - a.j.d)
    .slice(0, n);
}

// Roadmap: the skills a track needs, in prerequisite order, minus what you know, laid out in weeks.
export function planRoadmap(graph, track, known = [], hoursPerWeek = 8, demand = {}) {
  const byId = Object.fromEntries(graph.skills.map((s) => [s.id, s]));
  const need = graph.tracks[track]?.skills || [];
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !byId[id]) return;
    seen.add(id);
    for (const pre of byId[id].prereqs) visit(pre);
    order.push(id);
  };
  need.filter((id) => id !== "portfolio").forEach(visit);
  if (need.includes("portfolio")) visit("portfolio");
  const knownSet = new Set(known);
  const hpw = Math.max(1, hoursPerWeek);
  let week = 0;
  const steps = order.map((id) => {
    const s = byId[id];
    const done = knownSet.has(id);
    const weeks = done ? 0 : Math.max(1, Math.ceil(s.hours / hpw));
    const step = { ...s, done, start: week + 1, end: week + weeks, weeks, demand: demand[id] ?? null };
    week += weeks;
    return step;
  });
  return { track, steps, totalWeeks: week, hours: steps.filter((s) => !s.done).reduce((a, s) => a + s.hours, 0) };
}

// Share links: the profile travels in the URL hash, nothing is stored on a server.
export function encodeProfile(p) {
  const json = JSON.stringify(p);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeProfile(s) {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString();
    const p = JSON.parse(json);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

// Streaks: a check-in on consecutive days grows the streak; a missed day resets it.
export function checkIn(state, day) {
  const s = { streak: 0, best: 0, last: null, ...state };
  if (s.last === day) return s;
  s.streak = s.last === day - 1 ? s.streak + 1 : 1;
  s.best = Math.max(s.best, s.streak);
  s.last = day;
  return s;
}

export const BADGES = [
  { id: "start", name: "First step", test: (x) => x.done >= 1 },
  { id: "three", name: "Three skills", test: (x) => x.done >= 3 },
  { id: "half", name: "Halfway", test: (x) => x.total > 0 && x.done / x.total >= 0.5 },
  { id: "track", name: "Track complete", test: (x) => x.total > 0 && x.done === x.total },
  { id: "streak7", name: "7-day streak", test: (x) => x.best >= 7 },
  { id: "saved10", name: "10 roles saved", test: (x) => x.saved >= 10 },
];

// Resume reading: find skills mentioned in pasted text. Runs in the browser, nothing is sent.
const SKILL_PATTERNS = {
  python: /\bpython\b/i,
  git: /\b(git|github|gitlab|linux|bash|shell|unix)\b/i,
  math: /\b(linear algebra|calculus|probability|discrete math|real analysis|differential equations)\b/i,
  stats: /\b(statistic\w*|a\/b test\w*|hypothesis test\w*|regression analysis|bayesian|econometric\w*)\b/i,
  sql: /\b(sql|postgres\w*|mysql|sqlite|bigquery|snowflake|pandas|dbt)\b/i,
  ml: /\b(machine learning|scikit-learn|sklearn|xgboost|lightgbm|random forest|logistic regression|kaggle)\b/i,
  pytorch: /\b(pytorch|torch|tensorflow|keras|jax|deep learning|neural net\w*|cnn|rnn|lstm)\b/i,
  llms: /\b(llms?|large language models?|transformers?|gpt|bert|fine-?tun\w*|hugging ?face|lora)\b/i,
  rag: /\b(rag|retrieval[- ]augmented|langchain|llamaindex|vector (db|database|store)|embeddings?|agents?|prompt engineering)\b/i,
  cv: /\b(computer vision|opencv|image (classification|segmentation)|object detection|yolo|cnn)\b/i,
  nlp: /\b(nlp|natural language|spacy|nltk|text classification|speech recognition|asr|sentiment)\b/i,
  rl: /\b(reinforcement learning|rl|gymnasium|openai gym|robotics|ros|control systems?)\b/i,
  cpp: /(^|[^a-z])(c\+\+|cpp)(?![a-z])/i,
  cuda: /\b(cuda|gpu programming|triton|kernels?|opencl|hpc)\b/i,
  distributed: /\b(distributed (systems|training|computing)|spark|hadoop|kafka|kubernetes|ray|mpi)\b/i,
  mlops: /\b(mlops|docker|kubernetes|aws|gcp|azure|ci\/cd|mlflow|airflow|fastapi|flask|deploy\w*)\b/i,
  research: /\b(publications?|published|paper|arxiv|neurips|icml|iclr|cvpr|acl|research assistant)\b/i,
  quantfin: /\b(quant\w*|trading|derivatives?|options pricing|portfolio|backtest\w*|stochastic)\b/i,
};

export function detectSkills(text) {
  return Object.entries(SKILL_PATTERNS).filter(([, rx]) => rx.test(text || "")).map(([id]) => id);
}
