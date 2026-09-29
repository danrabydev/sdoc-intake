import { useState } from "react";
import type { SDocIssue } from "@/lib/sdoc/types";

export function ValidationBar({
  issues,
  strict,
  dirty,
  saving,
  external,
  notice,
  canSave,
  onStrict,
  onSave,
  onJump,
  onReload,
}: {
  issues: SDocIssue[];
  strict: boolean;
  dirty: boolean;
  saving: boolean;
  external: boolean;
  notice: string;
  canSave: boolean;
  onStrict: (value: boolean) => void;
  onSave: () => void;
  onJump: (issue: SDocIssue) => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((issue) => issue.severity === "error" || (strict && issue.code === "missing-parent"));
  const warnings = issues.length - errors.length;

  return (
    <div className="border-t border-line bg-surface">
      {external ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg px-3 py-2 text-sm">
          <p>File changed on disk. Your unsaved edits are still here.</p>
          <button type="button" onClick={onReload} className="min-h-11 rounded-md border border-line px-3 text-xs">
            Load disk copy
          </button>
        </div>
      ) : null}
      {open && issues.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto border-b border-line">
          {issues.map((issue, index) => (
            <li key={`${issue.path}:${issue.line}:${index}`}>
              <button
                type="button"
                onClick={() => onJump(issue)}
                className="flex min-h-11 w-full items-baseline gap-2 px-3 text-left text-xs"
              >
                <span className={issue.severity === "error" ? "text-danger" : "text-accent"}>
                  {issue.severity === "error" ? "ERR" : "WARN"}
                </span>
                <span className="font-mono text-muted">
                  {issue.line}:{issue.col}
                </span>
                <span className="text-fg">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-11 text-left text-xs">
          <span className={errors.length > 0 ? "text-danger" : "text-ok"}>
            {errors.length} {errors.length === 1 ? "error" : "errors"}
          </span>
          <span className="text-muted"> · {warnings} {warnings === 1 ? "warning" : "warnings"}</span>
        </button>
        <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={strict} onChange={(event) => onStrict(event.target.checked)} />
          Strict parents
        </label>
        <span className="text-xs text-accent">{dirty ? "Unsaved" : ""}</span>
        <span className="text-xs text-ok">{notice}</span>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
          className="ml-auto min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
    </div>
  );
}
