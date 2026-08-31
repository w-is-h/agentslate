/* dates and colors — shared across views */

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const dow = (d: string) => DOW[new Date(d + "T12:00:00").getDay()];

/* a stable hue per memory group, hashed from its name */
const GROUP_C = ["var(--color-notes)", "var(--color-tasks)", "var(--color-plum)", "var(--color-due)"];
export const grpColor = (g: string) =>
  GROUP_C[[...g].reduce((a, c) => a + c.charCodeAt(0), 0) % GROUP_C.length];

export const formatSize = (bytes?: number) =>
  bytes == null ? "" : bytes < 1024 ? `${bytes} B`
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
