import json
import os

from pipeline import enrich
from pipeline.build import build_feed, build_jobs, build_stats
from pipeline.sources import DAY, _simplify, _speedyapply

HERE = os.path.dirname(__file__)
NOW = 1_800_000_000


def test_country_parsing():
    c = enrich.country_of
    assert c("San Jose, CA") == "United States"
    assert c("NYC") == "United States"
    assert c("Remote in USA") == "United States"
    assert c("Texas") == "United States"
    assert c("Toronto, ON, Canada") == "Canada"
    assert c("Waterloo, ON") == "Canada"
    assert c("London, UK") == "United Kingdom"
    assert c("Remote in UK") == "United Kingdom"
    assert c("Dubai - United Arab Emirates") == "United Arab Emirates"
    assert c("Munich, Germany") == "Germany"


def test_tracks_skills_and_levels():
    assert enrich.track_of("LLM Inference Engineer Intern") == "llm"
    assert enrich.track_of("Research Scientist Intern - Audio") == "research"
    assert enrich.track_of("CUDA Kernel Engineer") == "infra"
    assert enrich.track_of("Quantitative Trading Intern") == "quant"
    assert enrich.track_of("Data Analyst Intern") == "ds"
    assert enrich.track_of("Machine Learning Engineer") == "mle"
    assert enrich.track_of("Summer Analyst", "Quant") == "ds"  # title wins over category
    assert enrich.track_of("Summer Intern", "Quant") == "quant"
    s = enrich.skills_of("GPU Inference Engineer", "infra")
    assert s[0] == "python" and "cuda" in s and len(s) == len(set(s))
    assert enrich.level_of("Research Scientist Intern - PhD", "internship") == "PhD"
    assert enrich.level_of("ML Intern", "internship") == "Undergrad"
    assert enrich.level_of("ML Engineer", "new-grad") == "New grad"


def test_ai_filter():
    assert enrich.is_ai("Machine Learning Intern", "Software")
    assert enrich.is_ai("Data Engineer", "AI/ML/Data")
    assert not enrich.is_ai("Accounting Intern", "AI/ML/Data")
    assert not enrich.is_ai("Frontend Engineer", "Software")


def test_pay():
    assert enrich.pay_per_hour("$50/hr") == 50
    assert enrich.pay_per_hour("$208k/yr") == 100
    assert enrich.pay_per_hour("$104,000") == 50
    assert enrich.pay_per_hour("") is None
    assert enrich.pay_per_hour("competitive") is None


def test_speedyapply_markdown():
    rows = _speedyapply(os.path.join(HERE, "fixtures", "speedy.md"), "internship", "speedyapply", NOW)
    assert [r["company"] for r in rows] == ["Meta", "Microsoft", "Jane Street"]  # row with no link is skipped
    meta, ms, js = rows
    assert meta["locations"] == ["Menlo Park, CA"] and meta["pay"] == "$50/hr"
    assert meta["posted"] == NOW - 3 * DAY
    assert ms["title"] == "Data Scientist & Analyst" and ms["posted"] == NOW - 60 * DAY
    assert js["category"] == "Quant" and js["pay"] == ""


def test_simplify_json(tmp_path):
    p = tmp_path / "listings.json"
    p.write_text(json.dumps([
        {"company_name": "A", "title": "ML Intern", "locations": ["SF"], "url": "u1", "date_posted": NOW, "active": True, "is_visible": True, "category": "AI/ML/Data"},
        {"company_name": "B", "title": "ML Intern", "locations": [], "url": "u2", "date_posted": NOW, "active": False, "category": "AI/ML/Data"},
        {"company_name": "C", "title": "ML Intern", "locations": [], "url": "u3", "date_posted": NOW, "active": True, "is_visible": False},
    ]))
    rows = _simplify(str(p), "internship", "SimplifyJobs")
    assert [r["company"] for r in rows] == ["A"]


def _raw(**kw):
    base = {"company": "Acme", "title": "ML Engineer Intern", "locations": ["SF"], "url": "https://x/1",
            "posted": NOW, "kind": "internship", "category": "AI/ML/Data", "pay": "", "source": "t"}
    return {**base, **kw}


def test_build_dedupes_and_merges():
    jobs = build_jobs([
        _raw(),
        _raw(title="ML  engineer intern", posted=NOW - 5 * DAY, pay="$60/hr", source="u"),  # same role, other tracker
        _raw(title="Accounting Intern"),  # not AI
        _raw(company="Beta", title="LLM Research Scientist", kind="new-grad", locations=["London, UK"]),
    ])
    assert len(jobs) == 2
    acme = next(j for j in jobs if j["c"] == "Acme")
    assert acme["d"] == (NOW - 5 * DAY) // DAY and acme["p"] == 60
    beta = next(j for j in jobs if j["c"] == "Beta")
    assert beta["tr"] == "llm" and beta["co"] == ["United Kingdom"] and beta["k"] == "new-grad"
    stats = build_stats(jobs, [{"type": "hackathon"}], NOW)
    assert stats["total"] == 2 and stats["programs"] == {"hackathon": 1}
    assert sum(w["n"] for w in stats["weekly"]) == 2
    feed = build_feed(jobs, NOW, "https://example.com/")
    assert feed.count("<item>") == 2 and "&amp;" not in feed.split("<item>")[0]


def test_curated_data_is_consistent():
    root = os.path.join(HERE, "..", "pipeline", "curated")
    progs = json.load(open(os.path.join(root, "programs.json")))
    graph = json.load(open(os.path.join(root, "skills.json")))
    ids = {s["id"] for s in graph["skills"]}
    assert len(ids) == len(graph["skills"])
    assert len({p["id"] for p in progs}) == len(progs)
    for p in progs:
        assert p["url"].startswith("https://"), p["id"]
        assert set(p["tracks"]) <= set(enrich.TRACK_NAMES), p["id"]
    for s in graph["skills"]:
        assert set(s["prereqs"]) <= ids and s["learn"] and s["project"]
        assert all(u.startswith("https://") for _, u in s["learn"])
    assert set(graph["tracks"]) == set(enrich.TRACK_NAMES)
    for t in graph["tracks"].values():
        assert set(t["skills"]) <= ids
