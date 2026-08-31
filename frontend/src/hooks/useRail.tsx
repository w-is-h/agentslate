import { useState } from "react";

const RAIL_KEY = "slate.rail-width";

export function useRail() {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(RAIL_KEY));
    return saved >= 180 && saved <= 440 ? saved : 240;
  });

  const down = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    document.body.style.userSelect = "none";
    const move = (next: PointerEvent) =>
      setWidth(Math.min(440, Math.max(180, startWidth + next.clientX - startX)));
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setWidth(current => {
        localStorage.setItem(RAIL_KEY, String(current));
        return current;
      });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  return {
    width,
    handle: (
      <div onPointerDown={down} title="drag to resize"
           className="group flex w-[13px] flex-none cursor-col-resize justify-center">
        <div className="h-full w-px bg-line-soft transition-colors group-hover:bg-gold-dim" />
      </div>
    ),
  };
}
