import { useMemo, useState } from "react";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { flowDiagram } from "@/lib/sdoc/diagram";
import { Diagram } from "@/components/sdoc/Diagram";

const ROLE_COLOR: Record<string, string> = {
  Refines: "#e2a227",
  ConformsTo: "#3cba8b",
  Delivers: "#7eb6ff",
  Satisfies: "#c4b5fd",
};

export function FlowMap({
  nodes,
  focus,
  file = "",
  onPick,
}: {
  nodes: IndexNode[];
  focus: string;
  file?: string;
  onPick: (uid: string, file: string) => void;
}) {
  const model = useMemo(() => flowDiagram(nodes, focus, file), [nodes, focus, file]);
  const [edgeId, setEdgeId] = useState("");
  const links = model.links.get(edgeId) ?? [];
  const roles = [...new Set(model.edges.map((edge) => edge.role))];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <p className="font-mono text-xs tracking-widest text-accent">FLOW</p>
        <p className="text-xs text-muted">
          {model.nodes.length === 0
            ? "No cross-file links yet."
            : "One box per document. Lines from the open document are labeled. Select a line to list the requirements."}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          {roles.map((role) => (
            <span key={role} className="font-mono text-xs" style={{ color: ROLE_COLOR[role] ?? "#8d9aa3" }}>
              {role}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {model.nodes.length > 0 ? (
          <Diagram
            lanes={model.lanes}
            nodes={model.nodes}
            edges={model.edges}
            onNode={(node) => {
              if (node.uid && node.file) onPick(node.uid, node.file);
            }}
            onEdge={(edge) => setEdgeId((current) => (current === edge.id ? "" : edge.id))}
          />
        ) : (
          <p className="px-2 py-4 text-sm text-muted">Nothing to draw yet.</p>
        )}
      </div>
      {links.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto border-t border-line">
          {links.map((link) => (
            <li key={`${link.fromUid}|${link.role}|${link.toUid}`}>
              <button
                type="button"
                onClick={() => onPick(link.fromUid, link.fromFile)}
                className="flex min-h-11 w-full items-baseline gap-2 px-3 text-left"
              >
                <span className="font-mono text-xs text-accent">{link.fromUid}</span>
                <span className="font-mono text-xs text-muted">{link.role}</span>
                <span className="font-mono text-xs">{link.toUid}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
