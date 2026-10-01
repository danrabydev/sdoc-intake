import { useMemo, useState } from "react";
import type { DiagramEdge, DiagramNode } from "@/lib/sdoc/diagram";

const NODE_W = 210;
const NODE_H = 56;
const GAP_X = 88;
const GAP_Y = 14;
const PAD = 28;
const INSET = 16;

function boxWidth(depth: number | undefined): number {
  return Math.max(120, NODE_W - (depth ?? 0) * INSET);
}

function edgeColor(role: string): string {
  if (role === "Refines") return "#e2a227";
  if (role === "ConformsTo") return "#3cba8b";
  if (role === "Delivers") return "#7eb6ff";
  if (role === "Satisfies") return "#c4b5fd";
  return "#8d9aa3";
}

export function Diagram({
  lanes,
  nodes,
  edges,
  onNode,
  onEdge,
}: {
  lanes: string[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  onNode: (node: DiagramNode) => void;
  onEdge: (edge: DiagramEdge) => void;
}) {
  const [hover, setHover] = useState("");
  const placed = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const at = useMemo(() => new Map(placed.map((node) => [node.id, node])), [placed]);
  const width = Math.max(PAD * 2, ...placed.map((node) => node.x + boxWidth(node.depth) + PAD), lanes.length * (NODE_W + GAP_X));
  const height = Math.max(160, ...placed.map((node) => node.y), 0) + NODE_H + PAD;

  return (
    <svg
      className="sdoc-diagram"
      width={width}
      height={Math.max(height, 160)}
      role="img"
      aria-label="Requirement links"
    >
      {lanes.map((lane, index) =>
        lane ? (
          <text
            key={lane + index}
            x={PAD + index * (NODE_W + GAP_X)}
            y={18}
            fill="#8d9aa3"
            fontSize={11}
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
          >
            {lane}
          </text>
        ) : null,
      )}
      {edges.map((edge) => {
        const from = at.get(edge.from);
        const to = at.get(edge.to);
        if (!from || !to) return null;
        const live = edge.hot || hover === edge.from || hover === edge.to || hover === edge.id;
        const x1 = from.x + boxWidth(from.depth);
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x;
        const y2 = to.y + NODE_H / 2;
        const mid = (x1 + x2) / 2;
        const same = from.column === to.column;
        const d = same
          ? `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x1 + 36} ${y2}, ${x1} ${y2}`
          : `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
        const labelX = same ? x1 + 28 : mid;
        const labelY = (y1 + y2) / 2;
        return (
          <g key={edge.id} onMouseEnter={() => setHover(edge.id)} onMouseLeave={() => setHover("")}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} onClick={() => onEdge(edge)} />
            <path
              d={d}
              fill="none"
              stroke={edgeColor(edge.role)}
              strokeWidth={live ? 1.75 : 1}
              strokeOpacity={live ? 0.95 : 0.28}
              pointerEvents="none"
            />
            {live && edge.label ? (
              <text
                x={labelX}
                y={labelY - 6}
                textAnchor="middle"
                fill={edgeColor(edge.role)}
                fontSize={11}
                fontFamily="IBM Plex Mono, ui-monospace, monospace"
                pointerEvents="none"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {placed.map((node) => {
        const live = node.hot || node.focus || hover === node.id;
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            onClick={() => onNode(node)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onNode(node);
              }
            }}
            onMouseEnter={() => setHover(node.id)}
            onMouseLeave={() => setHover("")}
            style={{ cursor: "pointer" }}
          >
            <title>{node.file ? `${node.title} — ${node.file}` : node.title}</title>
            <rect
              x={node.x}
              y={node.y}
              width={boxWidth(node.depth)}
              height={NODE_H}
              rx={6}
              fill={node.kind === "bundle" ? "#181e24" : "#212932"}
              stroke={node.focus ? "#e2a227" : node.kind === "missing" ? "#e15b4c" : "#3c4650"}
              strokeWidth={node.focus ? 2 : 1}
              strokeDasharray={node.kind === "bundle" ? "4 3" : undefined}
              opacity={live ? 1 : 0.45}
            />
            <text
              x={node.x + 10}
              y={node.y + 22}
              fill="#e7eef3"
              fontSize={13}
              fontFamily="IBM Plex Sans, ui-sans-serif, sans-serif"
            >
              {node.title}
            </text>
            <text
              x={node.x + 10}
              y={node.y + 40}
              fill="#8d9aa3"
              fontSize={11}
              fontFamily="IBM Plex Mono, ui-monospace, monospace"
            >
              {node.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const PITCH = NODE_H + GAP_Y;
const GROUP_GAP = 22;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function gapBefore(node: DiagramNode, prev: DiagramNode | undefined): number {
  if (!prev) return 0;
  if ((node.depth ?? 0) === 0 && (node.file !== prev.file || (prev.depth ?? 0) > 0)) return GROUP_GAP;
  return 0;
}

/** Place boxes again from the visible groups. Order inside a group stays put; gaps open so links line up. */
function layout(nodes: DiagramNode[], edges: DiagramEdge[]): (DiagramNode & { x: number; y: number })[] {
  const columns = new Map<number, DiagramNode[]>();
  for (const node of nodes) {
    const list = columns.get(node.column) ?? [];
    list.push(node);
    columns.set(node.column, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => {
      if (a.order != null || b.order != null) return (a.order ?? 0) - (b.order ?? 0);
      return Number(b.focus) - Number(a.focus) || a.file.localeCompare(b.file) || a.title.localeCompare(b.title);
    });
  }

  const yOf = new Map<string, number>();
  for (const list of columns.values()) {
    let y = PAD;
    let prev: DiagramNode | undefined;
    for (const node of list) {
      y += gapBefore(node, prev);
      yOf.set(node.id, y);
      y += PITCH;
      prev = node;
    }
  }

  const columnOf = new Map(nodes.map((node) => [node.id, node.column]));
  const neighborYs = (id: string): number[] => {
    const column = columnOf.get(id);
    const ys: number[] = [];
    for (const edge of edges) {
      const other = edge.from === id ? edge.to : edge.to === id ? edge.from : "";
      if (!other || columnOf.get(other) === column) continue;
      const y = yOf.get(other);
      if (y != null) ys.push(y);
    }
    return ys;
  };

  const sweep = (topDown: boolean) => {
    for (const list of columns.values()) {
      const ideals = list.map((node) => {
        const ys = neighborYs(node.id);
        return ys.length > 0 ? median(ys) : null;
      });
      if (topDown) {
        let cursor = PAD;
        let prev: DiagramNode | undefined;
        list.forEach((node, index) => {
          cursor += gapBefore(node, prev);
          const ideal = ideals[index];
          const y = ideal == null ? cursor : Math.max(cursor, ideal);
          yOf.set(node.id, y);
          cursor = y + PITCH;
          prev = node;
        });
        continue;
      }
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const node = list[index];
        const prev = list[index - 1];
        const next = list[index + 1];
        if (!node) continue;
        const minY = prev ? (yOf.get(prev.id) ?? PAD) + PITCH + gapBefore(node, prev) : PAD;
        const maxY = next ? (yOf.get(next.id) ?? minY) - PITCH - gapBefore(next, node) : Number.POSITIVE_INFINITY;
        const ideal = ideals[index] ?? yOf.get(node.id) ?? minY;
        yOf.set(node.id, Math.min(maxY, Math.max(minY, ideal)));
      }
    }
  };

  for (let pass = 0; pass < 9; pass += 1) {
    sweep(pass % 2 === 0);
    let min = Number.POSITIVE_INFINITY;
    for (const y of yOf.values()) min = Math.min(min, y);
    if (Number.isFinite(min) && min !== PAD) {
      const delta = PAD - min;
      for (const [id, y] of yOf) yOf.set(id, y + delta);
    }
  }

  const out: (DiagramNode & { x: number; y: number })[] = [];
  for (const [column, list] of columns) {
    for (const node of list) {
      out.push({
        ...node,
        x: PAD + column * (NODE_W + GAP_X) + (node.depth ?? 0) * INSET,
        y: yOf.get(node.id) ?? PAD,
      });
    }
  }
  return out;
}
