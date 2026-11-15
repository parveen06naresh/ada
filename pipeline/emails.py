"""Ada's emails, all built from one layout (pipeline/email_layout.html).

- Supabase sign-in emails (confirm sign-up, sign-in link, password reset, email change) are written to
  supabase/templates/ by `python -m pipeline.emails`. Paste each into Supabase > Authentication >
  Emails. They use Supabase's own {{ .ConfirmationURL }} placeholders.
- The welcome email is sent by pipeline/welcome.py; the weekly matches email by pipeline/alerts.mjs.
- send() delivers over any SMTP service (Brevo, Gmail app password, Resend) from GitHub secrets.
"""
from __future__ import annotations

import html
import os
import smtplib
import sys
import time
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = (ROOT / "pipeline" / "email_layout.html").read_text()
SITE = os.environ.get("SITE_URL", "https://parveen06naresh.github.io/ada/")
FOOT_ABOUT = "Ada is a free, open-source careers project built by a student."


def layout(title: str, heading: str, body: str, footer: str, preheader: str = "") -> str:
    out = LAYOUT
    for k, v in {"TITLE": title, "PREHEADER": preheader, "HEADING": heading, "BODY": body, "FOOTER": footer}.items():
        out = out.replace(f"[[{k}]]", v)
    return out


def button(url: str, label: str) -> str:
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>'
            f'<td style="background:#6a4cf0;border-radius:10px;">'
            f'<a href="{url}" style="display:inline-block;padding:12px 22px;font-weight:700;color:#ffffff;text-decoration:none;">{label}</a>'
            f'</td></tr></table>')


def fallback(url: str) -> str:
    return (f'<p style="margin:0;color:#8a87a3;font-size:13px;">If the button doesn\'t work, paste this into your browser:<br>'
            f'<a href="{url}" style="color:#6a4cf0;word-break:break-all;">{url}</a></p>')


# Supabase auth templates. Keys are the template names on Supabase's Emails page.
AUTH = {
    "confirm_signup": {
        "subject": "Confirm your email for Ada",
        "heading": "Confirm your email",
        "pre": "One tap to finish creating your Ada account.",
        "text": "Thanks for signing up for Ada. Confirm this email address to finish creating your account. "
                "Your saved roles, applications and profile will then sync to every device you sign in on.",
        "cta": "Confirm my email",
        "why": "You're getting this because someone signed up for Ada with {{ .Email }}. If that wasn't you, ignore this email and no account will be created.",
    },
    "magic_link": {
        "subject": "Your Ada sign-in link",
        "heading": "Sign in to Ada",
        "pre": "Your one-tap sign-in link. It works once and expires in an hour.",
        "text": "Tap the button to sign in. The link works once and expires in an hour.",
        "cta": "Sign in to Ada",
        "why": "You're getting this because someone asked to sign in to Ada as {{ .Email }}. If that wasn't you, ignore this email.",
    },
    "reset_password": {
        "subject": "Reset your Ada password",
        "heading": "Reset your password",
        "pre": "Choose a new password for your Ada account.",
        "text": "Tap the button to choose a new password. The link works once and expires in an hour.",
        "cta": "Choose a new password",
        "why": "You're getting this because someone asked to reset the password for {{ .Email }} on Ada. If that wasn't you, ignore this email. Your password stays the same.",
    },
    "change_email": {
        "subject": "Confirm your new email for Ada",
        "heading": "Confirm your new email",
        "pre": "Confirm the new email address for your Ada account.",
        "text": "Confirm that you want to change your Ada sign-in email from {{ .Email }} to {{ .NewEmail }}.",
        "cta": "Confirm new email",
        "why": "If you didn't ask for this change, ignore this email and nothing changes.",
    },
}


def auth_template(key: str) -> str:
    t = AUTH[key]
    url = "{{ .ConfirmationURL }}"
    body = f'<p style="margin:0;">{t["text"]}</p>{button(url, t["cta"])}{fallback(url)}'
    return layout(t["subject"], t["heading"], body, f'{t["why"]}<br>{FOOT_ABOUT}', t["pre"])


