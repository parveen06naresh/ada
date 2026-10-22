import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { BADGES, checkIn, decodeProfile, encodeProfile, filterJobs, planRoadmap, recommend, scoreJob } from "../site/js/match.js";

const DAY = 864e5;
const NOW = 20000 * DAY;
const job = (o) => ({ id: "x", k: "internship", t: "ML Intern", c: "Acme", l: ["SF"], co: ["United States"], r: false, tr: "mle", s: ["python", "pytorch", "mlops"], lv: "Undergrad", u: "https://x", d: 20000, p: null, ...o });
const graph = JSON.parse(readFileSync(new URL("../pipeline/curated/skills.json", import.meta.url)));

test("filters combine", () => {
  const jobs = [job({ id: "a" }), job({ id: "b", k: "new-grad", t: "LLM Engineer", tr: "llm" }), job({ id: "c", r: true, co: ["Canada"], d: 19900 })];
  assert.deepEqual(filterJobs(jobs, { kind: "internship" }, NOW).map((j) => j.id), ["a", "c"]);
  assert.deepEqual(filterJobs(jobs, { text: "llm" }, NOW).map((j) => j.id), ["b"]);
  assert.deepEqual(filterJobs(jobs, { remote: true }, NOW).map((j) => j.id), ["c"]);
  assert.deepEqual(filterJobs(jobs, { days: 7 }, NOW).map((j) => j.id), ["a", "b"]);
  assert.deepEqual(filterJobs(jobs, { country: "Canada" }, NOW).map((j) => j.id), ["c"]);
  assert.deepEqual(filterJobs(jobs, { text: "acme sf" }, NOW).length, 3);
});

test("matching rewards goal, skills, place and freshness, with reasons", () => {
  const p = { tracks: ["mle"], kind: "internship", level: "Undergrad", countries: ["United States"], remoteOk: true, known: ["pytorch"] };
  const good = scoreJob(job({}), p, NOW);
  const wrongKind = scoreJob(job({ k: "new-grad" }), p, NOW);
  const elsewhere = scoreJob(job({ co: ["France"] }), p, NOW);
  const remote = scoreJob(job({ co: ["France"], r: true }), p, NOW);
  assert.ok(good.score > wrongKind.score && good.score > elsewhere.score);
  assert.ok(remote.score > elsewhere.score);
  assert.ok(good.why.some((w) => w.includes("Machine Learning Engineer")));
  assert.ok(good.why.includes("Posted this week"));
  const recs = recommend([job({ id: "1" }), job({ id: "2", tr: "quant", co: ["France"], k: "new-grad" })], p, 10, NOW);
  assert.deepEqual(recs.map((r) => r.j.id), ["1"]);
});

test("roadmap respects prerequisites and skips known skills", () => {
  for (const track of Object.keys(graph.tracks)) {
    const plan = planRoadmap(graph, track, [], 10);
    const pos = Object.fromEntries(plan.steps.map((s, i) => [s.id, i]));
    for (const s of plan.steps) for (const pre of s.prereqs) assert.ok(pos[pre] < pos[s.id], `${track}: ${pre} before ${s.id}`);
    assert.equal(plan.steps.at(-1).id, "portfolio");
  }
  const fresh = planRoadmap(graph, "llm", [], 10);
  const some = planRoadmap(graph, "llm", ["python", "math", "ml"], 10);
  assert.ok(some.totalWeeks < fresh.totalWeeks);
  assert.ok(some.steps.find((s) => s.id === "python").done);
  const fast = planRoadmap(graph, "llm", [], 40);
  assert.ok(fast.totalWeeks < fresh.totalWeeks);
});

test("share links round-trip, including non-ASCII", () => {
  const p = { t: "llm", done: ["python"], name: "Zoë" };
  assert.deepEqual(decodeProfile(encodeProfile(p)), p);
  assert.equal(decodeProfile("not base64!!"), null);
});

test("streaks grow on consecutive days and reset after a gap", () => {
  let s = checkIn({}, 100);
  s = checkIn(s, 101);
  s = checkIn(s, 101);
  assert.equal(s.streak, 2);
  s = checkIn(s, 105);
  assert.equal(s.streak, 1);
  assert.equal(s.best, 2);
  const earned = BADGES.filter((b) => b.test({ done: 3, total: 6, best: 7, saved: 0 })).map((b) => b.id);
  assert.deepEqual(earned, ["start", "three", "half", "streak7"]);
});

test("resume reading finds skills and ignores unrelated text", async () => {
  const { detectSkills } = await import("../site/js/match.js");
  const found = detectSkills("Built a RAG chatbot with LangChain and PyTorch; SQL (Postgres); deployed with Docker on AWS. Python, C++.");
  for (const s of ["rag", "pytorch", "sql", "mlops", "python", "cpp"]) assert.ok(found.includes(s), s);
  assert.deepEqual(detectSkills("I like hiking and cooking."), []);
  const ids = new Set(graph.skills.map((s) => s.id));
  for (const s of detectSkills("python git linear algebra statistics sql scikit-learn pytorch llm rag opencv nlp reinforcement learning c++ cuda spark docker arxiv trading")) assert.ok(ids.has(s), s);
});

test("coach prompt carries the facts and markdown rendering is safe", async () => {
  const { buildPrompt, renderMarkdown } = await import("../site/js/coach.js");
  const roadmap = planRoadmap(graph, "llm", ["python"], 10);
  const prompt = buildPrompt({
    profile: { kind: "internship", level: "Undergrad", countries: ["United States"], remoteOk: true, known: ["python"], hours: 10 },
    trackName: "LLM & GenAI Engineer", roadmap, matches: [{ j: job({ c: "Acme", t: "LLM Intern", u: "https://acme.example/1" }) }],
    demand: { python: 1, pytorch: 0.5 }, resume: "Built a chatbot",
  });
  assert.ok(prompt.includes("Acme: LLM Intern") && prompt.includes("https://acme.example/1"));
  assert.ok(prompt.includes("Built a chatbot") && prompt.includes("pytorch 50%") && !prompt.includes("python 100%"));
  assert.ok(prompt.includes("Python and tooling (already known)"));
  const html = renderMarkdown("## Plan\n- **Do** <script>alert(1)</script> [x](https://ok.example) [y](javascript:alert(1))\n1. one");
  assert.ok(html.includes("<h3>Plan</h3>") && html.includes("<b>Do</b>") && html.includes('href="https://ok.example"'));
  assert.ok(!html.includes("<script>") && !html.includes('href="javascript'));
  assert.ok(html.includes("<ol><li>one</li></ol>"));
});
