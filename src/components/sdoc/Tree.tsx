import { ChevronRight, FilePlus, FileText, Folder, FolderPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TreeFile } from "@/lib/sdoc/api-types";

type DirNode = { kind: "dir"; path: string; name: string; children: ExplorerNode[] };
type FileNode = { kind: "file"; file: TreeFile };
type ExplorerNode = DirNode | FileNode;

function folderTitle(path: string, root: string): string {
  if (path) return path.slice(path.lastIndexOf("/") + 1);
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) || root || "documents";
}

function buildExplorer(files: TreeFile[], dirs: string[], rootLabel: string): DirNode {
  const root: DirNode = { kind: "dir", path: "", name: folderTitle("", rootLabel), children: [] };
  const byPath = new Map<string, DirNode>([["", root]]);
  const ensure = (path: string): DirNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parent = ensure(parentPath);
    const node: DirNode = { kind: "dir", path, name: folderTitle(path, rootLabel), children: [] };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const dir of dirs) ensure(dir);
  for (const file of files) {
    const parentPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    ensure(parentPath).children.push({ kind: "file", file });
  }
  const sortNodes = (nodes: ExplorerNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      const an = a.kind === "dir" ? a.name : a.file.path;
      const bn = b.kind === "dir" ? b.name : b.file.path;
      return an.localeCompare(bn);
    });
    for (const node of nodes) if (node.kind === "dir") sortNodes(node.children);
  };
  sortNodes(root.children);
  return root;
}

export function Tree({
  root,
  files,
  dirs,
  active,
  onOpen,
  onCreateFile,
  onCreateFolder,
  onDelete,
}: {
  root: string;
  files: TreeFile[];
  dirs: string[];
  active: string;
  onOpen: (path: string) => void;
  onCreateFile: (folder: string) => void;
  onCreateFolder: (path: string) => Promise<void> | void;
  onDelete: (path: string) => void;
}) {
  const tree = buildExplorer(files, dirs, root);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hot, setHot] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [draftParent, setDraftParent] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState("");

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startFolder(parent: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(parent);
      return next;
    });
    setDraftParent(parent);
    setDraftName("");
    setDraftError("");
  }

  async function submitFolder(parent: string) {
    const name = draftName.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) {
      setDraftError("Use a single folder name.");
      return;
    }
    try {
      await onCreateFolder(parent ? `${parent}/${name}` : name);
      setDraftParent(null);
      setDraftName("");
      setDraftError("");
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not create the folder.");
    }
  }

  function FolderRow({ node, depth }: { node: DirNode; depth: number }) {
    const open = !collapsed.has(node.path);
    const drafting = draftParent === node.path;
    const showActions = !drafting && (hot === node.path || pinned === node.path);
    return (
      <li>
        <div
          className="relative flex min-h-11 items-center rounded-md"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onPointerEnter={() => setHot(node.path)}
          onPointerLeave={() => setHot((current) => (current === node.path ? null : current))}
        >
          <button
            type="button"
            onClick={() => {
              setPinned(node.path);
              toggle(node.path);
            }}
            className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-1 pr-1 text-left text-fg"
            aria-expanded={open}
          >
            <ChevronRight className={"size-4 shrink-0 text-muted " + (open ? "rotate-90" : "")} aria-hidden="true" />
            <Folder className="size-4 shrink-0 text-accent" aria-hidden="true" />
            <span className={"truncate text-sm " + (showActions ? "pr-14" : "")}>{node.name}</span>
          </button>
          <div
            className={
              "absolute right-0.5 top-1/2 flex -translate-y-1/2 " +
              (showActions ? "" : "pointer-events-none opacity-0")
            }
          >
            <button
              type="button"
              aria-label={`New file in ${node.name}`}
              title="New file"
              onClick={(event) => {
                event.stopPropagation();
                onCreateFile(node.path);
              }}
              className="inline-flex size-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
            >
              <FilePlus className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`New folder in ${node.name}`}
              title="New folder"
              onClick={(event) => {
                event.stopPropagation();
                startFolder(node.path);
              }}
              className="inline-flex size-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {drafting ? (
          <form
            className="px-2 pb-2"
            style={{ paddingLeft: `${depth * 12 + 28}px` }}
            onSubmit={(event) => {
              event.preventDefault();
              void submitFolder(node.path);
            }}
          >
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Folder name"
              aria-label={`Folder name in ${node.name}`}
              className="min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg"
            />
            {draftError ? <p className="mt-1 text-xs text-danger">{draftError}</p> : null}
          </form>
        ) : null}
        {open ? <NodeList nodes={node.children} depth={depth + 1} /> : null}
      </li>
    );
  }

  function NodeList({ nodes, depth }: { nodes: ExplorerNode[]; depth: number }) {
    if (nodes.length === 0 && depth === 1 && draftParent === null) {
      return <li className="px-2 py-4 text-sm text-muted">No .sdoc files yet.</li>;
    }
    return (
      <ul>
        {nodes.map((node) =>
          node.kind === "dir" ? (
            <FolderRow key={`dir:${node.path}`} node={node} depth={depth} />
          ) : (
            <li key={node.file.path}>
              <button
                type="button"
                onClick={() => onOpen(node.file.path)}
                className={
                  "flex min-h-11 w-full items-center gap-2 rounded-md pr-2 text-left " +
                  (node.file.path === active ? "bg-surface-2 text-fg" : "text-muted")
                }
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-fg">
                    {node.file.path.slice(node.file.path.lastIndexOf("/") + 1)}
                  </span>
                  <span className="block truncate text-xs">{node.file.title}</span>
                </span>
                {node.file.issueCount > 0 ? (
                  <span className="size-2 shrink-0 rounded-full bg-danger" title={`${node.file.issueCount} parse errors`} />
                ) : null}
              </button>
            </li>
          ),
        )}
      </ul>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-line px-3 py-2">
        <p className="font-mono text-xs tracking-widest text-accent">FILES</p>
        <p className="truncate text-xs text-muted">{root}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <ul>
          <FolderRow node={tree} depth={0} />
        </ul>
      </div>
      {active ? (
        <div className="border-t border-line p-2">
          <button
            type="button"
            onClick={() => onDelete(active)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-xs text-muted"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete file
          </button>
        </div>
      ) : null}
    </div>
  );
}