def welcome(email: str, site: str = SITE) -> dict:
    steps = [
        ("Add your resume", f'On the <a href="{site}#explore" style="color:#6a4cf0;">Explore</a> page. It is read on your device and gives every role a fit score.'),
        ("Save and track", f'Tap &#9734; on any role, then move it from saved to applied, interviewing and offer on your <a href="{site}#saved" style="color:#6a4cf0;">Applications</a> board.'),
        ("Get weekly matches", f'Turn on the Monday email in <a href="{site}#foryou" style="color:#6a4cf0;">For you</a>. It lists only new roles you fit.'),
    ]
    rows = "".join(
        f'<tr><td valign="top" style="padding:8px 12px 8px 0;"><span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;background:#efeaff;color:#6a4cf0;font-weight:700;font-size:13px;">{i}</span></td>'
        f'<td style="padding:8px 0;"><b style="color:#15142a;">{h}</b><br><span style="color:#5d5b78;">{d}</span></td></tr>'
        for i, (h, d) in enumerate(steps, 1))
    body = (f'<p style="margin:0 0 6px;">Your account is ready. Here is how to get the most out of it in a few minutes:</p>'
            f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">{rows}</table>'
            f'{button(site + "#match", "Open Ada")}'
            f'<p style="margin:0;color:#5d5b78;">Found a broken link or a closed role? Tap Report on it and it gets fixed.</p>')
    foot = f"You're getting this once because you created an Ada account with {html.escape(email)}. {FOOT_ABOUT}"
    text = ("Welcome to Ada. Your account is ready.\n\n"
            f"1. Add your resume on the Explore page: {site}#explore\n"
            f"2. Save roles with the star and track them on your Applications board: {site}#saved\n"
            f"3. Turn on the Monday matches email in For you: {site}#foryou\n\n"
            f"Open Ada: {site}#match\n\n{FOOT_ABOUT}\n")
    return {"to": email, "subject": "Welcome to Ada", "text": text,
            "html": layout("Welcome to Ada", "Welcome to Ada", body, foot, "Your account is ready. Three things to do first.")}


def build(m: dict, sender: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = m["to"]
    msg["Subject"] = m["subject"]
    domain = sender.rsplit("@", 1)[-1].strip("> ") or "ada.local"
    msg["Message-ID"] = make_msgid(domain=domain)
    if m.get("unsubscribe"):
        # A link the reader's mail app can open. (One-click POST unsubscribe needs a server, which Ada doesn't have.)
        msg["List-Unsubscribe"] = f"<{m['unsubscribe']}>"
    msg.set_content(m["text"])
    msg.add_alternative(m["html"], subtype="html")
    return msg


def smtp_ready() -> bool:
    return bool(os.environ.get("SMTP_HOST"))


def send(messages: list[dict]) -> list[str]:
    """Send each message; returns the addresses that were delivered to the SMTP server."""
    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("ALERT_FROM") or os.environ.get("SMTP_USER", "")
    if not host:
        print(f"SMTP is not set up; would send {len(messages)} emails.")
        return []
    done: list[str] = []
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT") or "587"), timeout=30) as s:
        s.starttls()
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        for m in messages:
            try:
                s.send_message(build(m, sender))
                done.append(m["to"])
            except smtplib.SMTPException as e:  # one bad address should not stop the rest
                print(f"warn: {m['to']}: {e}", file=sys.stderr)
            time.sleep(0.5)
    print(f"sent {len(done)}, failed {len(messages) - len(done)}")
    return done


def write_auth_templates(out: Path = ROOT / "supabase" / "templates") -> None:
    out.mkdir(parents=True, exist_ok=True)
    for key, t in AUTH.items():
        (out / f"{key}.html").write_text(auth_template(key))
    (out / "subjects.txt").write_text("".join(f"{k}: {t['subject']}\n" for k, t in AUTH.items()))
    print(f"wrote {len(AUTH)} templates to {out}")


if __name__ == "__main__":
    write_auth_templates()
