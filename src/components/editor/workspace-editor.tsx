import { useEffect, useRef, useState, type RefObject } from "react";
import { Group, Panel, Separator, useGroupRef, usePanelRef, type PanelImperativeHandle } from "react-resizable-panels";
import type { WorkspaceEditorPanelDefinition, WorkspaceEditorProps } from "@/components/editor/types";
import { WorkspaceEditorBottomPanel } from "@/components/editor/workspace-editor-bottom-panel";
import { WorkspaceEditorPanelFrame } from "@/components/editor/workspace-editor-panel";

const DEFAULT_LEFT_SIZE = 20;
const DEFAULT_RIGHT_SIZE = 26;
const DEFAULT_LEFT_MIN = 12;
const DEFAULT_RIGHT_MIN = 16;
const DEFAULT_BOTTOM_SIZE = 22;

/** Drawers replace side columns below this width. */
export const WORKSPACE_EDITOR_NARROW_MAX_WIDTH_PX = 768;

export const WORKSPACE_EDITOR_NARROW_MEDIA_QUERY = `(max-width: ${WORKSPACE_EDITOR_NARROW_MAX_WIDTH_PX - 1}px)`;

function useNarrowWorkspaceLayout(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(WORKSPACE_EDITOR_NARROW_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQueryList = window.matchMedia(WORKSPACE_EDITOR_NARROW_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  return isNarrow;
}

function isPanelOpen(panelOpen: Record<string, boolean> | undefined, panelId: string): boolean {
  return panelOpen?.[panelId] ?? true;
}

function readLayout(key: string | undefined): Record<string, number> | undefined {
  if (!key || typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    window.localStorage.removeItem(key);
    return undefined;
  }
}

function syncPanel(panel: PanelImperativeHandle | null, open: boolean, openSize: string) {
  if (!panel) return;
  if (open) {
    if (!panel.isCollapsed()) return;
    panel.expand();
    if (panel.getSize().inPixels < 8) panel.resize(openSize);
    return;
  }
  if (!panel.isCollapsed()) panel.collapse();
}

function SidePanelBody({ definition }: { definition: WorkspaceEditorPanelDefinition }) {
  return (
    <div data-testid={`panel-${definition.id}`} className="h-full min-h-0">
      {definition.content}
    </div>
  );
}

function SidePanelDrawer({
  definition,
  open,
  onOpenChange,
}: {
  definition: WorkspaceEditorPanelDefinition;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  if (!open) return null;
  const side = definition.side;
  return (
    <>
      <button
        type="button"
        aria-label={`Close ${definition.title} drawer backdrop`}
        className="absolute inset-0 z-40 bg-black/40"
        onClick={() => onOpenChange?.(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={definition.title}
        data-panel-mode="drawer"
        className={
          "absolute inset-y-0 z-50 flex w-[min(85vw,20rem)] flex-col bg-surface shadow-lg " +
          (side === "left" ? "left-0 border-r border-line" : "right-0 border-l border-line")
        }
      >
        <WorkspaceEditorPanelFrame
          title={definition.title}
          bleed={definition.bleed}
          onClose={onOpenChange ? () => onOpenChange(false) : undefined}
        >
          <SidePanelBody definition={definition} />
        </WorkspaceEditorPanelFrame>
      </div>
    </>
  );
}

/**
 * IDE shell ported from the raby-family WorkspaceEditor.
 * Side and bottom panels snap and collapse. Sizes on panel definitions are percentages.
 */
export function WorkspaceEditor({
  menuBar,
  toolbar,
  breadcrumb,
  statusBar,
  panels = [],
  panelOpen,
  onPanelOpenChange,
  bottomTabs = [],
  bottomTabActive,
  onBottomTabChange,
  bottomPanelOpen,
  onBottomPanelOpenChange,
  bottomPanelDefaultSize = DEFAULT_BOTTOM_SIZE,
  layoutStorageKey,
  children,
}: WorkspaceEditorProps) {
  const leftPanel = panels.find((panel) => panel.side === "left");
  const rightPanel = panels.find((panel) => panel.side === "right");
  const leftOpen = leftPanel ? isPanelOpen(panelOpen, leftPanel.id) : false;
  const rightOpen = rightPanel ? isPanelOpen(panelOpen, rightPanel.id) : false;
  const bottomOpen = bottomPanelOpen ?? false;
  const isNarrow = useNarrowWorkspaceLayout();
  const hasBottom = bottomTabs.length > 0;

  const [internalBottomTab, setInternalBottomTab] = useState(bottomTabs[0]?.id ?? "");
  const activeBottomTab = bottomTabActive ?? internalBottomTab ?? bottomTabs[0]?.id ?? "";

  const leftId = leftPanel?.id;
  const rightId = rightPanel?.id;
  const leftSize = `${leftPanel?.defaultSize ?? DEFAULT_LEFT_SIZE}%`;
  const rightSize = `${rightPanel?.defaultSize ?? DEFAULT_RIGHT_SIZE}%`;
  const columnsRef = useGroupRef();
  const verticalRef = useGroupRef();
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const bottomRef = usePanelRef();
  const columnsReady = useRef(false);
  const verticalReady = useRef(false);
  const wasNarrow = useRef(isNarrow);
  const onChangeRef = useRef(onPanelOpenChange);
  onChangeRef.current = onPanelOpenChange;

  const columnsKey = layoutStorageKey ? `sdoc-editor-layout:${layoutStorageKey}:columns` : undefined;
  const verticalKey = layoutStorageKey ? `sdoc-editor-layout:${layoutStorageKey}:vertical` : undefined;

  useEffect(() => {
    const saved = readLayout(columnsKey);
    if (saved) columnsRef.current?.setLayout(saved);
    columnsReady.current = true;
  }, [columnsKey, columnsRef]);

  useEffect(() => {
    const saved = readLayout(verticalKey);
    if (saved) verticalRef.current?.setLayout(saved);
    verticalReady.current = true;
  }, [verticalKey, verticalRef]);

  useEffect(() => {
    if (isNarrow && !wasNarrow.current) {
      if (leftId) onChangeRef.current?.(leftId, false);
      if (rightId) onChangeRef.current?.(rightId, false);
    }
    wasNarrow.current = isNarrow;
  }, [isNarrow, leftId, rightId]);

  useEffect(() => {
    if (isNarrow || !leftId) return;
    syncPanel(leftRef.current, leftOpen, leftSize);
  }, [isNarrow, leftId, leftOpen, leftSize, leftRef]);

  useEffect(() => {
    if (isNarrow || !rightId) return;
    syncPanel(rightRef.current, rightOpen, rightSize);
  }, [isNarrow, rightId, rightOpen, rightSize, rightRef]);

  useEffect(() => {
    if (!hasBottom) return;
    syncPanel(bottomRef.current, bottomOpen, `${bottomPanelDefaultSize}%`);
  }, [bottomOpen, bottomPanelDefaultSize, bottomRef, hasBottom]);

  useEffect(() => {
    if (bottomTabs.length === 0) return;
    if (bottomTabs.some((tab) => tab.id === activeBottomTab)) return;
    const next = bottomTabs[0]?.id ?? "";
    if (onBottomTabChange) onBottomTabChange(next);
    else setInternalBottomTab(next);
  }, [activeBottomTab, bottomTabs, onBottomTabChange]);

  function persist(key: string | undefined, ref: RefObject<{ getLayout: () => Record<string, number> } | null>, ready: { current: boolean }) {
    if (!key || !ready.current) return;
    const layout = ref.current?.getLayout();
    if (layout) window.localStorage.setItem(key, JSON.stringify(layout));
  }

  function reportSide(id: string, pixels: number) {
    onPanelOpenChange?.(id, pixels > 8);
  }

  const editorColumn = hasBottom ? (
    <div className="relative h-full min-h-0">
      <div className="absolute inset-0">
        <Group
          id={layoutStorageKey ? `${layoutStorageKey}-vertical` : undefined}
          orientation="vertical"
          groupRef={verticalRef}
          className="h-full"
          resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
          onLayoutChanged={(layout) => {
            if (!verticalReady.current || !verticalKey) return;
            window.localStorage.setItem(verticalKey, JSON.stringify(layout));
          }}
        >
          <Panel id="workspace-document" className="min-h-0" minSize="35%" defaultSize="100%" style={{ overflow: "hidden" }}>
            <div className="h-full min-h-0 overflow-hidden">{children}</div>
          </Panel>
          <Separator className="sdoc-sash" />
          <Panel
            id="workspace-bottom"
            panelRef={bottomRef}
            collapsible
            collapsedSize={0}
            defaultSize={0}
            minSize="12%"
            maxSize="45%"
            className="min-h-0"
            style={{ overflow: "hidden" }}
            onResize={(size) => {
              const open = size.inPixels > 8;
              if (open !== bottomOpen) onBottomPanelOpenChange?.(open);
              persist(verticalKey, verticalRef, verticalReady);
            }}
          >
            <WorkspaceEditorBottomPanel
              tabs={bottomTabs}
              activeTabId={activeBottomTab}
              onTabChange={(tabId) => {
                onBottomTabChange?.(tabId);
                if (!bottomTabActive) setInternalBottomTab(tabId);
                if (!bottomOpen) onBottomPanelOpenChange?.(true);
              }}
              onClose={onBottomPanelOpenChange ? () => onBottomPanelOpenChange(false) : undefined}
            />
          </Panel>
        </Group>
      </div>
    </div>
  ) : (
    <div className="h-full min-h-0 overflow-hidden">{children}</div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg" data-workspace-layout={isNarrow ? "narrow" : "desktop"}>
      {menuBar ? <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 py-1">{menuBar}</div> : null}
      {toolbar ? <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1">{toolbar}</div> : null}
      {breadcrumb ? <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-line px-3 py-1">{breadcrumb}</div> : null}
      {isNarrow ? (
        <div className="relative min-h-0 flex-1">
          <div className="h-full min-h-0">{editorColumn}</div>
          {leftPanel ? (
            <SidePanelDrawer
              definition={leftPanel}
              open={leftOpen}
              onOpenChange={onPanelOpenChange ? (open) => onPanelOpenChange(leftPanel.id, open) : undefined}
            />
          ) : null}
          {rightPanel ? (
            <SidePanelDrawer
              definition={rightPanel}
              open={rightOpen}
              onOpenChange={onPanelOpenChange ? (open) => onPanelOpenChange(rightPanel.id, open) : undefined}
            />
          ) : null}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <Group
              id={layoutStorageKey ? `${layoutStorageKey}-columns` : "workspace-columns"}
              orientation="horizontal"
              groupRef={columnsRef}
              className="h-full"
              resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
              onLayoutChanged={(layout) => {
                if (!columnsReady.current || !columnsKey) return;
                window.localStorage.setItem(columnsKey, JSON.stringify(layout));
              }}
            >
              {leftPanel ? (
                <Panel
                  id={leftPanel.id}
                  panelRef={leftRef}
                  collapsible
                  collapsedSize={0}
                  defaultSize={`${leftPanel.defaultSize ?? DEFAULT_LEFT_SIZE}%`}
                  minSize={`${leftPanel.minSize ?? DEFAULT_LEFT_MIN}%`}
                  maxSize={`${leftPanel.maxSize ?? 40}%`}
                  groupResizeBehavior="preserve-pixel-size"
                  className="min-h-0"
                  style={{ overflow: "hidden" }}
                  onResize={(size) => {
                    reportSide(leftPanel.id, size.inPixels);
                    persist(columnsKey, columnsRef, columnsReady);
                  }}
                >
                  <WorkspaceEditorPanelFrame
                    title={leftPanel.title}
                    bleed={leftPanel.bleed}
                    onClose={onPanelOpenChange ? () => onPanelOpenChange(leftPanel.id, false) : undefined}
                  >
                    <SidePanelBody definition={leftPanel} />
                  </WorkspaceEditorPanelFrame>
                </Panel>
              ) : null}
              {leftPanel ? <Separator className="sdoc-sash" /> : null}
              <Panel id="workspace-center" className="min-h-0" minSize={280} style={{ overflow: "hidden" }}>
                {editorColumn}
              </Panel>
              {rightPanel ? <Separator className="sdoc-sash" /> : null}
              {rightPanel ? (
                <Panel
                  id={rightPanel.id}
                  panelRef={rightRef}
                  collapsible
                  collapsedSize={0}
                  defaultSize={`${rightPanel.defaultSize ?? DEFAULT_RIGHT_SIZE}%`}
                  minSize={`${rightPanel.minSize ?? DEFAULT_RIGHT_MIN}%`}
                  maxSize={`${rightPanel.maxSize ?? 45}%`}
                  groupResizeBehavior="preserve-pixel-size"
                  className="min-h-0"
                  style={{ overflow: "hidden" }}
                  onResize={(size) => {
                    reportSide(rightPanel.id, size.inPixels);
                    persist(columnsKey, columnsRef, columnsReady);
                  }}
                >
                  <WorkspaceEditorPanelFrame
                    title={rightPanel.title}
                    bleed={rightPanel.bleed}
                    onClose={onPanelOpenChange ? () => onPanelOpenChange(rightPanel.id, false) : undefined}
                  >
                    <SidePanelBody definition={rightPanel} />
                  </WorkspaceEditorPanelFrame>
                </Panel>
              ) : null}
            </Group>
          </div>
        </div>
      )}
      {statusBar ? <div className="shrink-0 border-t border-line bg-surface px-3 py-1 text-xs">{statusBar}</div> : null}
    </div>
  );
}
