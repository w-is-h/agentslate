import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function legacyCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

/* navigator.clipboard exists only in secure contexts — a plain-http slate
   falls back to the selection trick */
export async function copyText(text: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissions can reject an API that exists; the fallback still works.
    }
  }
  if (!legacyCopy(text)) throw new Error("copy failed");
}

/* Rich editors consume text/html; source editors consume text/plain. A
   Markdown canvas belongs on the clipboard as both. execCommand keeps this
   working on Slate instances served over plain HTTP, where the modern
   Clipboard API is unavailable. */
export async function copyRichText(text: string, html: string) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return;
    } catch {
      // The API may exist while permissions or the current origin forbid it.
    }
  }

  await new Promise<void>((resolve, reject) => {
    let copied = false;
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      event.clipboardData.setData("text/html", html);
      event.preventDefault();
      copied = true;
    };
    document.addEventListener("copy", onCopy, { capture: true, once: true });
    try {
      legacyCopy(text);
    } finally {
      document.removeEventListener("copy", onCopy, true);
    }
    if (copied) resolve();
    else reject(new Error("copy failed"));
  });
}
