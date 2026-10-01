import {
  createContext,
  Fragment,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/editor/menu";
import { WorkspaceEditorBottomPanelEmpty } from "@/components/editor/workspace-editor-bottom-panel";
import type { WorkspaceEditorBottomTabDefinition } from "@/components/editor/types";
import {
  WorkspaceEditorBottomPanelToggle,
  WorkspaceEditorPanelToggle,
  WorkspaceEditorToolbarSeparator,
} from "@/components/editor/workspace-editor-toolbar";

export const EDITOR_EXPLORER_PANEL_ID = "explorer";
export const EDITOR_INSPECTOR_PANEL_ID = "inspector";
export const EDITOR_BOTTOM_PANEL_ID = "bottom";

export const DEFAULT_EDITOR_PANEL_OPEN: Record<string, boolean> = {
  [EDITOR_EXPLORER_PANEL_ID]: true,
  [EDITOR_INSPECTOR_PANEL_ID]: true,
  [EDITOR_BOTTOM_PANEL_ID]: false,
};

export const EDITOR_CHROME_SLOTS = {
  menuFile: "editor-chrome-menu-file",
  menuEdit: "editor-chrome-menu-edit",
  menuView: "editor-chrome-menu-view",
  menuTools: "editor-chrome-menu-tools",
  viewMode: "editor-chrome-view-mode",
  tools: "editor-chrome-tools",
  actions: "editor-chrome-actions",
  breadcrumb: "editor-chrome-breadcrumb",
  status: "editor-chrome-status",
  inspector: "editor-chrome-inspector",
  problems: "editor-chrome-bottom-problems",
  node: "editor-chrome-bottom-node",
  output: "editor-chrome-bottom-output",
  connections: "editor-chrome-bottom-connections",
  preview: "editor-chrome-bottom-preview",
} as const;

export type EditorChromeSlotId = keyof typeof EDITOR_CHROME_SLOTS;

const VIEW_STATE_TOO_LARGE_PATTERN = /viewState is too large/i;

type SlotEntry = { id: string; node: ReactNode };

type EditorChromeSlotStore = {
  setContent: (slot: EditorChromeSlotId, id: string, node: ReactNode) => void;
  removeContent: (slot: EditorChromeSlotId, id: string) => void;
  content: (slot: EditorChromeSlotId) => readonly SlotEntry[];
  subscribe: (listener: () => void) => () => void;
};

const EMPTY_SLOT_ENTRIES: readonly SlotEntry[] = [];

function createEditorChromeSlotStore(): EditorChromeSlotStore {
  const buckets = new Map<EditorChromeSlotId, Map<string, ReactNode>>();
  const snapshots = new Map<EditorChromeSlotId, readonly SlotEntry[]>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    setContent(slot, id, node) {
      let bucket = buckets.get(slot);
      if (!bucket) {
        bucket = new Map();
        buckets.set(slot, bucket);
      }
      if (bucket.get(id) === node) return;
      bucket.set(id, node);
      snapshots.set(
        slot,
        [...bucket.entries()].map(([entryId, entryNode]) => ({ id: entryId, node: entryNode })),
      );
      notify();
    },
    removeContent(slot, id) {
      const bucket = buckets.get(slot);
      if (!bucket?.delete(id)) return;
      if (bucket.size === 0) {
        buckets.delete(slot);
        snapshots.delete(slot);
      } else {
        snapshots.set(
          slot,
          [...bucket.entries()].map(([entryId, entryNode]) => ({ id: entryId, node: entryNode })),
        );
      }
      notify();
    },
    content(slot) {
      return snapshots.get(slot) ?? EMPTY_SLOT_ENTRIES;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const EditorChromeSlotsContext = createContext<EditorChromeSlotStore | null>(null);

/** Scope chrome slots so more than one editor can share a page. */
export function EditorChromeSlotsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createEditorChromeSlotStore(), []);
  return <EditorChromeSlotsContext.Provider value={store}>{children}</EditorChromeSlotsContext.Provider>;
}

function useEditorChromeSlotStore(): EditorChromeSlotStore {
  const store = useContext(EditorChromeSlotsContext);
  if (!store) throw new Error("Editor chrome slots require EditorChromeSlotsProvider.");
  return store;
}

/** Map workspace persist failures to user-facing status text. */
export function formatEditorWorkspaceSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (!message) return "Failed to save workspace";
  if (VIEW_STATE_TOO_LARGE_PATTERN.test(message)) return "Workspace state is too large to save";
  return "Failed to save workspace";
}

