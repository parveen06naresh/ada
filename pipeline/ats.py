"""Read early-career roles straight from employers' public job boards (Greenhouse, Lever, Ashby).

`python -m pipeline.ats .sources` downloads each board in pipeline/curated/boards.json to
.sources/ats/<ats>_<token>.json; load() turns the saved files into raw jobs for the build.
Only internships, co-ops and new-grad style roles are kept; the AI filter runs later in build.py.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

from pipeline.sources import _domain

HERE = os.path.dirname(os.path.abspath(__file__))
API = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{t}/jobs",
    "lever": "https://api.lever.co/v0/postings/{t}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{t}?includeCompensation=true",
}
INTERN = re.compile(r"\b(intern|internship|co-?op|summer (student|analyst|associate))\b", re.I)
EARLY = re.compile(r"\b(new grad(uate)?|university grad(uate)?|graduate (program|role|engineer|researcher|scientist)|"
                    r"campus|early career|entry[- ]level|junior|associate engineer|residency|resident|2026 grad|2027 grad)\b", re.I)
SENIOR = re.compile(r"\b(senior|staff|principal|lead|manager|director|head of|sr\.?)\b", re.I)


def boards() -> list[list[str]]:
    with open(os.path.join(HERE, "curated", "boards.json")) as f:
        return json.load(f)["boards"]


def kind_of(title: str) -> str | None:
    """'internship', 'new-grad', or None when the role is not early-career."""
    if SENIOR.search(title) and not INTERN.search(title):
        return None
    if INTERN.search(title):
        return "internship"
    if EARLY.search(title):
        return "new-grad"
    return None


def _ts(v) -> int:
    if not v:
        return 0
    if isinstance(v, (int, float)):
        return int(v / 1000) if v > 1e11 else int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def parse(ats: str, data, company: str, site: str) -> list[dict]:
    """One board's API response -> raw jobs (same shape as pipeline/sources.py)."""
    if ats == "greenhouse":
        rows = [(j.get("title", ""), [(j.get("location") or {}).get("name", "")], j.get("absolute_url", ""),
                 _ts(j.get("first_published") or j.get("updated_at")), "") for j in data.get("jobs", [])]
    elif ats == "lever":
        rows = [(j.get("text", ""), (j.get("categories") or {}).get("allLocations")
                 or [(j.get("categories") or {}).get("location", "")], j.get("hostedUrl", ""), _ts(j.get("createdAt")),
                 (j.get("salaryRange") or {}) and f"${j['salaryRange'].get('min', '')}-{j['salaryRange'].get('max', '')}/{j['salaryRange'].get('interval', 'yr')}")
                for j in (data if isinstance(data, list) else [])]
    elif ats == "ashby":
        rows = []
        for j in data.get("jobs", []):
            if j.get("isListed") is False:
                continue
            locs = [j.get("location", "")] + [s.get("location", "") for s in j.get("secondaryLocations") or []]
            if j.get("isRemote") and not any("remote" in l.lower() for l in locs):
                locs.append("Remote")
            pay = (j.get("compensation") or {}).get("compensationTierSummary") or ""
            rows.append((j.get("title", ""), locs, j.get("jobUrl", ""), _ts(j.get("publishedAt")), pay))
    else:
        return []
    out = []
    for title, locs, url, posted, pay in rows:
        kind = kind_of(title)
        if not kind or not url:
            continue
        out.append({"company": company, "title": title.strip(), "locations": [l.strip() for l in locs if l and l.strip()],
                    "url": url, "posted": posted, "kind": kind, "category": "", "pay": pay or "",
                    "source": "employer", "domain": site or _domain(url)})
    return out


def fetch(dest: str) -> None:
    os.makedirs(dest, exist_ok=True)
    ok = bad = 0
    for ats, token, name, _ in boards():
        url = API[ats].format(t=token)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Ada job board (github.com/parveen06naresh/ada)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            json.loads(body)
            with open(os.path.join(dest, f"{ats}_{token}.json"), "wb") as f:
                f.write(body)
            ok += 1
        except Exception as e:  # a moved or closed board should never break the daily build
            bad += 1
            print(f"warn: {name} ({ats}/{token}): {e}", file=sys.stderr)
        time.sleep(0.2)
    print(f"employer boards: {ok} read, {bad} skipped")


def load(src_dir: str) -> list[dict]:
    d = os.path.join(src_dir, "ats")
    jobs = []
    for ats, token, name, site in boards():
        path = os.path.join(d, f"{ats}_{token}.json")
        if os.path.exists(path):
            with open(path) as f:
                jobs += parse(ats, json.load(f), name, site)
    return jobs


if __name__ == "__main__":
    fetch(os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".sources", "ats"))
