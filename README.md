<h1 align="center">▲ Frontier</h1>

<p align="center"><b>AI careers, mapped.</b><br>
Every open AI, ML, data and quant internship and new-grad role in one place, refreshed daily.<br>
Plus hackathons, fellowships and grants, and a free roadmap built from what employers actually ask for.</p>

<p align="center">
<b>5,295</b> open roles · <b>1,693</b> companies · <b>581</b> posted this week · <b>43</b> programs · <b>$0</b> to run
</p>

![Explore view](docs/explore.png)

## Why

AI opportunities are scattered across a dozen GitHub trackers, job boards, university pages and Discord servers. Students check five sites every morning and still miss the role that fit them best. Frontier pulls them into one fast, searchable place, tells you which ones fit **you** and why, and gives you a week-by-week plan to close the gap.

## What it does

| | |
|---|---|
| **Explore** | Search and filter every role by role type, skill, level, country, remote and posting date. Share any search as a link. |
| **For you** | Fill in a 30-second profile. Frontier ranks roles for you and shows the reason for every match ("Your goal: LLM Engineer · You know 2 of 3 core skills · Posted this week"). |
| **Roadmap** | Pick one of 10 career tracks. Get a week-by-week plan in prerequisite order, with free courses from Stanford, MIT, fast.ai and Karpathy, a portfolio project for every step, and how much the market asks for each skill. Track progress, keep a streak, earn badges, share your roadmap as a link. |
| **Programs** | 43 hand-picked hackathons, competitions, fellowships, research programs, grants, startup accelerators and free-compute programs. |
| **Trends** | New roles per week, open roles by track, the skills employers ask for, the best-paying roles that publish pay, who is hiring most, and where. |
| **Weekly digest** | An RSS feed of new roles, plus a one-click "copy my weekly digest" of your best new matches. |
| **Saved** | Star roles and export them to CSV for your application tracker. |

![Roadmap view](docs/roadmap.png)

## Private by design

There are no accounts and no server. Your profile, saved roles and progress stay in your browser. The whole site is static files on GitHub Pages, and a GitHub Action rebuilds the data every morning. Running it costs nothing.

## Run it locally

```bash
git clone https://github.com/parveen06naresh/frontier && cd frontier
bash pipeline/fetch.sh .sources              # clone the public trackers (about a minute)
python -m pipeline.build --src .sources      # writes site/data/*.json and feed.xml
python -m http.server -d site 8000           # open http://localhost:8000
```

No dependencies beyond Python 3.10+ for the pipeline and any modern browser for the site.

Tests: `python -m pytest -q tests` and `node --test tests/*.test.mjs`.

## How it works

```
public trackers ──► pipeline/sources.py ──► pipeline/enrich.py ──► pipeline/build.py ──► site/data/*.json ──► site/ (static app)
 (GitHub repos)      read and normalize      keep AI roles, tag       dedupe, stats,         opportunities,       search, matching,
                                             track, skills, level,    RSS feed               programs, skills,    roadmap, trends
                                             country, pay                                    stats
```

* **Sources.** Roles come from the public trackers by [SimplifyJobs](https://github.com/SimplifyJobs/Summer2027-Internships) ([new grad](https://github.com/SimplifyJobs/New-Grad-Positions)), [speedyapply](https://github.com/speedyapply/2027-AI-College-Jobs) and [vanshb03](https://github.com/vanshb03/Summer2027-Internships). Frontier links straight to each employer's posting. Thank you to their maintainers.
* **Tagging.** Every rule is a readable regex in `pipeline/enrich.py`, so anyone can fix a misfiled role. Skills are read from job titles and role type, because the trackers do not publish full descriptions.
* **Matching.** A transparent points system in `site/js/match.js`. Every point comes with the reason shown on the card. No black box.
* **Roadmap.** A skill graph in `pipeline/curated/skills.json`: 19 skills, their prerequisites, free resources and a project each. The planner orders them, skips what you know, and spaces them by your hours per week.

![Trends view](docs/trends.png)

## Contribute

The easiest high-impact contributions:

1. **Add a program**: one JSON object in `pipeline/curated/programs.json` (hackathon, fellowship, grant, research program, accelerator or compute).
2. **Add a data source**: one reader function in `pipeline/sources.py`.
3. **Improve a roadmap step**: better free resources or projects in `pipeline/curated/skills.json`.
4. **Fix a misfiled role**: adjust a regex in `pipeline/enrich.py` and add a test.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Honest limits

* Coverage is only as good as the public trackers. They focus on North America and on internships and new-grad roles.
* Pay is published for only a few hundred roles, mostly at large US companies.
* Program dates and amounts change. Always check the official page.

## License

MIT. Built by [Parveen Kumar Naresh Kumar](https://www.linkedin.com/in/parveenkumarnareshkumar/) (Applied Math + CS, USF), with AI-assisted development (Claude Code).