const SLOT_EMPTY_HINT: Partial<Record<EditorChromeSlotId, string>> = {
  menuEdit: "No edit commands",
  menuTools: "No tools for this document",
  inspector: "Nothing to inspect.",
  problems: "No problems.",
  node: "Select a node.",
  output: "No output.",
  connections: "No connections.",
  preview: "No preview.",
};

function SlotHost({
  slot,
  className,
  fallback,
}: {
  slot: EditorChromeSlotId;
  className?: string;
  fallback?: ReactNode;
}) {
  const store = useEditorChromeSlotStore();
  const entries = useSyncExternalStore(
    store.subscribe,
    () => store.content(slot),
    () => EMPTY_SLOT_ENTRIES,
  );

  return (
    <div id={EDITOR_CHROME_SLOTS[slot]} data-editor-chrome-slot={slot} className={className}>
      {entries.length > 0 ? entries.map((entry) => <Fragment key={entry.id}>{entry.node}</Fragment>) : fallback}
    </div>
  );
}

/** Reserved chrome slot host. Documents fill it with {@link EditorChromePortal}. */
export function EditorChromeSlotHost({
  slot,
  className,
  fallback,
}: {
  slot: EditorChromeSlotId;
  className?: string;
  fallback?: ReactNode;
}) {
  return <SlotHost slot={slot} className={className} fallback={fallback} />;
}

/** Fill a reserved chrome slot. Content renders inside the slot so menu items keep menu context. */
export function EditorChromePortal({ slot, children }: { slot: EditorChromeSlotId; children: ReactNode }) {
  const store = useEditorChromeSlotStore();
  const id = useId();

  useLayoutEffect(() => {
    store.setContent(slot, id, children);
  }, [children, id, slot, store]);

  useLayoutEffect(() => {
    return () => store.removeContent(slot, id);
  }, [id, slot, store]);

  return null;
}

const menuTriggerClass = "inline-flex h-7 items-center rounded px-2 text-sm text-fg hover:bg-surface-2";

