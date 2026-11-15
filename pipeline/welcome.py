"""Welcome email: once, to each person who confirms a new Ada account.

Runs from .github/workflows/account-emails.yml every hour. It reads accounts with the Supabase
service key (GitHub secret, never in the site), emails anyone confirmed in the last 14 days who
hasn't been welcomed, and then marks them in their account's app_metadata (ada_welcomed) so no
one gets it twice. With no SMTP settings it only prints who would get one.
Usage: python -m pipeline.welcome
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from pipeline.emails import send, smtp_ready, welcome

WINDOW = timedelta(days=14)  # older accounts predate the welcome email; don't surprise them


def api(method: str, path: str, body: dict | None = None) -> dict:
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(f"{url}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def due(users: list[dict], now: datetime) -> list[dict]:
    out = []
    for u in users:
        confirmed = parse(u.get("email_confirmed_at"))
        if not u.get("email") or not confirmed or now - confirmed > WINDOW:
            continue
        if (u.get("app_metadata") or {}).get("ada_welcomed"):
            continue
        out.append(u)
    return out


def main() -> None:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
        print("Welcome emails are off: SUPABASE_URL and SUPABASE_SERVICE_KEY are not set.")
        return
    users: list[dict] = []
    for page in range(1, 100):
        batch = api("GET", f"/auth/v1/admin/users?page={page}&per_page=1000").get("users", [])
        users += batch
        if len(batch) < 1000:
            break
    todo = due(users, datetime.now(timezone.utc))
    print(f"{len(users)} accounts, {len(todo)} to welcome")
    if not todo or not smtp_ready():
        send([welcome(u["email"]) for u in todo])  # prints "would send" when SMTP isn't set
        return
    sent = set(send([welcome(u["email"]) for u in todo]))
    for u in todo:
        if u["email"] in sent:
            meta = {**(u.get("app_metadata") or {}), "ada_welcomed": int(time.time())}
            api("PUT", f"/auth/v1/admin/users/{u['id']}", {"app_metadata": meta})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - surface any failure in the Actions log
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
