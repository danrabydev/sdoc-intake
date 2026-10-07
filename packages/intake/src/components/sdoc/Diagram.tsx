import { useMemo, useState } from "react";
import { DIAGRAM_NODE_H, layoutDiagram, type DiagramBox, type DiagramEdge, type DiagramNode } from "@/lib/sdoc/diagram";

function edgeColor(role: string): string {
  if (role === "Refines") return "#e2a227";
  if (role === "ConformsTo") return "#3cba8b";
  if (role === "Delivers") return "#7eb6ff";
  if (role === "Satisfies") return "#c4b5fd";
  return "#8d9aa3";
}

function shell(node: DiagramBox): boolean {
  return node.h > DIAGRAM_NODE_H;
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
  const model = useMemo(() => layoutDiagram(nodes), [nodes]);
  const placed = model.nodes;
  const at = useMemo(() => new Map(placed.map((node) => [node.id, node])), [placed]);
  const width = Math.max(160, ...placed.map((node) => node.x + node.w), 0) + 28;
  const height = Math.max(160, ...placed.map((node) => node.y + node.h), 0) + 28;

  return (
    <svg className="sdoc-diagram" width={width} height={height} role="img" aria-label="Requirement links">
      {lanes.map((lane, index) =>
        lane ? (
          <text
            key={lane + index}
            x={model.laneX.get(index) ?? 28}
            y={18}
            fill="#8d9aa3"
            fontSize={11}
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
          >
            {lane}
          </text>
        ) : null,
      )}
      {placed.filter(shell).map((node) => (
        <rect
          key={`shell-${node.id}`}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={8}
          fill={(node.depth ?? 0) === 0 ? "#12181e" : "#181e24"}
          stroke={node.focus ? "#e2a227" : "#3c4650"}
          strokeWidth={node.focus ? 2 : 1}
          strokeDasharray={node.kind === "bundle" ? "4 3" : undefined}
          onClick={() => onNode(node)}
          style={{ cursor: "pointer" }}
        />
      ))}
      {edges.map((edge) => {
        const from = at.get(edge.from);
        const to = at.get(edge.to);
        if (!from || !to) return null;
        const live = edge.hot || hover === edge.from || hover === edge.to || hover === edge.id;
        const x1 = from.x + from.w;
        const y1 = from.y + Math.min(from.h, DIAGRAM_NODE_H) / 2;
        const x2 = to.x;
        const y2 = to.y + Math.min(to.h, DIAGRAM_NODE_H) / 2;
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
        const nest = shell(node);
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
              width={node.w}
              height={nest ? DIAGRAM_NODE_H : node.h}
              rx={nest ? 0 : 6}
              fill={nest ? "transparent" : "#212932"}
              stroke={nest ? "none" : node.focus ? "#e2a227" : node.kind === "missing" ? "#e15b4c" : "#3c4650"}
              strokeWidth={node.focus ? 2 : 1}
              strokeDasharray={!nest && node.kind === "bundle" ? "4 3" : undefined}
              opacity={nest || live ? 1 : 0.45}
            />
            <text x={node.x + 10} y={node.y + 22} fill="#e7eef3" fontSize={13} fontFamily="IBM Plex Sans, ui-sans-serif, sans-serif">
              {node.title}
            </text>
            <text x={node.x + 10} y={node.y + 40} fill="#8d9aa3" fontSize={11} fontFamily="IBM Plex Mono, ui-monospace, monospace">
              {node.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}