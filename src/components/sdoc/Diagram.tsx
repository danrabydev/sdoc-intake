import { useMemo, useState } from "react";
import type { DiagramEdge, DiagramNode } from "@/lib/sdoc/diagram";

const NODE_W = 210;
const NODE_H = 56;
const GAP_X = 88;
const GAP_Y = 14;
const PAD = 28;

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
  const placed = useMemo(() => layout(nodes), [nodes]);
  const at = useMemo(() => new Map(placed.map((node) => [node.id, node])), [placed]);
  const width = Math.max(lanes.length, 1) * (NODE_W + GAP_X) + PAD;
  const height = Math.max(...placed.map((node) => node.y), 0) + NODE_H + PAD * 2;

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
        const x1 = from.x + NODE_W;
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
              width={NODE_W}
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

function layout(nodes: DiagramNode[]): (DiagramNode & { x: number; y: number })[] {
  const columns = new Map<number, DiagramNode[]>();
  for (const node of nodes) {
    const list = columns.get(node.column) ?? [];
    list.push(node);
    columns.set(node.column, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => Number(b.focus) - Number(a.focus) || a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
  }
  const out: (DiagramNode & { x: number; y: number })[] = [];
  for (const [column, list] of columns) {
    list.forEach((node, index) => {
      out.push({
        ...node,
        x: PAD + column * (NODE_W + GAP_X),
        y: PAD + index * (NODE_H + GAP_Y),
      });
    });
  }
  return out;
}
