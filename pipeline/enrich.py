"""Turn a raw posting (company, title, locations) into searchable facts.

Everything here works from the title and location only, because that is all the public
trackers publish. Each rule is a plain regex so contributors can read and fix it.
"""
from __future__ import annotations

import re

# Tracks are the career paths the roadmap teaches. Order matters: first match wins.
TRACKS = [
    ("llm", "LLM & GenAI Engineer", r"\b(llm|large language|gen(erative)?\s?ai|genai|foundation model|agent(s|ic)?|rag|prompt|chatbot|language model|copilot)\b"),
    ("research", "AI Research Scientist", r"\bresearch (scientist|engineer|intern)|\bresearcher\b|\bresidency\b|\bphd\b"),
    ("vision", "Computer Vision Engineer", r"\b(computer vision|vision|perception|image|imaging|video|3d|graphics|cv)\b"),
    ("nlp", "NLP & Speech Engineer", r"\b(nlp|natural language|speech|audio|asr|tts|conversational|search|ranking|recommend\w*|retrieval)\b"),
    ("robotics", "Robotics & Autonomy Engineer", r"\b(robot\w*|autonom\w*|self-driving|controls?|embodied|drone|uav|motion planning|slam)\b"),
    ("infra", "AI Infrastructure & GPU Engineer", r"\b(gpu|cuda|kernel|compiler|inference|accelerat\w*|silicon|asic|fpga|hpc|distributed|systems|performance|chip|hardware|asic|tpu|npu)\b"),
    ("mlops", "MLOps & Data Engineer", r"\b(mlops|ml ops|data engineer\w*|data platform|pipeline|etl|platform|infrastructure|devops|cloud)\b"),
    ("quant", "Quant Researcher", r"\b(quant\w*|trading|trader|alpha|market|portfolio|risk|derivatives?)\b"),
    ("ds", "Data Scientist", r"\b(data scien\w*|analytics|analyst|statistic\w*|insights?|business intelligence|bi)\b"),
    ("mle", "Machine Learning Engineer", r"\b(machine learning|ml|ai|deep learning|neural|artificial intelligence|model\w*)\b"),
]
TRACK_NAMES = {k: name for k, name, _ in TRACKS}
_TRACK_RE = [(k, re.compile(rx, re.I)) for k, _, rx in TRACKS]

# A posting is "AI" if the tracker filed it as AI/ML/Data or Quant, or its title says so.
AI_TITLE = re.compile(
    r"\b(ai|a\.i\.|ml|mlops|machine learning|artificial intelligence|applied scien\w*|deep learning|llm|genai|gen ai|generative|nlp|computer vision|vision|"
    r"data scien\w*|neural|reinforcement|robot\w*|autonom\w*|perception|gpu|cuda|inference|research scientist|"
    r"quant\w*|speech|recommend\w*|foundation model|agent(s|ic)?)\b",
    re.I,
)
AI_CATEGORIES = {"AI/ML/Data", "Data Science, AI & Machine Learning", "Quant", "Quantitative Finance"}

# Skills we can honestly read off a title. The roadmap uses the same ids.
SKILLS = {
    "python": r"\b(python|software|engineer\w*|developer|ml|machine learning|data)\b",
    "pytorch": r"\b(pytorch|deep learning|neural|ml|machine learning|research scientist|llm|vision|nlp)\b",
    "llms": r"\b(llm|large language|genai|gen ai|generative|foundation model|language model|agent(s|ic)?|rag)\b",
    "cv": r"\b(computer vision|vision|perception|image|imaging|video|3d)\b",
    "nlp": r"\b(nlp|natural language|speech|audio|language|conversational|search)\b",
    "rl": r"\b(reinforcement|rl|robot\w*|control|autonom\w*|planning)\b",
    "cuda": r"\b(gpu|cuda|kernel|accelerat\w*|hpc|compiler|inference|performance)\b",
    "distributed": r"\b(distributed|systems|infrastructure|platform|scal\w*|cloud|backend)\b",
    "mlops": r"\b(mlops|ml ops|deploy\w*|production|pipeline|platform|infrastructure)\b",
    "sql": r"\b(data|analytics|analyst|sql|business intelligence|bi|insights?)\b",
    "stats": r"\b(statistic\w*|data scien\w*|quant\w*|research|analytics|econom\w*|experimentation)\b",
    "math": r"\b(quant\w*|research|scientist|math\w*|optimization|trading)\b",
    "cpp": r"(?<![a-z])(c\+\+|cpp|embedded|firmware|low latency|trading system|systems|gpu|cuda|robot\w*|hardware)(?!\w)",
}
_SKILL_RE = {k: re.compile(rx, re.I) for k, rx in SKILLS.items()}

