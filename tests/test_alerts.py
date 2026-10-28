import json

from pipeline.send_alerts import build, main


def test_email_has_text_html_and_one_click_unsubscribe():
    m = {"to": "a@b.co", "subject": "3 new roles", "text": "hi", "html": "<p>hi</p>", "unsubscribe": "https://x/?unsubscribe=t"}
    msg = build(m, "Ada <ada@example.com>")
    assert msg["To"] == "a@b.co" and msg["List-Unsubscribe"] == "<https://x/?unsubscribe=t>"
    assert msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert [p.get_content_type() for p in msg.iter_parts()] == ["text/plain", "text/html"]


def test_without_smtp_it_sends_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    f = tmp_path / "a.json"
    f.write_text(json.dumps([{"to": "a@b.co"}]))
    main(str(f))
    assert "would send 1" in capsys.readouterr().out
