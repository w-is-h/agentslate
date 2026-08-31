/* the slate API — one payload for db content, plus the canvas and nest calls */

export interface LogDay { day: string; body: string }
export interface MemPage { path: string; content: string; updated: string; accessed: string }

export interface DashData {
  today: string;
  notes: LogDay[];
  tasks: LogDay[];
  brain: string;
  brain_limit: number;
  note_summary: string;
  note_summary_through: string;
  note_summary_limit: number;
  memory_page_limit: number;
  locked: boolean;
  repo_hosts: Record<string, string>;
  memory: MemPage[];
  nest: number;
}

export interface Version { v: string; page: number }

export type Author = "agent" | "user";

export interface CanvasDoc {
  id: number; ts: string; label: string; content: string; source: string;
  author: Author; starred: boolean; versions: number;
}
export interface CanvasVersion { id: number; ts: string; author: Author; content?: string }
export interface CanvasMeta { id: number; ts: string; label: string; source: string; starred: boolean }

export interface NestItem { url: string; name: string; size: number }
export interface NestWidget {
  id: number; kind: "canvas" | "image" | "html" | "file"; col: number; row: number; w: number; h: number;
  title: string; descr: string; hidden: boolean; author: Author; ts: string;
  canvas?: CanvasDoc | null; items?: NestItem[];
  html?: HtmlMeta | null;
}
export interface HtmlMeta {
  id: number; ts: string; title: string; chars?: number;
  author: Author; versions: number;
}
export interface HtmlDoc extends HtmlMeta { content: string }
export interface HtmlVersion {
  id: number; html_id?: number; ts: string; title: string; chars?: number;
  author: Author; content?: string;
}

const json = async <T,>(r: Response): Promise<T> => {
  const body = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) {
    const detail = body?.error ?? body?.detail;
    throw new Error(typeof detail === "string" ? detail : `${r.url}: ${r.status}`);
  }
  return body as T;
};

export interface MutationResult {
  ok?: boolean; id?: number; html?: HtmlDoc; pages?: number;
}

export const getVersion = () => fetch("/api/version").then(r => json<Version>(r));
export const getAll = () => fetch("/api/all").then(r => json<DashData>(r));
export const getCanvas = (id?: number) =>
  fetch("/api/canvas" + (id ? `?id=${id}` : "")).then(r => json<{ canvas: CanvasDoc | null }>(r));
export const getNest = (board = "main") =>
  fetch(`/api/nest?board=${encodeURIComponent(board)}`).then(r => json<{
    cols: number; rows: number; widgets: NestWidget[]; board: string; boards: string[];
  }>(r));
export const uploadNestFiles = (col: number, row: number, files: File[], board: string) => {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return fetch(`/api/nest/upload?col=${col}&row=${row}&board=${encodeURIComponent(board)}`,
               { method: "POST", body }).then(r => json<MutationResult>(r));
};
export const getCanvases = () =>
  fetch("/api/canvases").then(r => json<{ canvases: CanvasMeta[] }>(r));
export const getHtmls = () =>
  fetch("/api/nest/htmls").then(r => json<{ htmls: HtmlMeta[] }>(r));
export const getHtml = (id: number) =>
  fetch(`/api/nest/html?id=${id}`).then(r => json<{ html: HtmlDoc }>(r));
export const getHtmlVersions = (id: number) =>
  fetch(`/api/nest/html/versions?id=${id}`).then(r => json<{ versions: HtmlVersion[] }>(r));
export const getHtmlVersion = (id: number) =>
  fetch(`/api/nest/html/version?id=${id}`).then(r => json<{ version: HtmlVersion }>(r));
export const getCanvasVersions = (id: number) =>
  fetch(`/api/canvas/versions?id=${id}`).then(r => json<{ versions: CanvasVersion[] }>(r));
export const getCanvasVersion = (id: number) =>
  fetch(`/api/canvas/version?id=${id}`).then(r => json<{ version: CanvasVersion }>(r));

export async function getFile(path: string): Promise<{ name: string; content: string } | null> {
  const r = await fetch("/api/file?path=" + encodeURIComponent(path));
  return r.ok ? r.json() : null;
}

export const post = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => json<MutationResult>(r));
