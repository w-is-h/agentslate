import { createContext, useContext } from "react";
import type { DashData } from "@/api/client";

export interface Dash {
  data: DashData | null;
  api: (path: string, body: unknown) => Promise<void>;
}

export const DashContext = createContext<Dash>(null!);
export const useDash = () => useContext(DashContext);
