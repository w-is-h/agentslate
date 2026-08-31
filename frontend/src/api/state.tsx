/* Central data: the /api/all payload behind a version-token poll. The poll
   effect is one of the few real effects in the app — external sync, per
   "you might not need an effect". */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getAll, getVersion, post, type DashData } from "@/api/client";
import { DashContext } from "@/api/dash";

export function DashProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashData | null>(null);
  const ver = useRef<{ v: string; page: number } | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        if (!ver.current) {
          // Set the version only after both requests succeed. A failed cold
          // start then stays eligible for the next poll instead of freezing
          // the app on an empty payload.
          const v = await getVersion();
          const next = await getAll();
          ver.current = v;
          setData(next);
          return;
        }
        const v = await getVersion();
        if (v.page !== ver.current.page) {
          // the page itself changed (new build): reload, unless a draft is open
          const a = document.activeElement as HTMLInputElement | null;
          if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.value !== "") return;
          if (a?.closest(".cm-lm")) return; // typing in a livemd editor
          location.reload();
          return;
        }
        if (v.v !== ver.current.v) {
          setData(await getAll());
          ver.current = v;
        }
      } catch { /* server briefly away; retry next tick */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  const api = async (path: string, body: unknown) => {
    await post(path, body);
    setData(await getAll());
  };

  return <DashContext.Provider value={{ data, api }}>{children}</DashContext.Provider>;
}
