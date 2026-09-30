import { useEffect, useRef } from "react";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { flowSource, type FlowHit } from "@/lib/sdoc/flow";

export function FlowMap({
  nodes,
  focus,
  onPick,
}: {
  nodes: IndexNode[];
  focus: string;
  onPick: (uid: string, file: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const chart = flowSource(nodes, focus);

  const hits = useRef(chart.hits);
  hits.current = chart.hits;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!chart.source) {
      el.replaceChildren();
      return;
    }
    let cancel = false;
    const renderId = `flow${Math.random().toString(36).slice(2)}`;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "IBM Plex Sans",
        themeVariables: {
          darkMode: true,
          background: "#101418",
          primaryColor: "#212932",
          primaryTextColor: "#e7eef3",
          primaryBorderColor: "#3c4650",
          lineColor: "#8d9aa3",
          clusterBkg: "#181e24",
          clusterBorder: "#3c4650",
          titleColor: "#e7eef3",
          fontSize: "14px",
        },
      });
      try {
        const rendered = await mermaid.render(renderId, chart.source);
        if (cancel || !host.current) return;
        host.current.innerHTML = rendered.svg;
        const svg = host.current.querySelector("svg");
        if (svg) {
          svg.style.maxWidth = "none";
          svg.style.height = "auto";
        }
        host.current.querySelectorAll<HTMLElement>(".node").forEach((node) => {
          node.style.cursor = "pointer";
          node.addEventListener("click", () => {
            const hit = hitFor(node.id, hits.current);
            if (hit) pick.current(hit.uid, hit.file);
          });
        });
      } catch (err) {
        if (!cancel && host.current) {
          host.current.textContent = err instanceof Error ? err.message : "Could not draw the flow.";
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [chart.source]);

  const documents = new Set(nodes.map((node) => node.file).filter(Boolean)).size;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="border-b border-line px-3 py-2">
        <p className="font-mono text-xs tracking-widest text-accent">FLOW</p>
        <p className="text-xs text-muted">
          {documents === 0
            ? "No documents."
            : `${documents} documents. Sections and requirements. Arrows are Parent links.`}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {chart.source ? <div ref={host} /> : <p className="text-sm text-muted">Nothing to draw yet.</p>}
      </div>
    </div>
  );
}

function hitFor(domId: string, hits: Map<string, FlowHit>): FlowHit | undefined {
  for (const [id, hit] of hits) {
    if (domId.includes(id)) return hit;
  }
  return undefined;
}