export function UnifiedEditorMenuBar({
  onSaveDocument,
  canSaveDocument = false,
  onCloseDocument,
  explorerOpen,
  inspectorOpen,
  bottomOpen,
  onToggleExplorer,
  onToggleInspector,
  onToggleBottom,
}: {
  onSaveDocument?: () => void;
  canSaveDocument?: boolean;
  onCloseDocument?: () => void;
  explorerOpen: boolean;
  inspectorOpen: boolean;
  bottomOpen: boolean;
  onToggleExplorer: () => void;
  onToggleInspector: () => void;
  onToggleBottom: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 text-sm" data-testid="editor-menu-bar">
      <DropdownMenu>
        <DropdownMenuTrigger type="button" className={menuTriggerClass}>File</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SlotHost slot="menuFile" className="contents" />
          {onSaveDocument ? (
            <DropdownMenuItem disabled={!canSaveDocument} onSelect={onSaveDocument}>
              Save
            </DropdownMenuItem>
          ) : null}
          {onCloseDocument ? <DropdownMenuItem onSelect={onCloseDocument}>Close</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger type="button" className={menuTriggerClass}>Edit</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SlotHost
            slot="menuEdit"
            className="contents"
            fallback={<DropdownMenuItem disabled>{SLOT_EMPTY_HINT.menuEdit}</DropdownMenuItem>}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger type="button" className={menuTriggerClass}>View</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onToggleExplorer}>{explorerOpen ? "Hide" : "Show"} Explorer</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleInspector}>{inspectorOpen ? "Hide" : "Show"} Inspector</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleBottom}>{bottomOpen ? "Hide" : "Show"} Bottom Panel</DropdownMenuItem>
          <SlotHost slot="menuView" className="contents" />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger type="button" className={menuTriggerClass}>Tools</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SlotHost
            slot="menuTools"
            className="contents"
            fallback={<DropdownMenuItem disabled>{SLOT_EMPTY_HINT.menuTools}</DropdownMenuItem>}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function UnifiedEditorToolbar({
  explorerOpen,
  inspectorOpen,
  bottomOpen,
  onToggleExplorer,
  onToggleInspector,
  onToggleBottom,
}: {
  explorerOpen: boolean;
  inspectorOpen: boolean;
  bottomOpen: boolean;
  onToggleExplorer: () => void;
  onToggleInspector: () => void;
  onToggleBottom: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1" data-testid="editor-toolbar">
      <SlotHost slot="viewMode" className="flex h-8 shrink-0 items-center" />
      <WorkspaceEditorToolbarSeparator />
      <SlotHost slot="tools" className="flex h-8 min-w-0 flex-1 items-center gap-1" />
      <WorkspaceEditorToolbarSeparator />
      <WorkspaceEditorPanelToggle side="left" open={explorerOpen} onToggle={onToggleExplorer} label="Toggle explorer panel" />
      <WorkspaceEditorPanelToggle side="right" open={inspectorOpen} onToggle={onToggleInspector} label="Toggle inspector panel" />
      <WorkspaceEditorBottomPanelToggle open={bottomOpen} onToggle={onToggleBottom} />
      <WorkspaceEditorToolbarSeparator />
      <SlotHost slot="actions" className="ml-auto flex items-center gap-2" />
    </div>
  );
}

function slotFallback(message: string) {
  return <WorkspaceEditorBottomPanelEmpty message={message} />;
}

const EDITOR_BOTTOM_TABS: WorkspaceEditorBottomTabDefinition[] = [
  {
    id: "node",
    title: "Node",
    content: <SlotHost slot="node" className="h-full" fallback={slotFallback(SLOT_EMPTY_HINT.node ?? "")} />,
  },
  {
    id: "problems",
    title: "Problems",
    content: <SlotHost slot="problems" className="h-full" fallback={slotFallback(SLOT_EMPTY_HINT.problems ?? "")} />,
  },
  {
    id: "output",
    title: "Output",
    content: <SlotHost slot="output" className="h-full" fallback={slotFallback(SLOT_EMPTY_HINT.output ?? "")} />,
  },
  {
    id: "connections",
    title: "Connections",
    content: (
      <SlotHost slot="connections" className="h-full" fallback={slotFallback(SLOT_EMPTY_HINT.connections ?? "")} />
    ),
  },
  {
    id: "preview",
    title: "Preview",
    content: <SlotHost slot="preview" className="h-full" fallback={slotFallback(SLOT_EMPTY_HINT.preview ?? "")} />,
  },
];

/** Bottom tabs in a stable order. Pass ids to hide the ones this editor does not use. */
export function stableEditorBottomTabs(ids?: readonly string[]): WorkspaceEditorBottomTabDefinition[] {
  if (!ids) return EDITOR_BOTTOM_TABS;
  return ids.flatMap((id) => {
    const tab = EDITOR_BOTTOM_TABS.find((item) => item.id === id);
    return tab ? [tab] : [];
  });
}

export function EditorInspectorSlot() {
  return (
    <SlotHost
      slot="inspector"
      className="h-full"
      fallback={<p className="px-1 text-sm text-muted">{SLOT_EMPTY_HINT.inspector}</p>}
    />
  );
}
