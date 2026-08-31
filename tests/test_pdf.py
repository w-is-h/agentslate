from agentslate import pdf


def test_markdown_renders_to_pdf():
    out = pdf.render(
        "#7 · agent · 2026-08-29", "# Title\n\n3. three\n4. four\n\n- [x] done\n- [ ] open\n", True
    )
    assert out.startswith(b"%PDF")


def test_plain_text_renders_to_pdf():
    assert pdf.render("notes.txt", "<not html> & plain", False).startswith(b"%PDF")


def test_fname():
    assert pdf.fname("Review: the plan / v2") == "Review-the-plan-v2"
    assert pdf.fname("acme/site") == "acme-site"
    assert pdf.fname("") == "slate"
