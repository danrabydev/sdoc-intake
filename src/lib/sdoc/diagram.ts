import type { GraphResponse, IndexNode } from "./api-types.ts";

export interface DiagramNode {
  id: string;
  column: number;
  title: string;
  sub: string;
  kind: "item" | "bundle" | "missing";
  uid: string;
  file: string;
  focus: boolean;
  hot: boolean;
  /** Stack order inside a column. Trace leaves this unset. */
  order?: number;
  /** Nesting under a file or section. */
  depth?: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  role: string;
  hot: boolean;
}

export interface DiagramLink {
  fromUid: string;
  toUid: string;
  fromFile: string;
  toFile: string;
  role: string;
}

export interface Diagram {
  lanes: string[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  links: Map<string, DiagramLink[]>;
}

const BUNDLE_AT = 8;

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function shortFile(file: string): string {
  const parts = file.split("/").filter(Boolean);
  if (parts.length === 0) return "Unresolved";
  return parts.slice(-2).join("/");
}

function laneOf(file: string): { lane: number; name: string } {
  const path = file.replace(/\\/g, "/");
  if (path.startsWith("catalog/") || path.includes("/controls/")) return { lane: 4, name: "Catalog" };
  if (path.includes("capabilities") || /(^|\/)CAP\.sdoc$/i.test(path)) return { lane: 3, name: "Capabilities" };
  if (path.includes("platform")) return { lane: 2, name: "Platform" };
  if (path.includes("releases")) return { lane: 0, name: "Releases" };
  return { lane: 1, name: "Systems" };
}

function roleOf(type: string, role?: string): string {
  const name = role?.trim();
  return name && name.length > 0 ? name : type;
}

/** Cross-file Parent and Child links. One box per document until that document is opened. */
export function flowDiagram(
  nodes: IndexNode[],
  focus: string,
  openFile = "",
  expanded: ReadonlySet<string> = new Set(),
): Diagram {
  const byUid = new Map<string, IndexNode>();
  for (const node of nodes) {
    if (!node.uid || node.tag === "DOCUMENT") continue;
    if (!byUid.has(node.uid)) byUid.set(node.uid, node);
  }
  const focusFile = nodes.find((node) => node.uid === focus)?.file || openFile;
  const docOf = new Map<string, IndexNode>();
  for (const node of nodes) {
    if (node.tag === "DOCUMENT" && node.file && !docOf.has(node.file)) docOf.set(node.file, node);
  }

  const buckets = new Map<string, { from: string; to: string; role: string; links: DiagramLink[] }>();
  const seen = new Set<string>();
  const active = new Set<string>();

  for (const node of byUid.values()) {
    for (const relation of node.relations) {
      if (relation.type === "File" || !relation.value || !node.file) continue;
      const target = byUid.get(relation.value);
      const toFile = target?.file ?? "";
      if (!toFile || toFile === node.file) continue;
      const role = roleOf(relation.type, relation.role);
      const once = `${node.uid}|${role}|${relation.value}`;
      if (seen.has(once)) continue;
      seen.add(once);
      active.add(node.file);
      active.add(toFile);
      const id = `${node.file}|${role}|${toFile}`;
      const bucket = buckets.get(id) ?? { from: node.file, to: toFile, role, links: [] };
      bucket.links.push({ fromUid: node.uid, toUid: relation.value, fromFile: node.file, toFile, role });
      buckets.set(id, bucket);
    }
  }

  if (focusFile) active.add(focusFile);
  const files = [...active].sort((a, b) => a.localeCompare(b));
  const preferred = new Map(files.map((file) => [file, laneOf(file).lane]));
  const distinct = new Set(preferred.values());
  const columnOf = new Map<string, number>();
  const laneName = new Map<number, string>();
  if (distinct.size >= 2) {
    const lanes = [...distinct].sort((a, b) => a - b);
    lanes.forEach((lane, index) => {
      laneName.set(index, laneOf([...preferred.entries()].find(([, value]) => value === lane)?.[0] ?? "").name);
    });
    for (const file of files) {
      const lane = preferred.get(file) ?? 1;
      columnOf.set(file, lanes.indexOf(lane));
    }
  } else {
    const rank = rankFiles(files, [...buckets.values()]);
    const ranks = [...new Set(files.map((file) => rank.get(file) ?? 0))].sort((a, b) => a - b);
    laneName.set(0, "Sources");
    if (ranks.length > 1) laneName.set(ranks.length - 1, "Targets");
    for (const file of files) columnOf.set(file, ranks.indexOf(rank.get(file) ?? 0));
  }

  const hotFiles = new Set<string>();
  if (focusFile) {
    hotFiles.add(focusFile);
    for (const bucket of buckets.values()) {
      if (bucket.from === focusFile) hotFiles.add(bucket.to);
      if (bucket.to === focusFile) hotFiles.add(bucket.from);
    }
  }

  const parentOf = new Map<string, string>();
  const compositeOf = new Set<string>();
  for (const node of byUid.values()) {
    if (node.parent) parentOf.set(node.uid, node.parent);
    if (node.composite || node.tag === "SECTION") compositeOf.add(node.uid);
  }
  const childrenOf = new Map<string, IndexNode[]>();
  for (const file of files) {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (node.file !== file || !node.uid || node.tag === "DOCUMENT" || seen.has(node.uid)) continue;
      seen.add(node.uid);
      const parent = parentOf.get(node.uid) ?? "";
      const key = `${file}\n${parent}`;
      const list = childrenOf.get(key) ?? [];
      list.push(node);
      childrenOf.set(key, list);
    }
  }
  const childList = (file: string, parent: string) => childrenOf.get(`${file}\n${parent}`) ?? [];
  const seenAncestors = new Set<string>();
  const ancestorsOpen = (uid: string): boolean => {
    seenAncestors.clear();
    let parent = parentOf.get(uid) ?? "";
    while (parent && !seenAncestors.has(parent)) {
      seenAncestors.add(parent);
      if (compositeOf.has(parent) && !expanded.has(parent)) return false;
      parent = parentOf.get(parent) ?? "";
    }
    return true;
  };
  const anchor = (uid: string, file: string): string => {
    if (!expanded.has(file)) return file;
    const seen = new Set<string>();
    let current = uid;
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = byUid.get(current);
      if (node && node.file === file && ancestorsOpen(current)) return `n:${current}`;
      current = parentOf.get(current) ?? "";
    }
    return file;
  };

  const links = new Map<string, DiagramLink[]>();
  const grouped = new Map<string, { from: string; to: string; role: string; fromFile: string; toFile: string; links: DiagramLink[] }>();
  for (const bucket of buckets.values()) {
    for (const link of bucket.links) {
      const from = anchor(link.fromUid, bucket.from);
      const to = anchor(link.toUid, bucket.to);
      const id = `${from}|${bucket.role}|${to}`;
      const existing = grouped.get(id);
      if (existing) existing.links.push(link);
      else grouped.set(id, { from, to, role: bucket.role, fromFile: bucket.from, toFile: bucket.to, links: [link] });
    }
  }
  const edges: DiagramEdge[] = [...grouped.values()]
    .sort((a, b) => a.from.localeCompare(b.from) || a.role.localeCompare(b.role) || a.to.localeCompare(b.to))
    .map((bucket) => {
      const id = `${bucket.from}|${bucket.role}|${bucket.to}`;
      links.set(id, bucket.links);
      const hot = Boolean(focusFile) && (bucket.fromFile === focusFile || bucket.toFile === focusFile);
      const collapsed = bucket.from === bucket.fromFile && bucket.to === bucket.toFile;
      return {
        id,
        from: bucket.from,
        to: bucket.to,
        label: bucket.links.length > 1 || collapsed ? `${bucket.role} ${bucket.links.length}` : bucket.role,
        role: bucket.role,
        hot,
      };
    });

  const nodesOut: DiagramNode[] = [];
  let order = 0;
  const emitChildren = (file: string, parent: string, depth: number, column: number) => {
    for (const member of childList(file, parent)) {
      const group = compositeOf.has(member.uid);
      const kids = childList(file, member.uid);
      nodesOut.push({
        id: `n:${member.uid}`,
        column,
        order: order++,
        depth,
        title: clip(group ? member.title || member.uid : member.uid, 26),
        sub: group ? `${kids.length} nodes` : clip(member.title && member.title !== member.uid ? member.title : member.tag, 34),
        kind: group ? "bundle" : "item",
        uid: member.uid,
        file,
        focus: member.uid === focus,
        hot: !focusFile || hotFiles.has(file),
      });
      if (group && expanded.has(member.uid)) emitChildren(file, member.uid, depth + 1, column);
    }
  };
  for (const file of files) {
    const column = columnOf.get(file) ?? 0;
    const doc = docOf.get(file);
    const count = nodes.reduce(
      (sum, node) => (node.file === file && node.uid && node.tag !== "DOCUMENT" ? sum + 1 : sum),
      0,
    );
    nodesOut.push({
      id: file,
      column,
      order: order++,
      depth: 0,
      title: clip(doc?.title || shortFile(file), 26),
      sub: `${count} nodes`,
      kind: "bundle",
      uid: "",
      file,
      focus: file === focusFile && !expanded.has(file),
      hot: !focusFile || hotFiles.has(file),
    });
    if (expanded.has(file) && count > 0) emitChildren(file, "", 1, column);
  }

  const laneCount = Math.max(0, ...nodesOut.map((node) => node.column)) + (nodesOut.length > 0 ? 1 : 0);
  const lanes: string[] = [];
  for (let index = 0; index < laneCount; index += 1) {
    lanes.push(laneName.get(index) || "");
  }
  return { lanes, nodes: nodesOut, edges, links };
}

