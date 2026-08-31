/* markdown-lite renderer for brain/memory prose and rendered canvases.
   Returns an HTML string (all input escaped here); render via <Prose>. */

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export const hl = (s: string, q: string) =>
  q ? s.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                m => `<span class="hl">${m}</span>`) : s;

const inline = (s: string) => esc(s)
  // image-store links render as thumbnails — before the path rule eats
  // them; read-only, so the whole picture opens the full image
  .replace(/\[([^\]]*)\]\((\/api\/images\/[a-f0-9]+)\)/g,
           `<a href="$2" target="_blank" rel="noopener"><img class="md-thumb" src="$2" alt="$1" title="$1"></a>`)
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, `<a href="$2" target="_blank">$1</a>`)
  .replace(/\[([^\]]+)\]\(((?:~\/|\/)[^)]+)\)/g, `<span class="wikilink" data-path="$2">$1</span>`)
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<span class="wikilink" data-link="$2">$1</span>`)
  .replace(/\[\[([^\]]+)\]\]/g, `<span class="wikilink">$1</span>`)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  // bare URLs; the leading-char guard keeps this out of href="..." and <a>...</a> text
  .replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;)])/g, `$1<a href="$2" target="_blank">$2</a>`);

export function mdlite(src: string): string {
  let meta = "";
  src = src.replace(/^---\n([\s\S]*?)\n---\n?/, (_, m) => { meta = m; return ""; });
  const out: string[] = [];
  let list: string[] | null = null, listTag = "ul", para: string[] = [];
  let sub: string[] | null = null, subTag = "ul";
  let table: string[][] | null = null;
  // source lines are hard-wrapped; consecutive plain lines join into one
  // paragraph, indented list markers nest one level, other indented lines
  // continue the open (sub-)item
  const closeSub = () => {
    if (sub && list) list.push(list.pop()!.replace(/<\/li>$/, `<${subTag}>${sub.join("")}</${subTag}></li>`));
    sub = null;
  };
  const flush = () => {
    closeSub();
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
    if (list) { out.push(`<${listTag}>${list.join("")}</${listTag}>`); list = null; }
    if (table) {
      let rows = table, head = "";
      if (rows.length > 1 && rows[1].every(c => /^[\s:-]*$/.test(c))) {
        head = `<thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
        rows = rows.slice(2);
      }
      const body = rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<table>${head}<tbody>${body}</tbody></table>`);
      table = null;
    }
  };
  // "[ ] task" / "[x] task" after the list marker → a checkbox; these
  // surfaces are read-only, so it's inert via CSS pointer-events, which
  // keeps the gold accent that `disabled` would gray out (livemd is the
  // editable one)
  const li = (text: string) => {
    const m = text.match(/^\[([ xX])\] /);
    return m
      ? `<li class="task"><input type="checkbox" tabindex="-1"${/x/i.test(m[1]) ? " checked" : ""}> ${inline(text.slice(4))}</li>`
      : `<li>${inline(text)}</li>`;
  };
  const item = (l: string, tag: string, re: RegExp) => {
    closeSub();
    if (para.length || (list && listTag !== tag)) flush();
    listTag = tag;
    (list ??= []).push(li(l.replace(re, "")));
  };
  const subItem = (text: string, tag: string) => {
    if (sub && subTag !== tag) closeSub();
    subTag = tag;
    (sub ??= []).push(li(text));
  };
  let code: string[] | null = null; // open ``` fence: lines pass through verbatim
  for (const raw of src.split("\n")) {
    const l = raw.trimEnd();
    if (/^\s*```/.test(l)) {
      if (code === null) { flush(); code = []; }
      else { out.push(`<pre class="fence"><code>${esc(code.join("\n"))}</code></pre>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }
    if (/^#\s/.test(l)) { // a short # line is a real title; a sentence-length one is the doc's self-description
      flush();
      const t = l.replace(/^#\s/, "");
      out.push(t.length <= 60 ? `<h2>${inline(t)}</h2>` : `<p class="doc-intro">${inline(t)}</p>`);
    }
    else if (/^##\s/.test(l)) { flush(); out.push(`<h2>${inline(l.replace(/^##\s/, ""))}</h2>`); }
    else if (/^###\s/.test(l)) { flush(); out.push(`<h3>${inline(l.replace(/^###\s/, ""))}</h3>`); }
    else if (/^[-*]\s/.test(l)) item(l, "ul", /^[-*]\s/);
    else if (/^\d+\.\s/.test(l)) item(l, "ol", /^\d+\.\s/);
    else if (/^\|.*\|$/.test(l)) {
      if (para.length || list) flush();
      (table ??= []).push(l.slice(1, -1).split("|").map(c => c.trim()));
    }
    else if (!l.trim()) flush();
    else if (/^\s+[-*]\s/.test(l) && list) subItem(l.trim().replace(/^[-*]\s/, ""), "ul");
    else if (/^\s+\d+\.\s/.test(l) && list) subItem(l.trim().replace(/^\d+\.\s/, ""), "ol");
    else if (/^\s/.test(raw) && list) { // continuation of the last (sub-)item
      const li = (sub ?? list) as string[]; // ts can't see through the closure mutations
      li.push(li.pop()!.replace(/<\/li>$/, ` ${inline(l.trim())}</li>`));
    }
    else { if (list) flush(); para.push(l.trim()); }
  }
  if (code !== null) out.push(`<pre class="fence"><code>${esc(code.join("\n"))}</code></pre>`);
  flush();
  return (meta ? `<div class="meta">${esc(meta)}</div>` : "") + out.join("\n");
}
