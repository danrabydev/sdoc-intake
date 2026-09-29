import { FilePlus, Trash2 } from "lucide-react";
import type { TreeFile } from "@/lib/sdoc/api-types";

export function Tree({
  root,
  files,
  active,
  onOpen,
  onCreate,
  onDelete,
}: {
  root: string;
  files: TreeFile[];
  active: string;
  onOpen: (path: string) => void;
  onCreate: () => void;
  onDelete: (path: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-widest text-accent">FILES</p>
          <p className="truncate text-xs text-muted">{root}</p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 text-xs text-fg"
        >
          <FilePlus className="size-4" aria-hidden="true" />
          New
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {files.length === 0 ? (
          <li className="px-2 py-6 text-sm text-muted">No .sdoc files in this root.</li>
        ) : (
          files.map((file) => {
            const selected = file.path === active;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onOpen(file.path)}
                  className={
                    "flex w-full min-h-11 items-center gap-2 rounded-md px-2 text-left " +
                    (selected ? "bg-surface-2 text-fg" : "text-muted")
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-fg">{file.path}</span>
                    <span className="block truncate text-xs">{file.title}</span>
                  </span>
                  {file.issueCount > 0 ? (
                    <span className="size-2 shrink-0 rounded-full bg-danger" title={`${file.issueCount} parse errors`} />
                  ) : null}
                  <span className="font-mono text-xs tabular-nums text-muted">{file.nodeCount}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
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
