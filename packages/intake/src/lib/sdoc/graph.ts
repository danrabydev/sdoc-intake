import type { GraphResponse, IndexNode } from "./api-types.ts";

/** Parent/Child hops around `from`. File links are not trace edges. */
export function buildGraph(nodes: IndexNode[], from: string, depth: number): GraphResponse {
  const depthN = Math.min(8, Math.max(0, Math.floor(depth) || 0));
  const by = new Map<string, IndexNode>();
  for (const node of nodes) {
    if (!node.uid || node.tag === "DOCUMENT") continue;
    if (!by.has(node.uid)) by.set(node.uid, node);
  }

  const edges: GraphResponse["edges"] = [];
  const near = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    const list = near.get(a) ?? new Set<string>();
    list.add(b);
    near.set(a, list);
  };

  for (const node of by.values()) {
    for (const relation of node.relations) {
      if (!relation.value || relation.type === "File") continue;
      edges.push({
        from: node.uid,
        to: relation.value,
        type: relation.type,
        role: relation.role,
      });
      touch(node.uid, relation.value);
      touch(relation.value, node.uid);
    }
  }

  const seen = new Set<string>();
  const queue: { uid: string; distance: number }[] = [];
  if (from) {
    seen.add(from);
    queue.push({ uid: from, distance: 0 });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.distance >= depthN) continue;
    for (const next of near.get(current.uid) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ uid: next, distance: current.distance + 1 });
    }
  }

  const outNodes: IndexNode[] = [];
  for (const uid of seen) {
    outNodes.push(
      by.get(uid) ?? {
        uid,
        title: "Unresolved",
        file: "",
        tag: "MISSING",
        statement: "",
        relations: [],
      },
    );
  }
  return {
    nodes: outNodes,
    edges: edges.filter((edge) => seen.has(edge.from) && seen.has(edge.to)),
  };
}
