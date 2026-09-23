import { useDash } from "@/api/dash";

/* the one lock: every user-editable surface (memory pages, canvases, the
   brain, html documents) goes read-only at once, toggled from any of them.
   Server-remembered so every device agrees; the toggle refetches, so every
   surface on this page flips together. The nest board is not a surface —
   placing, moving, hiding and board settings work locked. The agent's
   tools are unaffected. */
export function useLock() {
  const { data, api } = useDash();
  const locked = !!data?.locked;
  return { locked, toggle: () => api("/api/lock", { on: !locked }) };
}
