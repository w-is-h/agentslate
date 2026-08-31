import type { MemPage } from "@/api/client";

export type MemoryNode = { path: string; name: string; page?: MemPage; kids: MemoryNode[] };

export function buildMemoryTree(memory: MemPage[]): MemoryNode[] {
  const root: MemoryNode = { path: "", name: "", kids: [] };
  for (const page of memory) {
    let node = root;
    for (const segment of page.path.split("/")) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let child = node.kids.find(candidate => candidate.path === path);
      if (!child) {
        child = { path, name: segment, kids: [] };
        node.kids.push(child);
      }
      node = child;
    }
    node.page = page;
  }
  const sort = (node: MemoryNode) => {
    node.kids.sort((a, b) => a.name.localeCompare(b.name));
    node.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

export function findMemoryNode(tree: MemoryNode[], path: string): MemoryNode | undefined {
  let children = tree;
  let hit: MemoryNode | undefined;
  for (const segment of path.split("/")) {
    hit = children.find(child => child.name === segment);
    if (!hit) return undefined;
    children = hit.kids;
  }
  return hit;
}

/* the pages beneath a node, at any depth — the node's own page not counted */
export const countPages = (node: MemoryNode): number =>
  node.kids.reduce((count, child) => count + (child.page ? 1 : 0) + countPages(child), 0);

export const memoryTitle = (content: string) =>
  (content.split("\n").find(line => line.trim()) || "")
    .replace(/[*_`]|\[|\]\([^)]*\)/g, "")
    .replace(/^#+\s*/, "")
    .trim();

export const parentPath = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export function resolveMemoryPath(memory: MemPage[], current: string, url: string): string | null {
  if (/^(https?:|mailto:|#|\/)/.test(url)) return null;
  const target = url.replace(/\.md$/, "");
  const parent = parentPath(current);
  for (const candidate of [`${current}/${target}`, parent ? `${parent}/${target}` : target, target])
    if (memory.some(page => page.path === candidate)) return `/memory/${candidate}`;
  return null;
}
