from pipeline.ats import kind_of, parse
from pipeline.build import _url_key, build_jobs


def test_kind_of_keeps_only_early_career_roles():
    assert kind_of("Machine Learning Engineer Intern, Summer 2027") == "internship"
    assert kind_of("Research Scientist, New Grad") == "new-grad"
    assert kind_of("AI Residency Program") == "new-grad"
    assert kind_of("Senior Machine Learning Engineer") is None
    assert kind_of("Staff Research Scientist, University Relations") is None
    assert kind_of("Machine Learning Engineer") is None


def test_parse_each_board_format():
    gh = {"jobs": [{"title": "ML Research Intern", "location": {"name": "San Francisco, CA"},
                    "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/1", "first_published": "2026-10-20T10:00:00-04:00"},
                   {"title": "Senior ML Engineer", "location": {"name": "SF"}, "absolute_url": "https://x/2", "updated_at": "2026-10-20T10:00:00Z"}]}
    lv = [{"text": "Machine Learning Intern", "categories": {"location": "London", "allLocations": ["London", "Paris"]},
           "hostedUrl": "https://jobs.lever.co/acme/3", "createdAt": 1792000000000}]
    ab = {"jobs": [{"title": "AI Engineer, New Grad", "location": "New York", "secondaryLocations": [{"location": "Boston"}],
                    "isRemote": True, "jobUrl": "https://jobs.ashbyhq.com/acme/4", "publishedAt": "2026-10-21T00:00:00.000+00:00",
                    "compensation": {"compensationTierSummary": "$150K - $180K"}},
                   {"title": "Hidden Intern", "isListed": False, "jobUrl": "https://x/5"}]}
    g, l, a = parse("greenhouse", gh, "Acme", "acme.com"), parse("lever", lv, "Acme", ""), parse("ashby", ab, "Acme", "")
    assert [j["title"] for j in g] == ["ML Research Intern"] and g[0]["posted"] > 0 and g[0]["domain"] == "acme.com"
    assert l[0]["locations"] == ["London", "Paris"] and l[0]["posted"] == 1792000000 and l[0]["kind"] == "internship"
    assert len(a) == 1 and a[0]["locations"] == ["New York", "Boston", "Remote"] and a[0]["pay"] == "$150K - $180K"
    assert a[0]["kind"] == "new-grad" and a[0]["source"] == "employer"


def test_same_posting_from_two_sources_is_kept_once():
    base = {"company": "Acme", "title": "Machine Learning Intern", "kind": "internship", "category": "", "pay": "", "posted": 1792000000}
    jobs = build_jobs([{**base, "locations": ["San Francisco, CA"], "url": "https://jobs.lever.co/acme/3?ref=simplify", "source": "SimplifyJobs"},
                       {**base, "locations": ["San Francisco, California"], "url": "https://jobs.lever.co/acme/3", "source": "employer"}])
    assert len(jobs) == 1
    assert _url_key("https://x.com/job?id=5&utm_source=a") != _url_key("https://x.com/job?id=6")


def test_workday_parse():
    from pipeline import workday
    now = 1_800_000_000
    data = {"host": "acme.wd5.myworkdayjobs.com", "postings": [
        {"title": "2027 Summer Analyst Intern - Investment Banking", "externalPath": "/job/NY/IB_R1", "locationsText": "New York, NY", "postedOn": "Posted 3 Days Ago"},
        {"title": "Senior Director, Finance", "externalPath": "/job/NY/R2", "locationsText": "New York, NY", "postedOn": "Posted Today"},
        {"title": "Finance Rotational Program - New Grad", "externalPath": "/job/x/R3", "locationsText": "2 Locations", "postedOn": "Posted Yesterday"},
    ]}
    site = {"company": "Acme Bank", "tenant": "acme", "site": "Careers", "category": "Finance", "domain": "acme.com"}
    jobs = workday.parse(data, site, now)
    assert [j["kind"] for j in jobs] == ["internship", "new-grad"]
    assert jobs[0]["url"] == "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/NY/IB_R1"
    assert jobs[0]["posted"] == now - 3 * 86400 and jobs[1]["posted"] == now - 86400
    assert jobs[1]["locations"] == [] and jobs[0]["category"] == "Finance"


def test_zapply_parse(tmp_path):
    from pipeline import sources
    md = tmp_path / "README.md"
    md.write_text("""<summary><h3>💼 <strong>Business &amp; Operations</strong></h3></summary>

| Company | Role | Location | Posted | Visa | **Apply** |
|---------|------|----------|--------|------|----------|
| **Uline** | Digital Marketing Internship - Summer 2027 | Pleasant Prairie, WI | 1d | ✅ Sponsor | [<img src="images/apply.png" width="80" alt="Apply">](https://zapply.jobs/l/d/x1?s=gh) |
| **Uline** | Senior Marketing Manager | Pleasant Prairie, WI | 2h |  | [<img src="images/apply.png" width="80" alt="Apply">](https://zapply.jobs/l/d/x2?s=gh) |
""")
    jobs = sources._zapply(str(md), "internship", 1_800_000_000)
    assert len(jobs) == 1
    j = jobs[0]
    assert j["company"] == "Uline" and j["visa"] and j["category"] == "Business & Operations"
    assert j["posted"] == 1_800_000_000 - 86400 and j["url"].startswith("https://zapply.jobs/")
