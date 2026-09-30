import type { IndexNode } from "./api-types.ts";

const SHOWN = new Set(["SECTION", "REQUIREMENT"]);

export interface FlowHit {
  uid: string;
  file: string;
}

function safe(value: string, max = 48): string {
  return value.replace(/[<>"[\]#&]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_");
  return cleaned.length > 0 ? cleaned : "x";
}

function fileTitle(file: string, nodes: IndexNode[]): string {
  const doc = nodes.find((node) => node.file === file && node.tag === "DOCUMENT");
  const base = file.split("/").pop()?.replace(/\.sdoc$/i, "") ?? file;
  const title = doc?.title ? safe(doc.title, 42) : "";
  if (title && title !== base) return `${title} · ${base}`;
  return title || base || file;
}

/** One flowchart of every document. Sections and requirements sit in a file group. */
export function flowSource(nodes: IndexNode[], focus: string): { source: string; hits: Map<string, FlowHit> } {
  const hits = new Map<string, FlowHit>();
  const shown = nodes.filter((node) => node.uid && SHOWN.has(node.tag));
  const files = [...new Set(nodes.map((node) => node.file).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (files.length === 0) return { source: "", hits };

  const idOf = new Map<string, string>();
  const lines = ["flowchart LR"];
  for (const file of files) {
    const group = slug(file);
    lines.push(`  subgraph ${group}["${safe(fileTitle(file, nodes))}"]`);
    lines.push("    direction TB");
    const members = shown
      .filter((node) => node.file === file)
      .sort((a, b) => {
        if (a.tag !== b.tag) return a.tag === "SECTION" ? -1 : 1;
        return a.uid.localeCompare(b.uid);
      });
    if (members.length === 0) {
      const emptyId = `empty_${group}`;
      lines.push(`    ${emptyId}["No sections or requirements"]`);
      lines.push(`    class ${emptyId} quiet`);
    }
    for (const node of members) {
      const id = `n_${slug(file)}_${slug(node.uid)}`;
      idOf.set(`${file}\n${node.uid}`, id);
      hits.set(id, { uid: node.uid, file });
      const title = safe(node.title || node.uid);
      const label = title && title !== node.uid ? `${safe(node.uid, 32)}<br/>${title}` : safe(node.uid, 32);
      lines.push(`    ${id}["${label}"]`);
      lines.push(`    class ${id} ${node.tag === "SECTION" ? "section" : "requirement"}`);
    }
    lines.push("  end");
  }

  const seen = new Set<string>();
  for (const node of shown) {
    const from = idOf.get(`${node.file}\n${node.uid}`);
    if (!from) continue;
    for (const relation of node.relations) {
      if (relation.type !== "Parent" || !relation.value) continue;
      const target = shown.find((item) => item.uid === relation.value);
      const to = target ? idOf.get(`${target.file}\n${target.uid}`) : undefined;
      if (!to) continue;
      const key = `${from}|${relation.role ?? ""}|${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const role = safe(relation.role || "Parent", 24);
      lines.push(`  ${from} -->|${role}| ${to}`);
    }
  }

  if (focus) {
    for (const [id, hit] of hits) {
      if (hit.uid === focus) lines.push(`  class ${id} focus`);
    }
  }
  lines.push("  classDef section fill:#212932,stroke:#e2a227,color:#e7eef3");
  lines.push("  classDef requirement fill:#181e24,stroke:#3c4650,color:#e7eef3");
  lines.push("  classDef focus stroke:#e2a227,stroke-width:3px");
  lines.push("  classDef quiet fill:#181e24,stroke:#2c3842,color:#8d9aa3");
  return { source: lines.join("\n"), hits };
}