US_STATES = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND "
    "OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split()
US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
    "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
    "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
    "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
}
US_ALIASES = {"nyc", "sf", "la", "south sf", "united states", "usa", "us", "remote in usa", "remote in us", "remote"}
COUNTRY_ALIASES = {"usa": "United States", "us": "United States", "u.s.": "United States", "uk": "United Kingdom", "u.k.": "United Kingdom", "england": "United Kingdom", "uae": "United Arab Emirates",
                   "the netherlands": "Netherlands", "south korea": "South Korea", "korea": "South Korea"}
CA_PROVINCES = {"ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE"}


def country_of(loc: str) -> str:
    s = loc.strip()
    low = s.lower()
    m = re.match(r"remote in (.+)$", low)
    if m:
        rest = m.group(1).strip()
        if rest in {"usa", "us", "united states"}:
            return "United States"
        return COUNTRY_ALIASES.get(rest, rest.title())
    if low in US_ALIASES or low in US_STATE_NAMES:
        return "United States"
    if " - " in s:  # "Dubai - United Arab Emirates"
        s = s.split(" - ")[-1]
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if not parts:
        return "Unknown"
    last = parts[-1]
    if last.upper() in US_STATES and len(last) == 2:
        return "United States"
    if last.upper() in CA_PROVINCES and len(last) == 2:
        return "Canada"
    if last.lower() in US_STATE_NAMES:
        return "United States"
    return COUNTRY_ALIASES.get(last.lower(), last if last[:1].isupper() else last.title())


def is_remote(locs: list[str]) -> bool:
    return any(re.search(r"\bremote\b", l, re.I) for l in locs)


def track_of(title: str, category: str = "") -> str:
    for k, rx in _TRACK_RE:
        if rx.search(title):
            return k
    if category in ("Quant", "Quantitative Finance"):
        return "quant"
    return "mle"


def skills_of(title: str, track: str) -> list[str]:
    found = [k for k, rx in _SKILL_RE.items() if rx.search(title)]
    base = {"llm": ["llms", "pytorch"], "research": ["pytorch", "math"], "vision": ["cv", "pytorch"],
            "nlp": ["nlp", "pytorch"], "robotics": ["rl", "cpp"], "infra": ["cuda", "cpp"],
            "mlops": ["mlops", "distributed"], "quant": ["stats", "math"], "ds": ["sql", "stats"],
            "mle": ["pytorch", "mlops"]}[track]
    out = ["python"]
    for s in base + found:
        if s not in out:
            out.append(s)
    return out


def level_of(title: str, kind: str) -> str:
    t = title.lower()
    if re.search(r"\bph\.?d\b|\bdoctoral\b", t):
        return "PhD"
    if re.search(r"\b(master'?s|ms|msc)\b", t):
        return "Masters"
    return "Undergrad" if kind == "internship" else "New grad"


DATA_TITLE = re.compile(
    r"\b(data|analytic\w*|analyst|scien\w*|research\w*|quant\w*|statistic\w*|intelligence|model\w*|algorithm\w*|"
    r"trading|trader|insights?|optimization|actuar\w*|econom\w*|bioinformatics|computational)\b",
    re.I,
)


def is_ai(title: str, category: str) -> bool:
    """AI by title, or filed as AI/data/quant by the tracker with a title that is about data or research."""
    if AI_TITLE.search(title):
        return True
    return category in AI_CATEGORIES and bool(DATA_TITLE.search(title))


def pay_per_hour(text: str) -> float | None:
    """'$50/hr' -> 50, '$120k/yr' or '$120,000' -> hourly at 2,080 h/yr."""
    if not text:
        return None
    m = re.search(r"\$\s?([\d,.]+)\s*(k)?\s*(/\s*(hr|hour|h|yr|year))?", text, re.I)
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    if m.group(2):
        v *= 1000
    unit = (m.group(4) or "").lower()
    if unit in ("yr", "year") or v > 1000:
        v /= 2080
    return round(v, 1) if 5 <= v <= 500 else None
