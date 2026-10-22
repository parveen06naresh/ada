# Contributing to Ada

Thanks for helping people find their way into AI. Small, focused pull requests are best.

## Add a program (5 minutes)

Add one object to `pipeline/curated/programs.json`:

```json
{"id": "short-unique-id", "type": "hackathon", "title": "Name", "org": "Who runs it",
 "url": "https://official-page", "where": "City or Remote", "who": "Who can apply",
 "timing": "When it usually runs", "amount": "Prize, stipend or credits, or empty",
 "tracks": ["llm"], "summary": "One sentence on why it matters."}
```

* `type` is one of: hackathon, competition, fellowship, research, grant, startup, compute.
* `tracks` uses the ids in `pipeline/enrich.py` (mle, llm, research, vision, nlp, robotics, infra, mlops, quant, ds).
* Link only to the official page, and don't invent dates or amounts.

## Add a data source

Write a reader in `pipeline/sources.py` that returns the raw dict shape documented at the top of the file, call it from `load_all`, and add the repo to `pipeline/fetch.sh`. Add a small fixture and test in `tests/`.

## Fix a misfiled role

The rules live in `pipeline/enrich.py`. Change the regex, then add the title that was wrong as a test case in `tests/test_pipeline.py`.

## Before you open a PR

```bash
python -m pytest -q tests
node --test tests/*.test.mjs
python -m pipeline.build --src .sources && python -m http.server -d site 8000
```