function rankFiles(files: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const file of files) incoming.set(file, 0);
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const rank = new Map<string, number>();
  for (const file of files) rank.set(file, (incoming.get(file) ?? 0) > 0 ? 1 : 0);
  for (let pass = 0; pass < 4; pass += 1) {
    for (const edge of edges) {
      const next = (rank.get(edge.from) ?? 0) + 1;
      if (next > (rank.get(edge.to) ?? 0)) rank.set(edge.to, next);
    }
  }
  return rank;
}

/** Local trace. A crowded column collapses to one box per file until it is opened. */
export function traceDiagram(graph: GraphResponse, focus: string, expanded: ReadonlySet<string>): Diagram {
  const place = placeTrace(graph, focus);
  const columnOf = compact(place);
  const byFile = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.uid === focus) continue;
    const key = `${columnOf.get(node.uid) ?? 0}|${node.file}`;
    const list = byFile.get(key) ?? [];
    list.push(node.uid);
    byFile.set(key, list);
  }

  const idOf = new Map<string, string>();
  const nodes: DiagramNode[] = [];
  for (const node of graph.nodes) {
    const column = columnOf.get(node.uid) ?? 0;
    const mates = byFile.get(`${column}|${node.file}`) ?? [];
    const bundleId = `b:${column}:${node.file}`;
    const bundled = node.uid !== focus && mates.length >= BUNDLE_AT && !expanded.has(bundleId);
    if (bundled) {
      if (!nodes.some((item) => item.id === bundleId)) {
        nodes.push({
          id: bundleId,
          column,
          title: clip(shortFile(node.file || "Unresolved"), 28),
          sub: `${mates.length} links`,
          kind: node.file ? "bundle" : "missing",
          uid: "",
          file: node.file,
          focus: false,
          hot: true,
        });
      }
      idOf.set(node.uid, bundleId);
      continue;
    }
    const id = `n:${node.uid}`;
    idOf.set(node.uid, id);
    nodes.push({
      id,
      column,
      title: clip(node.uid, 28),
      sub: clip(node.title && node.title !== node.uid ? node.title : node.tag === "MISSING" ? "Unresolved" : shortFile(node.file), 32),
      kind: node.tag === "MISSING" || !node.file ? "missing" : "item",
      uid: node.uid,
      file: node.file,
      focus: node.uid === focus,
      hot: true,
    });
  }

  const grouped = new Map<string, { from: string; to: string; role: string; count: number; links: DiagramLink[] }>();
  for (const edge of graph.edges) {
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (!from || !to || from === to) continue;
    const role = roleOf(edge.type, edge.role);
    const id = `${from}|${role}|${to}`;
    const bucket = grouped.get(id) ?? { from, to, role, count: 0, links: [] };
    bucket.count += 1;
    bucket.links.push({
      fromUid: edge.from,
      toUid: edge.to,
      fromFile: graph.nodes.find((node) => node.uid === edge.from)?.file ?? "",
      toFile: graph.nodes.find((node) => node.uid === edge.to)?.file ?? "",
      role,
    });
    grouped.set(id, bucket);
  }

  const links = new Map<string, DiagramLink[]>();
  const edges: DiagramEdge[] = [...grouped.values()].map((bucket) => {
    const id = `${bucket.from}|${bucket.role}|${bucket.to}`;
    links.set(id, bucket.links);
    return {
      id,
      from: bucket.from,
      to: bucket.to,
      label: bucket.count > 1 ? `${bucket.role} ${bucket.count}` : bucket.role,
      role: bucket.role,
      hot: true,
    };
  });

  const laneCount = Math.max(0, ...nodes.map((node) => node.column)) + (nodes.length > 0 ? 1 : 0);
  const focusColumn = columnOf.get(focus) ?? 0;
  const lanes: string[] = [];
  for (let index = 0; index < laneCount; index += 1) {
    const delta = index - focusColumn;
    lanes.push(delta === 0 ? "Selected" : delta === -1 ? "Links in" : delta === 1 ? "Links out" : delta < 0 ? "Further in" : "Further out");
  }
  return { lanes, nodes, edges, links };
}

function placeTrace(graph: GraphResponse, focus: string): Map<string, number> {
  const next = new Map<string, { uid: string; out: boolean }[]>();
  const add = (from: string, uid: string, out: boolean) => {
    const list = next.get(from) ?? [];
    if (!list.some((item) => item.uid === uid)) list.push({ uid, out });
    next.set(from, list);
  };
  for (const edge of graph.edges) {
    add(edge.from, edge.to, true);
    add(edge.to, edge.from, false);
  }
  const place = new Map<string, number>();
  if (!focus) return place;
  place.set(focus, 0);
  const queue = [focus];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const at = place.get(current) ?? 0;
    for (const step of next.get(current) ?? []) {
      if (place.has(step.uid)) continue;
      const side = at === 0 ? (step.out ? 1 : -1) : Math.sign(at);
      place.set(step.uid, at + side);
      queue.push(step.uid);
    }
  }
  for (const node of graph.nodes) {
    if (!place.has(node.uid)) place.set(node.uid, node.uid === focus ? 0 : 1);
  }
  return place;
}

function compact(place: Map<string, number>): Map<string, number> {
  const ranks = [...new Set(place.values())].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [uid, rank] of place) out.set(uid, ranks.indexOf(rank));
  return out;
}
