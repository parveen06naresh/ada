"""Readers for the public opportunity trackers. Each returns a list of raw dicts:

    {company, title, locations, url, posted (unix s), kind ("internship"|"new-grad"),
     category, pay (str), source}

Add a new source by writing one function here and listing it in SOURCES.
"""
from __future__ import annotations

import html
import json
import os
import re
import time

DAY = 86400


def _simplify(path: str, kind: str, source: str) -> list[dict]:
    with open(path) as f:
        rows = json.load(f)
    out = []
    for r in rows:
        if not r.get("active") or not r.get("is_visible", True):
            continue
        out.append({
            "company": r["company_name"].strip(),
            "title": r["title"].strip(),
            "locations": [l.strip() for l in r.get("locations") or [] if l.strip()],
            "url": r["url"],
            "posted": int(r.get("date_posted") or r.get("date_updated") or 0),
            "kind": kind,
            "category": r.get("category") or "",
            "pay": "",
            "source": source,
        })
    return out


_A = re.compile(r'<a href="([^"]+)"')
_TAG = re.compile(r"<[^>]+>")


def _domain(url: str) -> str:
    m = re.match(r"https?://(?:www\.)?([^/?#]+)", url)
    return m.group(1).lower() if m else ""


def _speedyapply(path: str, kind: str, source: str, now: float, base: str = "AI/ML/Data") -> list[dict]:
    """Markdown tables: Company | Position | Location | [Salary] | Posting | Age, under FAANG/Quant/Other headings."""
    out, cols, section = [], [], ""
    with open(path) as f:
        for line in f:
            if line.startswith("#"):
                section = line.strip("# \n").lower()
                continue
            if not line.startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells[0] == "Company":
                cols = [c.lower() for c in cells]
                continue
            if not cols or set(cells[0]) <= {"-", ":"} or len(cells) != len(cols):
                continue
            row = dict(zip(cols, cells))
            link = _A.search(row.get("posting", ""))
            if not link:
                continue
            age = re.match(r"(\d+)\s*(d|mo)", row.get("age", ""))
            days = int(age.group(1)) * (30 if age and age.group(2) == "mo" else 1) if age else 0
            loc = html.unescape(_TAG.sub("", row.get("location", ""))).strip()
            loc = re.sub(r"\s*\+\d+$", "", loc)
            home = _A.search(row["company"])
            out.append({
                "domain": _domain(home.group(1)) if home else "",
                "company": html.unescape(_TAG.sub("", row["company"])).strip(),
                "title": html.unescape(_TAG.sub("", row["position"])).strip(),
                "locations": [loc] if loc else [],
                "url": link.group(1),
                "posted": int(now - days * DAY),
                "kind": kind,
                "category": "Quant" if "quant" in section else base,
                "pay": row.get("salary", ""),
                "source": source,
            })
    return out


_ZAPPLY_SECTIONS = {"software engineering": "Software", "security engineering": "Software", "data science & ai": "Data Science & AI",
                    "data, ai & research": "Data Science & AI", "hardware & engineering": "Hardware & Engineering",
                    "hardware & systems engineering": "Hardware & Engineering", "product, design & research": "Product, Design & Research",
                    "business & operations": "Business & Operations"}
_AGE = {"m": 60, "h": 3600, "d": DAY, "w": 7 * DAY}


def _zapply(path: str, kind: str, now: float) -> list[dict]:
    """Zapply README tables (Company | Role | Location | Posted | Visa | Apply) under one heading per field.
    Their data terms ask for credit and a link back, which the site footer gives."""
    from pipeline.ats import SENIOR, kind_of
    out, category = [], None
    with open(path) as f:
        for line in f:
            h = re.search(r"<strong>([^<]+)</strong></h3>", line)
            if h:
                category = _ZAPPLY_SECTIONS.get(html.unescape(h.group(1)).strip().lower(), "")
                continue
            if category is None or not line.startswith("| **"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 6:
                continue
            title = html.unescape(cells[1])
            link = re.search(r"\]\((https://[^)\s]+)\)", cells[5])
            if not link or SENIOR.search(title) and not re.search(r"\bintern", title, re.I):
                continue
            age = re.match(r"(\d+)([mhdw])$", cells[3])
            loc = html.unescape(cells[2]).replace("...", "").strip(" ,-")
            out.append({
                "company": html.unescape(cells[0].strip("* ")),
                "title": title,
                "locations": [loc] if loc else [],
                "url": link.group(1),
                "posted": int(now - int(age.group(1)) * _AGE[age.group(2)]) if age else 0,
                "kind": kind_of(title) or kind,
                "category": category,
                "pay": "",
                "source": "zapply",
                "visa": "Sponsor" in cells[4],
            })
    return out


def load_all(src_dir: str, now: float | None = None) -> list[dict]:
    """Read every tracker cloned under src_dir (see pipeline/fetch.sh). Missing ones are skipped."""
    now = now or time.time()
    p = lambda *a: os.path.join(src_dir, *a)  # noqa: E731
    jobs = []
    plan = [
        (_simplify, p("SimplifyJobs_Summer2027-Internships", ".github", "scripts", "listings.json"), "internship", "SimplifyJobs"),
        (_simplify, p("SimplifyJobs_New-Grad-Positions", ".github", "scripts", "listings.json"), "new-grad", "SimplifyJobs"),
        (_simplify, p("vanshb03_Summer2027-Internships", ".github", "scripts", "listings.json"), "internship", "vanshb03"),
        (_simplify, p("vanshb03_New-Grad-2027", ".github", "scripts", "listings.json"), "new-grad", "vanshb03"),
    ]
    for fn, path, kind, src in plan:
        if os.path.exists(path):
            jobs += fn(path, kind, src)
    for sa, base in (("speedyapply_2027-AI-College-Jobs", "AI/ML/Data"), ("speedyapply_2027-SWE-College-Jobs", "Software")):
        for name, kind in (("README.md", "internship"), ("INTERN_INTL.md", "internship"),
                           ("NEW_GRAD_USA.md", "new-grad"), ("NEW_GRAD_INTL.md", "new-grad")):
            if os.path.exists(p(sa, name)):
                jobs += _speedyapply(p(sa, name), kind, "speedyapply", now, base)
    for repo, kind in (("zapplyjobs_Internships-2027", "internship"), ("zapplyjobs_New-Grad-Jobs-2027", "new-grad")):
        if os.path.exists(p(repo, "README.md")):
            jobs += _zapply(p(repo, "README.md"), kind, now)
    from pipeline import ats  # employer boards, saved by `python -m pipeline.ats`
    jobs += ats.load(src_dir)
    from pipeline import workday  # employer Workday career sites, saved by `python -m pipeline.workday`
    jobs += workday.load(src_dir, now)
    return jobs
