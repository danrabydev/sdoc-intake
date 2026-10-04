import { useMemo, useState } from "react";
import type { GraphResponse } from "@/lib/sdoc/api-types";
import { traceDiagram } from "@/lib/sdoc/diagram";
import { Diagram } from "@/components/sdoc/Diagram";

export function Graph({
  graph,
  focus,
  depth,
  onDepth,
  onPick,
}: {
  graph: GraphResponse;
  focus: string;
  depth: number;
  onDepth: (depth: number) => void;
  onPick: (uid: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const model = useMemo(() => traceDiagram(graph, focus, expanded), [graph, focus, expanded]);
  const bundled = model.nodes.some((node) => node.kind === "bundle");

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <p className="font-mono text-xs tracking-widest text-accent">TRACE</p>
          <p className="font-mono text-xs text-muted">{focus || "No UID"}</p>
        </div>
        <div className="flex gap-1">
          {[1, 2].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onDepth(value)}
              className={
                "min-h-11 min-w-11 rounded-md border border-line font-mono text-xs " +
                (depth === value ? "bg-accent text-accent-fg" : "text-muted")
              }
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="sdoc-graph min-h-0 flex-1 overflow-auto p-2">
        {focus && model.nodes.length > 0 ? (
          <Diagram
            lanes={model.lanes}
            nodes={model.nodes}
            edges={model.edges}
            onNode={(node) => {
              if (node.kind === "bundle") {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
                return;
              }
              if (node.uid) onPick(node.uid);
            }}
            onEdge={() => undefined}
          />
        ) : (
          <p className="text-sm text-muted">Select a row to trace Parent and Child links.</p>
        )}
      </div>
      {bundled ? (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">A dashed box is one file. Open it to see those requirements.</p>
      ) : null}
    </div>
  );
}
