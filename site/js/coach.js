// AI coach: a personal 90-day plan from Claude, using the visitor's own Anthropic API key.
// The key goes from this browser straight to Anthropic. Ada has no server and never sees it.

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
export const MODEL = "claude-opus-5-5";

const SYSTEM = `You are a blunt, practical career coach for students breaking into AI, ML, data and quant roles.
Write for one person, from the facts you are given. Use only the job postings and learning resources provided:
never invent companies, links, deadlines or numbers. If the resume is missing, say what to add to it.

Format the answer in plain Markdown with these sections:
## Where you stand (3 sentences, honest)
## Your 90-day plan (weeks 1-4, 5-8, 9-12; each with concrete actions and hours)
## Three portfolio projects (each tied to the kind of role in the listed postings, with what to measure)
## Apply now (up to 8 of the listed postings, best fit first, one line each on why)
## Resume fixes (up to 5 bullet rewrites or additions)
Keep it under 900 words.`;

export function buildPrompt({ profile, trackName, roadmap, matches, demand, resume }) {
  const steps = roadmap.steps.map((s) => `- ${s.name}${s.done ? " (already known)" : ` (~${s.hours} h)`}: ${s.learn.map(([n, u]) => `${n} <${u}>`).join("; ")}`).join("\n");
  const jobs = matches.slice(0, 20).map((m, i) => `${i + 1}. ${m.j.c}: ${m.j.t} (${m.j.l[0] || "location not listed"}; ${m.j.k}) ${m.j.u}`).join("\n");
  const top = Object.entries(demand).filter(([k]) => k !== "python").slice(0, 8).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ");
  return `Goal role: ${trackName}
Looking for: ${profile.kind}; level: ${profile.level}; countries: ${(profile.countries || []).join(", ") || "any"}; remote ok: ${profile.remoteOk ? "yes" : "no"}
Time to learn: ${profile.hours} hours a week
Skills they marked as known: ${(profile.known || []).join(", ") || "none yet"}
Share of open roles where each skill is core: ${top}

Learning path (in order):
${steps}

Best-matching open postings right now:
${jobs || "none"}

Resume:
${resume?.trim() ? resume.trim().slice(0, 12000) : "(not provided)"}`;
}

export async function runCoach({ key, prompt, onText }) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  stream.on("text", onText);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request. Try removing unusual text from the resume.");
  return msg;
}

export function friendlyError(e) {
  const status = e?.status;
  if (status === 401) return "That API key was not accepted. Check it at console.anthropic.com and paste it again.";
  if (status === 429) return "Anthropic is rate-limiting this key right now. Wait a minute and try again.";
  if (status === 400) return `Anthropic rejected the request: ${e?.error?.error?.message || e.message}`;
  if (status >= 500) return "Anthropic had a temporary problem. Try again in a moment.";
  if (/Failed to fetch|NetworkError|import/i.test(String(e?.message))) return "Could not reach Anthropic from this page. If you're in a preview, open the live site instead.";
  return e?.message || "Something went wrong.";
}

// Minimal, safe Markdown: escape everything, then add headings, bold, bullets and links.
export function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/&lt;(https:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  let html = "";
  let list = null;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (li) {
      const kind = /^\s*\d+\./.test(line) ? "ol" : "ul";
      if (list !== kind) { if (list) html += `</${list}>`; html += `<${kind}>`; list = kind; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (list) { html += `</${list}>`; list = null; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) html += `<h${Math.min(4, h[1].length + 1)}>${inline(h[2])}</h${Math.min(4, h[1].length + 1)}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
