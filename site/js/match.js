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
  swe: "Software Engineer",
  hardware: "Hardware Engineer",
  product: "Product & Design",
  finance: "Finance & Accounting",
  consulting: "Consulting & Strategy",
  marketing: "Marketing & Sales",
  ops: "Operations & People",
  science: "Science & Healthcare",
};

// The ten fields students search in. AI & Data holds the nine AI tracks; every other field is one track.
export const FIELDS = {
  swe: "Software", ai: "AI & Data", quant: "Quant & Trading", hardware: "Hardware & Engineering", product: "Product & Design",
  finance: "Finance & Accounting", consulting: "Consulting & Strategy", marketing: "Marketing & Sales", ops: "Operations & People", science: "Science & Healthcare",
};
export const fieldOf = (tr) => (tr in FIELDS && tr !== "ai" ? tr : "ai");
export const tracksIn = (field) => Object.keys(TRACKS).filter((t) => fieldOf(t) === field);

export const today = (now = Date.now()) => Math.floor(now / 86400000);

// Unpack the columnar opportunities.json written by pipeline/build.py (pack_jobs).
export function unpackJobs(data) {
  if (data.jobs) return data.jobs;
  const { keys, strings, rows } = data;
  const str = new Set(data.strings_in);
  const deref = keys.map((k) => str.has(k));
  return rows.map((row) => {
    const j = {};
    for (let i = 0; i < keys.length; i++) {
      const v = row[i];
      j[keys[i]] = deref[i] ? (Array.isArray(v) ? v.map((x) => strings[x]) : strings[v]) : v;
    }
    j.r = !!j.r;
    return j;
  });
}

export function filterJobs(jobs, q = {}, now = Date.now()) {
  const words = (q.text || "").toLowerCase().split(/\s+/).filter(Boolean);
  const t0 = today(now);
  return jobs.filter((j) => {
    if (q.kind && q.kind !== "any" && j.k !== q.kind) return false;
    if (q.field && q.field !== "any" && fieldOf(j.tr) !== q.field) return false;
    if (q.track && q.track !== "any" && j.tr !== q.track) return false;
    if (q.visa && !j.v) return false;
    if (q.level && q.level !== "any" && j.lv !== q.level) return false;
    if (q.country && q.country !== "any" && !j.co.includes(q.country)) return false;
    if (q.remote && !j.r) return false;
    if (q.skill && q.skill !== "any" && !j.s.includes(q.skill)) return false;
    if (q.days && t0 - j.d > q.days) return false;
    if (words.length) {
      j._hay ??= `${j.t} ${j.c} ${j.l.join(" ")} ${TRACKS[j.tr] || ""}`.toLowerCase();
      if (!words.every((w) => j._hay.includes(w))) return false;
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

// The weekly email: your best matches among roles posted in the last 7 days.
export function weeklyMatches(jobs, profile, n = 10, now = Date.now()) {
  const t0 = today(now);
  return recommend(jobs.filter((j) => t0 - j.d <= 7), profile, n, now);
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
  dsa: /\b(data structures|algorithms?|leetcode|competitive programming|java|c#|golang|object[- ]oriented)\b/i,
  web: /\b(javascript|typescript|react|next\.?js|node\.?js|html|css|vue|angular|django|rest api|graphql|swift|kotlin|flutter)\b/i,
  cloud: /\b(aws|gcp|azure|docker|kubernetes|terraform|ci\/cd|linux|devops)\b/i,
  excel: /\b(excel|spreadsheets?|pivot tables?|vlookup|xlookup|google sheets)\b/i,
  finmodel: /\b(financial model\w*|valuation|dcf|lbo|m&a|three[- ]statement|comparable compan\w*|equity research|investment banking|bloomberg|capital iq|cfa)\b/i,
  accounting: /\b(accounting|gaap|ifrs|audit\w*|tax(ation)?|cpa|quickbooks|reconciliation\w*|bookkeeping|accounts (payable|receivable))\b/i,
  casework: /\b(case (competition|interview)s?|consult\w*|market sizing|strategy|business case|stakeholder\w*)\b/i,
  digital: /\b(marketing|seo|sem|social media|google analytics|content (creation|strategy)|campaigns?|brand\w*|copywrit\w*|email marketing|meta ads|google ads)\b/i,
  sales: /\b(sales|salesforce|hubspot|crm|business development|lead generation|cold (calling|outreach)|quota|customer success)\b/i,
  design: /\b(figma|sketch|adobe (xd|illustrator|photoshop)|ux|ui design|user experience|wireframe\w*|prototyp\w*|user research|usability)\b/i,
  productsense: /\b(product manag\w*|product roadmap|prd|user stories|a\/b tests?|product metrics|go-to-market|jira|agile|scrum)\b/i,
  circuits: /\b(circuit\w*|pcb|verilog|vhdl|fpga|analog|digital logic|oscilloscope|ltspice|altium|cadence|signals and systems)\b/i,
  cad: /\b(solidworks|autocad|cad|onshape|fusion 360|catia|creo|ansys|finite element|fea|gd&t|3d print\w*|matlab|simulink)\b/i,
  embedded: /\b(embedded|firmware|microcontroller\w*|arduino|raspberry pi|rtos|stm32|esp32|uart|i2c|spi)\b/i,
  supplychain: /\b(supply chain|logistics|procurement|sourcing|inventory|sap|erp|lean|six sigma|operations management|forecasting)\b/i,
  people: /\b(human resources|recruit\w*|talent acquisition|onboarding|hris|workday|employee engagement|people operations)\b/i,
  lab: /\b(pcr|cell culture|western blot|elisa|wet lab|laboratory|lab techniques|spectroscopy|chromatography|hplc|microscopy|crispr|assay\w*)\b/i,
  clinical: /\b(clinical|patient\w*|hipaa|emr|ehr|epic|public health|epidemiolog\w*|nursing|healthcare|cna|emt|irb)\b/i,
};

export function detectSkills(text) {
  return Object.entries(SKILL_PATTERNS).filter(([, rx]) => rx.test(text || "")).map(([id]) => id);
}
