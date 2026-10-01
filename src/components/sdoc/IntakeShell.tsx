import type { ReactNode } from "react";
import {
  EDITOR_EXPLORER_PANEL_ID,
  EDITOR_INSPECTOR_PANEL_ID,
  EditorChromeSlotsProvider,
  UnifiedEditorMenuBar,
  UnifiedEditorToolbar,
  WorkspaceEditor,
  stableEditorBottomTabs,
} from "@/components/editor";

export function IntakeShell({
  files,
  editor,
  inspector,
  breadcrumb,
  statusBar,
  panelOpen,
  onPanelOpenChange,
  bottomOpen,
  onBottomOpenChange,
  bottomTab,
  onBottomTabChange,
  onSave,
  canSave,
}: {
  files: ReactNode;
  editor: ReactNode;
  inspector: ReactNode;
  breadcrumb: ReactNode;
  statusBar: ReactNode;
  panelOpen: Record<string, boolean>;
  onPanelOpenChange: (id: string, open: boolean) => void;
  bottomOpen: boolean;
  onBottomOpenChange: (open: boolean) => void;
  bottomTab: string;
  onBottomTabChange: (tabId: string) => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const explorerOpen = panelOpen[EDITOR_EXPLORER_PANEL_ID] ?? true;
  const inspectorOpen = panelOpen[EDITOR_INSPECTOR_PANEL_ID] ?? true;
  const toggle = (id: string, open: boolean) => onPanelOpenChange(id, !open);

  return (
    <EditorChromeSlotsProvider>
      <WorkspaceEditor
        layoutStorageKey="sdoc-ide"
        menuBar={
          <>
            <p className="font-mono text-xs tracking-widest text-accent">SDOC</p>
            <UnifiedEditorMenuBar
              onSaveDocument={onSave}
              canSaveDocument={canSave}
              explorerOpen={explorerOpen}
              inspectorOpen={inspectorOpen}
              bottomOpen={bottomOpen}
              onToggleExplorer={() => toggle(EDITOR_EXPLORER_PANEL_ID, explorerOpen)}
              onToggleInspector={() => toggle(EDITOR_INSPECTOR_PANEL_ID, inspectorOpen)}
              onToggleBottom={() => onBottomOpenChange(!bottomOpen)}
            />
          </>
        }
        toolbar={
          <UnifiedEditorToolbar
            explorerOpen={explorerOpen}
            inspectorOpen={inspectorOpen}
            bottomOpen={bottomOpen}
            onToggleExplorer={() => toggle(EDITOR_EXPLORER_PANEL_ID, explorerOpen)}
            onToggleInspector={() => toggle(EDITOR_INSPECTOR_PANEL_ID, inspectorOpen)}
            onToggleBottom={() => onBottomOpenChange(!bottomOpen)}
          />
        }
        breadcrumb={breadcrumb}
        statusBar={statusBar}
        panelOpen={panelOpen}
        onPanelOpenChange={onPanelOpenChange}
        bottomTabs={stableEditorBottomTabs(["node", "problems"])}
        bottomTabActive={bottomTab}
        onBottomTabChange={onBottomTabChange}
        bottomPanelOpen={bottomOpen}
        onBottomPanelOpenChange={onBottomOpenChange}
        bottomPanelDefaultSize={36}
        panels={[
          {
            id: EDITOR_EXPLORER_PANEL_ID,
            title: "Explorer",
            side: "left",
            defaultSize: 20,
            minSize: 12,
            maxSize: 40,
            bleed: true,
            content: files,
          },
          {
            id: EDITOR_INSPECTOR_PANEL_ID,
            title: "Inspector",
            side: "right",
            defaultSize: 26,
            minSize: 16,
            maxSize: 45,
            bleed: true,
            content: inspector,
          },
        ]}
      >
        {editor}
      </WorkspaceEditor>
    </EditorChromeSlotsProvider>
  );
}
