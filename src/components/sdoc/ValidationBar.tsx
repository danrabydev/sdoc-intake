import type { SDocIssue } from "@/lib/sdoc/types";

export function ValidationBar({ issues, onJump }: { issues: SDocIssue[]; onJump: (issue: SDocIssue) => void }) {
  if (issues.length === 0) return <p className="px-1 text-xs text-muted">No problems.</p>;
  return (
    <ul>
      {issues.map((issue, index) => (
        <li key={`${issue.path}:${issue.line}:${index}`}>
          <button type="button" onClick={() => onJump(issue)} className="flex min-h-8 w-full items-baseline gap-2 text-left text-xs">
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
  );
}
