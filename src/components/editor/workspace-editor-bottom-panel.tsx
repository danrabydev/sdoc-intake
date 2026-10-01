import type { ReactNode } from "react";
import { PanelBottomClose } from "lucide-react";

export interface WorkspaceEditorBottomTabDefinition {
  id: string;
  title: string;
  content: ReactNode;
}

/** VS Code-style bottom panel: flat tab strip + scrollable body. */
export function WorkspaceEditorBottomPanel({
  tabs,
  activeTabId,
  onTabChange,
  onClose,
}: {
  tabs: WorkspaceEditorBottomTabDefinition[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onClose?: () => void;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 items-stretch border-b border-line bg-surface-2">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={
                  "shrink-0 border-r border-line px-3 py-1.5 text-xs font-medium tracking-wide uppercase " +
                  (active ? "border-t-2 border-t-accent text-fg" : "border-t-2 border-t-transparent text-muted")
                }
                onClick={() => onTabChange(tab.id)}
              >
                {tab.title}
              </button>
            );
          })}
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close bottom panel"
            title="Close bottom panel"
            onClick={onClose}
            className="my-auto mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-fg"
          >
            <PanelBottomClose className="size-4" />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">{activeTab?.content ?? <p className="text-xs text-muted">No panel content.</p>}</div>
    </div>
  );
}

export function WorkspaceEditorBottomPanelEmpty({ message }: { message?: string }) {
  return <div className="flex h-full items-center justify-center p-4 text-xs text-muted">{message ?? "No items"}</div>;
}
