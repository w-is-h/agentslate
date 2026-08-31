"""Exports: a canvas or a memory page rendered to PDF through WeasyPrint —
no browser involved, so the routes serve agents too. Markdown renders via
markdown-it-py here and mdlite in the UI; standard prose overlaps
entirely."""

import html
import re

from fastapi.responses import Response
from markdown_it import MarkdownIt

# the UI's warm light theme, print-sized; the webfonts aren't installed
# system-wide, so the serif fallbacks carry
CSS = """
@page {
  size: A4;
  margin: 22mm 20mm;
  @bottom-right { content: counter(page); font: 9pt monospace; color: #4d4232; }
}
body { font: 11pt/1.55 Georgia, serif; color: #241d12; }
h1, h2, h3, h4 { font-weight: 500; line-height: 1.15; break-after: avoid; }
h1 { font-size: 23pt; margin: 0 0 4mm; }
h2 { font-size: 15pt; margin: 8mm 0 3mm; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; }
.meta { font: 8.5pt monospace; color: #4d4232; margin: 0 0 10mm; }
a { color: #8a5a12; }
code, pre { font-family: monospace; font-size: 9pt; }
pre { padding: 3mm; background: #f4eddf; white-space: pre-wrap; overflow-wrap: anywhere; }
code { background: #f4eddf; padding: 0 1pt; }
pre code { padding: 0; }
blockquote { margin: 3mm 0 3mm 0; padding-left: 4mm; border-left: 1.2pt solid #a8762a; color: #4d4232; }
table { border-collapse: collapse; margin: 4mm 0; }
th, td { border: 0.6pt solid #d5c9ae; padding: 1.5mm 2.5mm; font-size: 9.5pt; text-align: left; }
th { font-weight: 600; }
hr { border: 0; border-top: 0.6pt solid #d5c9ae; margin: 6mm 0; }
img { max-width: 100%; }
li.task { list-style: none; margin-left: -4.5mm; }
"""

# CommonMark, so list markers and start numbers survive exactly as written
_md = MarkdownIt("commonmark").enable("table")

# "- [ ]" list items print as box glyphs standing in for the bullet — the
# UI's interactive checkboxes, frozen on paper
TASK_RE = re.compile(r"<li>(<p>)?\[([ xX])\] ")

# WeasyPrint ignores ol's start attribute; the list-item counter it does
# honor carries the number instead
START_RE = re.compile(r'<ol start="(\d+)">')


def _tasks(body):
    body = TASK_RE.sub(
        lambda m: '<li class="task">' + (m.group(1) or "") + ("☑ " if m.group(2).strip() else "☐ "),
        body,
    )
    return START_RE.sub(
        lambda m: (
            f'<ol start="{m.group(1)}" style="counter-reset: list-item {int(m.group(1)) - 1}">'
        ),
        body,
    )


def fname(title):
    """Filename stem for a download."""
    return re.sub(r"[^\w.-]+", "-", title).strip("-")[:80] or "slate"


def markdownish(doc):
    """The UI's rule (lib/canvas.ts isMarkdownCanvas): markdown unless the
    name carries a non-markdown extension."""
    name = doc["source"] or doc["label"]
    return bool(re.search(r"\.(md|markdown)$", name, re.I)) or not re.search(
        r"\.[a-z0-9]+$", name, re.I
    )


def render(meta, content, markdown):
    """PDF bytes: a meta line, then the content. No injected heading — the
    content's own first line is the name."""
    body = _tasks(_md.render(content)) if markdown else f"<pre>{html.escape(content)}</pre>"
    page = f"<style>{CSS}</style><div class=meta>{html.escape(meta)}</div>{body}"
    from weasyprint import HTML  # heavy import — only an export pays it

    return HTML(string=page).write_pdf()


def response(stem, meta, content, markdown):
    return Response(
        render(meta, content, markdown),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )
