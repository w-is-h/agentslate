/* a line diff between two texts — the html editor's version view */

type Op = "+" | "-" | " ";

/* plain LCS line diff — payloads are small; past the cap just show
   old-then-new (still colored, no pairing) */
function diffLines(a: string[], b: string[]): [Op, string][] {
  if (a.length * b.length > 250_000)
    return [...a.map(s => ["-", s] as [Op, string]), ...b.map(s => ["+", s] as [Op, string])];
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [Op, string][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", a[i++]]);
    else out.push(["+", b[j++]]);
  }
  while (i < n) out.push(["-", a[i++]]);
  while (j < m) out.push(["+", b[j++]]);
  return out;
}

const OP_CLS: Record<Op, string> = {
  "+": "text-diff-add bg-[color-mix(in_srgb,var(--color-diff-add)_11%,transparent)]",
  "-": "text-diff-del bg-[color-mix(in_srgb,var(--color-diff-del)_11%,transparent)]",
  " ": "text-dim",
};

/* Wrapped, not side-scrolled: prose holds one long line per paragraph, and
   a diff of it would run off the right edge. The hanging indent keeps a
   wrapped line clear of the +/- gutter, so the marker still reads as a
   column. */
export function TextDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = diffLines(oldText.split("\n"), newText.split("\n"));
  return (
    <div className="max-h-96 overflow-y-auto px-3 py-2 font-mono text-[12.5px]/[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] [scrollbar-width:thin]">
      {rows.map(([op, s], i) => (
        <div key={i} className={`pl-4 -indent-4 ${OP_CLS[op]}`}>
          <span className="select-none">{op} </span>{s || " "}
        </div>
      ))}
    </div>
  );
}
