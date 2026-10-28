import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { useResumeTerms, adaScore, bestTracks, fitJob, gapPlan, parseResume, profileFromResume, rankByFit, resumeChecks, useGraph } from "../site/js/resume.js";

const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 28);
const D = Math.floor(NOW / DAY);
const job = (o) => ({ id: "x", k: "internship", t: "ML Intern", c: "Acme", l: ["SF"], co: ["United States"], r: false, tr: "mle", s: ["python", "pytorch", "mlops"], lv: "Undergrad", u: "https://x", d: D, p: null, ...o });
const graph = JSON.parse(readFileSync(new URL("../pipeline/curated/skills.json", import.meta.url)));
useGraph(graph);

const RESUME = `Jane Doe
jane@usf.edu | (813) 555-0100 | linkedin.com/in/janedoe | github.com/janedoe
EDUCATION
University of South Florida, B.S. Computer Science, Expected May 2028
EXPERIENCE
• Built a PyTorch image classifier that cut labeling time by 40% for 3 researchers
• Trained XGBoost models on 2M rows with SQL and pandas, improving AUC from 0.71 to 0.80
• Responsible for weekly reports
PROJECTS
• Deployed a FastAPI service on AWS with Docker serving 500 requests a day
SKILLS
Python, SQL, PyTorch, Docker, Git, statistics`;

test("reads skills, level and what to apply for", () => {
  const r = parseResume(RESUME, NOW);
  assert.equal(r.level, "Undergrad");
  assert.deepEqual(r.grad, { y: 2028, m: 5 });
  assert.equal(r.kind, "internship");
  for (const s of ["python", "sql", "pytorch", "mlops", "ml", "stats", "git"]) assert.ok(r.skills.includes(s), s);
  assert.ok(r.email && r.phone && r.linkedin && r.github);
  assert.equal(r.bullets, 4);
  assert.equal(r.quantified, 3);
  assert.equal(r.weak.length, 1);
});

test("graduating within a year means new-grad roles; degrees are read", () => {
  assert.equal(parseResume("Purdue University, B.S. Statistics, May 2027", NOW).kind, "new-grad");
  assert.equal(parseResume("Stanford University, M.S. in Computer Science, 2027", NOW).level, "Masters");
  assert.equal(parseResume("MIT, Ph.D. EECS, 2029", NOW).level, "PhD");
  assert.equal(parseResume("Skills: MS Word, Excel", NOW).level, "Undergrad");
});

test("checks put the failures first with a fix", () => {
  const c = resumeChecks(parseResume(RESUME, NOW));
  assert.equal(c[0].ok, false);
  assert.ok(c.find((x) => x.title === "Weak phrases" && !x.ok).fix.includes("responsible for"));
  assert.ok(c.find((x) => x.title === "Contact details").ok);
});

test("fit rewards the goal track and known skills, and lists what is missing", () => {
  const p = { tracks: ["mle"], known: ["python", "pytorch"], kind: "internship", level: "Undergrad", countries: ["United States"] };
  const a = fitJob(job({}), p, NOW);
  assert.deepEqual(a.have, ["pytorch"]);
  assert.deepEqual(a.missing, ["math", "sql", "ml", "mlops"]);  // the track's core skills count, not only the title's
  const b = fitJob(job({ tr: "quant", s: ["python", "stats", "math"] }), p, NOW);
  assert.ok(a.fit > b.fit);
  assert.equal(fitJob(job({}), { ...p, known: ["math", "sql", "ml", "pytorch", "mlops"] }, NOW).fit, 88);  // no resume: title relevance is neutral
  useResumeTerms("I built ML models");
  assert.equal(fitJob(job({}), { ...p, known: ["math", "sql", "ml", "pytorch", "mlops"] }, NOW).fit, 100);
  assert.ok(fitJob(job({ t: "Supply Chain Analytics Intern" }), p, NOW).fit < fitJob(job({}), p, NOW).fit);
  useResumeTerms(null);
  assert.ok(fitJob(job({ lv: "PhD" }), p, NOW).fit < a.fit);
  assert.equal(rankByFit([job({ id: "q", tr: "quant" }), job({ id: "m" })], p, 5, NOW)[0].j.id, "m");
});

test("gap plan ranks the skills that unlock the most target roles", () => {
  const p = { tracks: ["mle"], known: ["math", "sql", "ml", "mlops"], kind: "internship", countries: [] };
  const jobs = [job({ s: ["python", "pytorch", "cuda"] }), job({ s: ["python", "pytorch"] }), job({ tr: "quant", s: ["python", "cpp"] })];
  const g = gapPlan(jobs, p, graph, 4, NOW);
  assert.equal(g[0].id, "pytorch");
  assert.equal(g[0].roles, 2);
  assert.equal(g[1].id, "cuda");
  assert.ok(!g.some((x) => x.id === "cpp"));
});

test("Ada score blends skill fit and resume checks", () => {
  assert.equal(adaScore([{ fit: 100 }, { fit: 80 }], [{ ok: true }, { ok: false }]), 74);
  assert.equal(adaScore([], []), 0);
});

test("a resume becomes a profile with the tracks it covers best", () => {
  const r = parseResume(RESUME, NOW);
  const p = profileFromResume(r, graph, {});
  assert.equal(p.kind, "internship");
  assert.ok(["mle", "mlops", "ds"].includes(p.tracks[0]), p.tracks[0]);
  assert.equal(bestTracks(graph, ["python", "cuda", "cpp", "distributed"], 1)[0].id, "infra");
  assert.deepEqual(profileFromResume(r, graph, { tracks: ["quant"], tracksFromUser: true }).tracks, ["quant"]);
});
