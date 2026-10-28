"""Read early-career roles from employers' public Workday career sites.

Many banks, insurers, consultancies, retailers and manufacturers post on Workday, which serves
each career site's search as JSON. `python -m pipeline.workday .sources` searches every site in
pipeline/curated/workday.json for internships and graduate roles and saves the results to
.sources/workday/<tenant>_<site>.json; load() turns them into raw jobs for the build.

A site's host is usually <tenant>.wd<N>.myworkdayjobs.com. When the list gives several N values,
fetch() tries each and prints the one that answered, so the list can be pinned.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from pipeline.ats import kind_of
from pipeline.sources import DAY

HERE = os.path.dirname(os.path.abspath(__file__))
SEARCHES = ("intern", "graduate", "analyst program", "early career")
PAGES = 5  # 20 postings a page: up to 100 per search


def sites() -> list[dict]:
    with open(os.path.join(HERE, "curated", "workday.json")) as f:
        return json.load(f)["sites"]


def _post(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "Ada job board (github.com/parveen06naresh/ada)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def _search(host: str, s: dict) -> dict:
    api = f"https://{host}/wday/cxs/{s['tenant']}/{s['site']}/jobs"
    seen: dict[str, dict] = {}
    for term in SEARCHES:
        for page in range(PAGES):
            data = _post(api, {"appliedFacets": {}, "limit": 20, "offset": page * 20, "searchText": term})
            posts = data.get("jobPostings") or []
            for p in posts:
                if p.get("externalPath"):
                    seen[p["externalPath"]] = p
            if len(posts) < 20 or (page + 1) * 20 >= (data.get("total") or 0):
                break
            time.sleep(0.1)
    return {"host": host, "postings": list(seen.values())}


def _fetch_one(s: dict, dest: str) -> str:
    hosts = [s["host"].replace("{wd}", f"wd{n}") for n in s.get("wd", [""])] if "{wd}" in s["host"] else [s["host"]]
    err = None
    for host in hosts:
        try:
            out = _search(host, s)
            with open(os.path.join(dest, f"{s['tenant']}_{s['site']}.json"), "w") as f:
                json.dump(out, f)
            return f"ok: {s['company']} at {host} ({len(out['postings'])} postings)"
        except Exception as e:  # wrong host or a moved site: try the next, never break the build
            err = e
    return f"warn: {s['company']} ({s['tenant']}/{s['site']}): {err}"


def fetch(dest: str) -> None:
    os.makedirs(dest, exist_ok=True)
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda s: _fetch_one(s, dest), sites()))
    for line in results:
        print(line, file=sys.stderr if line.startswith("warn") else sys.stdout)
    print(f"workday sites: {sum(r.startswith('ok') for r in results)} read, {sum(r.startswith('warn') for r in results)} skipped")


def _posted(text: str, now: float) -> int:
    t = (text or "").lower()
    if "today" in t:
        return int(now)
    if "yesterday" in t:
        return int(now - DAY)
    m = re.search(r"(\d+)\+?\s*days?", t)
    return int(now - int(m.group(1)) * DAY) if m else 0


def parse(data: dict, s: dict, now: float) -> list[dict]:
    out = []
    for p in data.get("postings", []):
        title = (p.get("title") or "").strip()
        kind = kind_of(title)
        if not kind:
            continue
        loc = (p.get("locationsText") or "").strip()
        out.append({"company": s["company"], "title": title, "locations": [loc] if loc and not re.match(r"\d+ Locations", loc) else [],
                    "url": f"https://{data['host']}/en-US/{s['site']}{p['externalPath']}", "posted": _posted(p.get("postedOn", ""), now),
                    "kind": kind, "category": s.get("category", ""), "pay": "", "source": "employer", "domain": s.get("domain", "")})
    return out


def load(src_dir: str, now: float | None = None) -> list[dict]:
    now = now or time.time()
    d = os.path.join(src_dir, "workday")
    jobs = []
    for s in sites():
        path = os.path.join(d, f"{s['tenant']}_{s['site']}.json")
        if os.path.exists(path):
            with open(path) as f:
                jobs += parse(json.load(f), s, now)
    return jobs


if __name__ == "__main__":
    fetch(os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".sources", "workday"))
