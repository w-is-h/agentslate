import type { NestWidget } from "@/api/client";

export default function WidgetByline({ widget }: { widget: NestWidget }) {
  return (
    <span title={`placed ${widget.ts}`} className="font-mono text-[11px] text-faint">
      {widget.author}
    </span>
  );
}
