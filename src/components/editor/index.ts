export type {
  WorkspaceEditorBottomTabDefinition,
  WorkspaceEditorPanelDefinition,
  WorkspaceEditorProps,
} from "@/components/editor/types";
export { WorkspaceEditor, WORKSPACE_EDITOR_NARROW_MAX_WIDTH_PX, WORKSPACE_EDITOR_NARROW_MEDIA_QUERY } from "@/components/editor/workspace-editor";
export { WorkspaceEditorPanelFrame } from "@/components/editor/workspace-editor-panel";
export { WorkspaceEditorBottomPanel, WorkspaceEditorBottomPanelEmpty } from "@/components/editor/workspace-editor-bottom-panel";
export {
  EditorViewModeToggle,
  WorkspaceEditorBottomPanelToggle,
  WorkspaceEditorPanelToggle,
  WorkspaceEditorToolbarSeparator,
} from "@/components/editor/workspace-editor-toolbar";
export type { EditorViewMode } from "@/components/editor/workspace-editor-toolbar";
export {
  DEFAULT_EDITOR_PANEL_OPEN,
  EDITOR_BOTTOM_PANEL_ID,
  EDITOR_CHROME_SLOTS,
  EDITOR_EXPLORER_PANEL_ID,
  EDITOR_INSPECTOR_PANEL_ID,
  EditorChromePortal,
  EditorChromeSlotHost,
  EditorChromeSlotsProvider,
  EditorInspectorSlot,
  UnifiedEditorMenuBar,
  UnifiedEditorToolbar,
  formatEditorWorkspaceSaveError,
  stableEditorBottomTabs,
} from "@/components/editor/chrome";
export type { EditorChromeSlotId } from "@/components/editor/chrome";
export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/editor/menu";
