"""Weekly email alerts, step 2 of 2: send the digests built by pipeline/alerts.mjs over SMTP.

Settings come from GitHub secrets: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS and
ALERT_FROM (for example "Ada <you@example.com>"). Any SMTP service works (Brevo, Gmail with an app
password, Resend). With no SMTP_HOST it only prints what it would send.
Usage: python -m pipeline.send_alerts out/alerts.json
"""
from __future__ import annotations

import json
import sys

from pipeline.emails import build, send

__all__ = ["build", "main"]


def main(path: str) -> None:
    with open(path) as f:
        send(json.load(f))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/alerts.json")
