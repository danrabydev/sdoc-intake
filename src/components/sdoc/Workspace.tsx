import { PanelLeft, PanelRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, useGroupRef, usePanelRef, type PanelSize } from "react-resizable-panels";

const LAYOUT_KEY = "sdoc-ide-layout";

function openFromSize(size: PanelSize): boolean {
  return size.inPixels > 8;
}

export function Workspace({
  wide,
  pane,
  onPane,
  files,
  editor,
  inspector,
}: {
  wide: boolean;
  pane: "files" | "intake" | "trace";
  onPane: (pane: "files" | "intake" | "trace") => void;
  files: ReactNode;
  editor: ReactNode;
  inspector: ReactNode;
}) {
  const groupRef = useGroupRef();
  const filesRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const restored = useRef(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw && groupRef.current) {
      try {
        groupRef.current.setLayout(JSON.parse(raw) as Record<string, number>);
      } catch {
        window.localStorage.removeItem(LAYOUT_KEY);
      }
    }
    restored.current = true;
    if (filesRef.current) setFilesOpen(!filesRef.current.isCollapsed());
    if (inspectorRef.current) setInspectorOpen(!inspectorRef.current.isCollapsed());
  }, [filesRef, groupRef, inspectorRef]);

  function toggle(ref: { current: { isCollapsed: () => boolean; collapse: () => void; expand: () => void } | null }) {
    const panel = ref.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }

  return wide ? (
    <div className="flex h-full min-h-0">
      <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-1" aria-label="Panels">
        <button
          type="button"
          aria-pressed={filesOpen}
          title={filesOpen ? "Hide files" : "Show files"}
          onClick={() => toggle(filesRef)}
          className={
            "inline-flex size-11 items-center justify-center rounded-md " +
            (filesOpen ? "bg-surface-2 text-fg" : "text-muted")
          }
        >
          <PanelLeft className="size-4" aria-hidden="true" />
          <span className="sr-only">Files</span>
        </button>
        <button
          type="button"
          aria-pressed={inspectorOpen}
          title={inspectorOpen ? "Hide inspector" : "Show inspector"}
          onClick={() => toggle(inspectorRef)}
          className={
            "mt-auto inline-flex size-11 items-center justify-center rounded-md " +
            (inspectorOpen ? "bg-surface-2 text-fg" : "text-muted")
          }
        >
          <PanelRight className="size-4" aria-hidden="true" />
          <span className="sr-only">Inspector</span>
        </button>
      </nav>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div className="absolute inset-0">
        <Group
          id="sdoc-ide"
          orientation="horizontal"
          groupRef={groupRef}
          className="h-full"
          resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
          onLayoutChanged={(layout, meta) => {
            if (!restored.current || !meta.isUserInteraction) return;
            window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
          }}
        >
          <Panel
            id="files"
            className="h-full min-h-0"
            panelRef={filesRef}
            collapsible
            collapsedSize={0}
            defaultSize={256}
            minSize={180}
            maxSize={480}
            groupResizeBehavior="preserve-pixel-size"
            style={{ overflow: "hidden" }}
            onResize={(size) => setFilesOpen((open) => (open === openFromSize(size) ? open : openFromSize(size)))}
          >
            <div className="h-full min-h-0 overflow-hidden bg-surface">{files}</div>
          </Panel>
          <Separator className="sdoc-sash" />
          <Panel id="editor" className="h-full min-h-0" minSize={280} style={{ overflow: "hidden" }}>
            <div className="h-full min-h-0 overflow-hidden bg-bg">{editor}</div>
          </Panel>
          <Separator className="sdoc-sash" />
          <Panel
            id="inspector"
            className="h-full min-h-0"
            panelRef={inspectorRef}
            collapsible
            collapsedSize={0}
            defaultSize={340}
            minSize={220}
            maxSize={560}
            groupResizeBehavior="preserve-pixel-size"
            style={{ overflow: "hidden" }}
            onResize={(size) =>
              setInspectorOpen((open) => (open === openFromSize(size) ? open : openFromSize(size)))
            }
          >
            <div className="h-full min-h-0 overflow-hidden bg-surface">{inspector}</div>
          </Panel>
        </Group>
        </div>
      </div>
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-line">
        {(
          [
            ["files", "Files"],
            ["intake", "Intake"],
            ["trace", "Trace"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onPane(id)}
            className={"min-h-11 flex-1 text-sm " + (pane === id ? "border-b-2 border-accent text-fg" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {pane === "files" ? files : pane === "intake" ? editor : inspector}
      </div>
    </div>
  );
}
