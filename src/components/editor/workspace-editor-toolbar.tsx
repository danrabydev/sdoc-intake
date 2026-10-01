import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";

export type EditorViewMode = "visual" | "source";

/** Segmented Visual | Source (or Preview | Source) control for documents that have both views. */
export function EditorViewModeToggle({
  mode,
  onChange,
  visualLabel = "Visual",
  sourceLabel = "Source",
}: {
  mode: EditorViewMode;
  onChange: (mode: EditorViewMode) => void;
  visualLabel?: string;
  sourceLabel?: string;
}) {
  return (
    <div role="group" aria-label="Editor view" className="flex items-center rounded-md border border-line bg-bg p-0.5">
      {(
        [
          ["visual", visualLabel],
          ["source", sourceLabel],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          className={"h-7 rounded px-2.5 text-xs " + (mode === id ? "bg-surface-2 text-fg" : "text-muted")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function WorkspaceEditorToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" className="mx-1 h-6 w-px shrink-0 bg-line" />;
}

export function WorkspaceEditorPanelToggle({
  side,
  open,
  onToggle,
  label,
}: {
  side: "left" | "right" | "bottom";
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  const Icon = side === "left" ? PanelLeft : side === "right" ? PanelRight : PanelBottom;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={"inline-flex size-8 items-center justify-center rounded-md " + (open ? "bg-surface-2 text-fg" : "text-muted")}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function WorkspaceEditorBottomPanelToggle({
  open,
  onToggle,
  label = "Toggle bottom panel",
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return <WorkspaceEditorPanelToggle side="bottom" open={open} onToggle={onToggle} label={label} />;
}
