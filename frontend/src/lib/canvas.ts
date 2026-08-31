import type { CanvasDoc } from "@/api/client";

/* Markdown unless the name says otherwise. Agent-written text has no extension and reads as Markdown. */
export const isMarkdownCanvas = (doc: CanvasDoc) => {
  const name = doc.source || doc.label;
  return /\.(md|markdown)$/i.test(name) || !/\.[a-z0-9]+$/i.test(name);
};

/* A phone card already carries the canvas label in its header. Its body
   starts after the first non-empty line so the same title is not repeated. */
export const canvasBody = (content: string) => {
  const lines = content.split("\n");
  const label = lines.findIndex(line => line.trim());
  return label < 0 ? "" : lines.slice(label + 1).join("\n").replace(/^\n+/, "");
};
