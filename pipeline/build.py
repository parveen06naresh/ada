"""Build the site's data: python -m pipeline.build [--src .sources] [--out site/data]

Reads the trackers (pipeline/fetch.sh clones them), keeps AI, ML, data and quant roles,
tags each with a track, skills, level and country, and writes:

  opportunities.json  every open role, compact keys (see FIELDS)
  programs.json       hackathons, fellowships, grants, startup and compute programs
  skills.json         the roadmap skill graph
  stats.json          the numbers behind the Trends page
  feed.xml            RSS of the newest roles, for the weekly digest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import statistics
import time
from collections import Counter
from email.utils import formatdate
from xml.sax.saxutils import escape

from pipeline import enrich
from pipeline.sources import DAY, load_all

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIELDS = {"id": "id", "k": "kind", "t": "title", "c": "company", "l": "locations", "co": "countries",
          "r": "remote", "tr": "track", "s": "skills", "lv": "level", "u": "url", "d": "posted (unix days)",
          "p": "pay per hour (USD, when published)", "src": "source", "dm": "company website, when a tracker lists it"}


def _key(j: dict) -> str:
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()  # noqa: E731
    return f"{norm(j['company'])}|{norm(j['title'])}|{norm((j['locations'] or [''])[0])}"


def build_jobs(raw: list[dict]) -> list[dict]:
    # Company websites (for logos) come from trackers that publish them; reuse across sources by name.
    domains = {j["company"].lower(): j["domain"] for j in raw if j.get("domain")}
    seen: dict[str, dict] = {}
    for j in raw:
        if not enrich.is_ai(j["title"], j["category"]):
            continue
        k = _key(j)
        pay = enrich.pay_per_hour(j.get("pay", ""))
        if k in seen:  # same role on two trackers: keep the earliest date and any pay we saw
            old = seen[k]
            old["d"] = min(old["d"], j["posted"] // DAY) if j["posted"] else old["d"]
            old["p"] = old["p"] or pay
            continue
        track = enrich.track_of(j["title"], j["category"])
        locs = j["locations"][:6]
        countries = sorted({enrich.country_of(l) for l in locs}) or ["Unknown"]
        seen[k] = {
            "id": hashlib.sha1(k.encode()).hexdigest()[:10],
            "k": j["kind"],
            "t": j["title"],
            "c": j["company"],
            "l": locs,
            "co": countries,
            "r": enrich.is_remote(locs),
            "tr": track,
            "s": enrich.skills_of(j["title"], track),
            "lv": enrich.level_of(j["title"], j["kind"]),
            "u": j["url"],
            "d": j["posted"] // DAY,
            "p": pay,
            "src": j["source"],
            "dm": domains.get(j["company"].lower(), ""),
        }
    return sorted(seen.values(), key=lambda x: (-x["d"], x["c"].lower()))


STRING_FIELDS = ("k", "c", "l", "co", "tr", "s", "lv", "src", "dm")


def pack_jobs(jobs: list[dict], now: float) -> dict:
    """Columnar layout: one row per role, repeated strings stored once. About 4x faster to parse than objects."""
    keys = list(FIELDS)
    strings: list[str] = []
    index: dict[str, int] = {}

    def ref(v):
        if v not in index:
            index[v] = len(strings)
            strings.append(v)
        return index[v]

    rows = []
    for j in jobs:
        row = []
        for k in keys:
            v = j[k]
            if k in STRING_FIELDS:
                v = [ref(x) for x in v] if isinstance(v, list) else ref(v)
            elif k == "r":
                v = int(v)
            row.append(v)
        rows.append(row)
    return {"fields": FIELDS, "keys": keys, "strings_in": list(STRING_FIELDS), "updated": int(now),
            "strings": strings, "rows": rows}


def build_stats(jobs: list[dict], programs: list[dict], now: float) -> dict:
    today = int(now // DAY)
    n = len(jobs) or 1
    skill_counts = Counter(s for j in jobs for s in j["s"])
    by_track = Counter(j["tr"] for j in jobs)
    pay = {}
    for tr in enrich.TRACK_NAMES:
        for kind in ("internship", "new-grad"):
            v = [j["p"] for j in jobs if j["tr"] == tr and j["k"] == kind and j["p"]]
            if len(v) >= 3:
                pay.setdefault(tr, {})[kind] = {"median": statistics.median(v), "n": len(v)}
    weeks = []
    for w in range(11, -1, -1):
        lo, hi = today - 7 * (w + 1), today - 7 * w
        weeks.append({"weeks_ago": w, "n": sum(1 for j in jobs if lo < j["d"] <= hi)})
    return {
        "updated": int(now),
        "total": len(jobs),
        "new_7d": sum(1 for j in jobs if j["d"] > today - 7),
        "internships": sum(1 for j in jobs if j["k"] == "internship"),
        "new_grad": sum(1 for j in jobs if j["k"] == "new-grad"),
        "remote_share": round(sum(1 for j in jobs if j["r"]) / n, 4),
        "companies": len({j["c"] for j in jobs}),
        "countries": Counter(c for j in jobs for c in j["co"]).most_common(15),
        "top_companies": Counter(j["c"] for j in jobs).most_common(20),
        "tracks": [[k, enrich.TRACK_NAMES[k], by_track.get(k, 0)] for k in enrich.TRACK_NAMES],
        "skills": {k: round(v / n, 4) for k, v in skill_counts.most_common()},
        "pay": pay,
        "weekly": weeks,
        "programs": dict(Counter(p["type"] for p in programs)),
    }


def build_feed(jobs: list[dict], now: float, site_url: str) -> str:
    items = []
    for j in jobs[:100]:
        when = formatdate(j["d"] * DAY, usegmt=True)
        where = ", ".join(j["l"][:2]) or "Location not listed"
        items.append(
            f"<item><title>{escape(j['c'])}: {escape(j['t'])}</title><link>{escape(j['u'])}</link>"
            f"<guid isPermaLink=\"false\">{j['id']}</guid><pubDate>{when}</pubDate>"
            f"<description>{escape(enrich.TRACK_NAMES[j['tr']])} · {escape(j['k'])} · {escape(where)}</description></item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
        f"<title>Ada: new AI roles</title><link>{escape(site_url)}</link>"
        "<description>New AI, ML, data and quant internships and new-grad roles, refreshed daily.</description>"
        f"<lastBuildDate>{formatdate(now, usegmt=True)}</lastBuildDate>{''.join(items)}</channel></rss>\n"
    )


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, ".sources"))
    ap.add_argument("--out", default=os.path.join(ROOT, "site", "data"))
    ap.add_argument("--site-url", default=os.environ.get("SITE_URL", "https://parveen06naresh.github.io/ada/"))
    a = ap.parse_args(argv)
    now = time.time()
    jobs = build_jobs(load_all(a.src, now))
    with open(os.path.join(HERE, "curated", "programs.json")) as f:
        programs = json.load(f)
    os.makedirs(a.out, exist_ok=True)
    dump = lambda name, obj: json.dump(obj, open(os.path.join(a.out, name), "w"), separators=(",", ":"))  # noqa: E731
    dump("opportunities.json", pack_jobs(jobs, now))
    dump("latest.json", pack_jobs(jobs[:40], now))  # newest roles, shown while the full list loads
    dump("programs.json", programs)
    dump("stats.json", build_stats(jobs, programs, now))
    shutil.copy(os.path.join(HERE, "curated", "skills.json"), os.path.join(a.out, "skills.json"))
    with open(os.path.join(a.out, "feed.xml"), "w") as f:
        f.write(build_feed(jobs, now, a.site_url))
    print(f"{len(jobs)} roles from {len({j['c'] for j in jobs})} companies, {len(programs)} programs -> {a.out}")


if __name__ == "__main__":
    main()
