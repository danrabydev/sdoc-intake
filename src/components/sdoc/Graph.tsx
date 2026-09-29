import { useEffect, useRef } from "react";
import type { GraphResponse } from "@/lib/sdoc/api-types";

function nodeId(uid: string): string {
  return `n_${uid.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function safe(value: string, max = 40): string {
  return value.replace(/[<>"[\]#&]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceOf(graph: GraphResponse, focus: string): string {
  const lines = ["flowchart LR"];
  const ids = new Map<string, string>();
  for (const node of graph.nodes) {
    const id = nodeId(node.uid);
    ids.set(node.uid, id);
    const title = safe(node.title);
    const label = title && title !== node.uid ? `${node.uid}<br/>${title}` : node.uid;
    lines.push(`  ${id}["${label}"]`);
  }
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) continue;
    const key = `${from}|${edge.role ?? edge.type}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${from} -->|${safe(edge.role || edge.type, 24)}| ${to}`);
  }
  const focusId = ids.get(focus);
  if (focusId) {
    lines.push("  classDef focus stroke:#e2a227,stroke-width:2px;");
    lines.push(`  class ${focusId} focus`);
  }
  return lines.join("\n");
}

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
  const host = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const signature = focus ? sourceOf(graph, focus) : "";

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!signature) {
      el.replaceChildren();
      return;
    }
    let cancel = false;
    const renderId = `sdoc${Math.random().toString(36).slice(2)}`;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "IBM Plex Sans",
        themeVariables: {
          darkMode: true,
          background: "#181e24",
          primaryColor: "#212932",
          primaryTextColor: "#e7eef3",
          primaryBorderColor: "#3c4650",
          lineColor: "#8d9aa3",
          fontSize: "14px",
        },
      });
      try {
        const rendered = await mermaid.render(renderId, signature);
        if (cancel || !host.current) return;
        host.current.innerHTML = rendered.svg;
        host.current.querySelectorAll<HTMLElement>(".node").forEach((node) => {
          node.addEventListener("click", () => {
            const gid = node.id;
            for (const item of graph.nodes) {
              if (gid.includes(nodeId(item.uid))) {
                pick.current(item.uid);
                break;
              }
            }
          });
        });
      } catch (err) {
        if (!cancel && host.current) {
          host.current.textContent = err instanceof Error ? err.message : "Could not draw the trace.";
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [signature, graph.nodes]);

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
      <div className="sdoc-graph min-h-0 flex-1 overflow-auto p-3">
        {focus ? (
          <div ref={host} className="min-h-40" />
        ) : (
          <p className="text-sm text-muted">Select a row to trace Parent links. Edge labels are roles.</p>
        )}
      </div>
    </div>
  );
}
