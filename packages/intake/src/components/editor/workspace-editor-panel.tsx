import type { ReactNode } from "react";
import { X } from "lucide-react";

export function WorkspaceEditorPanelFrame({
  title,
  onClose,
  bleed = false,
  children,
}: {
  title: string;
  onClose?: () => void;
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line px-2">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</span>
        {onClose ? (
          <button
            type="button"
            aria-label={`Close ${title} panel`}
            onClick={onClose}
            className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className={bleed ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto p-2"}>{children}</div>
    </div>
  );
}
