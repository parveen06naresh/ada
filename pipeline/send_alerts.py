"""Weekly email alerts, step 2 of 2: send the digests built by pipeline/alerts.mjs over SMTP.

Settings come from GitHub secrets: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS and
ALERT_FROM (for example "Ada <you@example.com>"). Any SMTP service works (Brevo, Gmail with an app
password, Resend). With no SMTP_HOST it only prints what it would send.
Usage: python -m pipeline.send_alerts out/alerts.json
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
import time
from email.message import EmailMessage


def build(m: dict, sender: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = m["to"]
    msg["Subject"] = m["subject"]
    msg["List-Unsubscribe"] = f"<{m['unsubscribe']}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(m["text"])
    msg.add_alternative(m["html"], subtype="html")
    return msg


def main(path: str) -> None:
    with open(path) as f:
        messages = json.load(f)
    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("ALERT_FROM") or os.environ.get("SMTP_USER", "")
    if not host:
        print(f"SMTP is not set up; would send {len(messages)} emails.")
        return
    sent = failed = 0
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=30) as s:
        s.starttls()
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        for m in messages:
            try:
                s.send_message(build(m, sender))
                sent += 1
            except smtplib.SMTPException as e:  # one bad address should not stop the rest
                failed += 1
                print(f"warn: {e}", file=sys.stderr)
            time.sleep(0.5)
    print(f"sent {sent}, failed {failed}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/alerts.json")
