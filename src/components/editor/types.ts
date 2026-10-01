import type { ReactNode } from "react";

/** Side panel registered with {@link WorkspaceEditor}. Sizes are percentages of the group. */
export interface WorkspaceEditorPanelDefinition {
  id: string;
  title: string;
  side: "left" | "right";
  content: ReactNode;
  /** Default width as a percentage of the horizontal panel group. */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** Child fills the frame and manages its own scroll. */
  bleed?: boolean;
}

/** Bottom panel tab (VS Code Problems / Output style). */
export interface WorkspaceEditorBottomTabDefinition {
  id: string;
  title: string;
  content: ReactNode;
}

export interface WorkspaceEditorProps {
  /** Top menu row (File, Edit, View, …). */
  menuBar?: ReactNode;
  /** Tool strip below the menu bar. */
  toolbar?: ReactNode;
  breadcrumb?: ReactNode;
  statusBar?: ReactNode;
  /** Injectable snap-in panels (left and/or right). */
  panels?: WorkspaceEditorPanelDefinition[];
  /** Open state keyed by panel id. Omitted ids default to open. */
  panelOpen?: Record<string, boolean>;
  onPanelOpenChange?: (panelId: string, open: boolean) => void;
  /** Bottom panel tabs (Output, Problems, …). */
  bottomTabs?: WorkspaceEditorBottomTabDefinition[];
  bottomTabActive?: string;
  onBottomTabChange?: (tabId: string) => void;
  bottomPanelOpen?: boolean;
  onBottomPanelOpenChange?: (open: boolean) => void;
  /** Default height of the bottom panel as a percentage of the vertical group. */
  bottomPanelDefaultSize?: number;
  /** Persists panel sizes in localStorage under this key. */
  layoutStorageKey?: string;
  children: ReactNode;
}
