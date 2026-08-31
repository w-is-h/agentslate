import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { GlobalLightbox, Nothing } from "@/components/bits";
import Shell from "@/components/Shell";
import Logs from "@/pages/Logs";
import Brain from "@/pages/Brain";
import { PhoneHtml, PhoneMemory, PhoneNest, PhoneShell } from "@/pages/Phone";

const Memory = lazy(() => import("@/pages/Memory"));
const CanvasPage = lazy(() => import("@/pages/Canvas"));
const Nest = lazy(() => import("@/pages/Nest"));

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Nothing>loading…</Nothing>}>{children}</Suspense>;
}

/* the phone is a different application over the same backend, not a
   squeezed desktop — the boundary is the same 860px the layouts always used */
function usePhone() {
  const [phone, setPhone] = useState(() => matchMedia("(max-width: 860px)").matches);
  useEffect(() => {
    const mq = matchMedia("(max-width: 860px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/* one route table: notes, tasks, brain and the canvas are shared; the
   nest and memory have a phone rendering of their own; unknown routes
   land on the nest */
export default function App() {
  const phone = usePhone();
  return (
    <>
    <GlobalLightbox />
    <Routes>
      <Route element={phone ? <PhoneShell /> : <Shell />}>
        <Route path="/" element={<Navigate to="/nest" replace />} />
        <Route path="/nest" element={phone ? <PhoneNest /> : <Deferred><Nest /></Deferred>} />
        <Route path="/notes" element={<Logs kind="notes" />} />
        <Route path="/tasks" element={<Logs kind="tasks" />} />
        <Route path="/brain" element={<Brain />} />
        <Route path="/memory/*" element={phone ? <PhoneMemory /> : <Deferred><Memory /></Deferred>} />
        <Route path="/canvas" element={<Deferred><CanvasPage /></Deferred>} />
        {phone && <Route path="/html" element={<PhoneHtml />} />}
        <Route path="*" element={<Navigate to="/nest" replace />} />
      </Route>
    </Routes>
    </>
  );
}
