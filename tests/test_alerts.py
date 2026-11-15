import json

from pipeline.send_alerts import build, main


def test_email_has_text_html_and_one_click_unsubscribe():
    m = {"to": "a@b.co", "subject": "3 new roles", "text": "hi", "html": "<p>hi</p>", "unsubscribe": "https://x/?unsubscribe=t"}
    msg = build(m, "Ada <ada@example.com>")
    assert msg["To"] == "a@b.co" and msg["List-Unsubscribe"] == "<https://x/?unsubscribe=t>"
    assert msg["List-Unsubscribe-Post"] is None  # one-click POST needs a server; the link opens in a browser
    assert msg["Message-ID"]
    assert [p.get_content_type() for p in msg.iter_parts()] == ["text/plain", "text/html"]


def test_without_smtp_it_sends_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    f = tmp_path / "a.json"
    f.write_text(json.dumps([{"to": "a@b.co"}]))
    main(str(f))
    assert "would send 1" in capsys.readouterr().out


def test_welcome_and_auth_emails_share_the_layout():
    from pipeline.emails import AUTH, auth_template, welcome
    w = welcome("new@school.edu", "https://site/")
    assert w["subject"] == "Welcome to Ada" and "https://site/#match" in w["html"] and "new@school.edu" in w["html"]
    assert "[[" not in w["html"] and "Open Ada" in w["text"]
    for key in AUTH:
        h = auth_template(key)
        assert "{{ .ConfirmationURL }}" in h and "[[" not in h


def test_welcome_goes_once_to_recently_confirmed_accounts():
    from datetime import datetime, timezone
    from pipeline.welcome import due
    now = datetime(2026, 11, 15, tzinfo=timezone.utc)
    users = [
        {"id": "1", "email": "a@x.co", "email_confirmed_at": "2026-11-14T10:00:00Z"},
        {"id": "2", "email": "b@x.co", "email_confirmed_at": None},
        {"id": "3", "email": "c@x.co", "email_confirmed_at": "2026-11-14T10:00:00Z", "app_metadata": {"ada_welcomed": 1}},
        {"id": "4", "email": "d@x.co", "email_confirmed_at": "2026-09-01T10:00:00Z"},
    ]
    assert [u["id"] for u in due(users, now)] == ["1"]
