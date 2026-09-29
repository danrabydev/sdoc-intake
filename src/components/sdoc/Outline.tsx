import { fieldOf, flatten, indentNode, moveNode, nodeUid, outdentNode, outlineNumbers, prefixExpectations, reorderSibling } from "@/lib/sdoc/model";
import type { SDocDocument, SDocNode } from "@/lib/sdoc/types";

export function Outline({
  document,
  selected,
  onSelect,
  onChange,
  onAddRootSection,
  onFix,
  onSectionPrefix,
}: {
  document: SDocDocument;
  selected: string;
  onSelect: (uid: string) => void;
  onChange: (nodes: SDocNode[]) => void;
  onAddRootSection: () => void;
  onFix: (uid?: string) => void;
  onSectionPrefix: (uid: string, value: string) => void;
}) {
  const rows = flatten(document.nodes);
  const numbers = outlineNumbers(document.nodes);
  const prefixes = prefixExpectations(document);
  const row = rows.find((item) => nodeUid(item.node) === selected);
  const index = row ? row.path[row.path.length - 1] ?? 0 : -1;
  const parentPath = row ? row.path.slice(0, -1) : [];
  const siblings = row
    ? parentPath.reduce((list, at) => list[at]?.children ?? [], document.nodes)
    : [];
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const canUp = index > 0;
  const canDown = row ? index < siblings.length - 1 : false;
  const canIn = Boolean(previous?.composite);
  const canOut = Boolean(row && row.path.length > 1);

  function apply(next: { nodes: SDocNode[]; ok: boolean } | SDocNode[]) {
    if (Array.isArray(next)) onChange(next);
    else if (next.ok) onChange(next.nodes);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs text-muted">Document outline</p>
        <div className="flex items-center gap-2">
          {prefixes.size > 0 ? (
            <button
              type="button"
              onClick={() => onFix()}
              className="min-h-9 rounded-md px-2 text-xs text-accent"
            >
              Fix prefixes
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAddRootSection}
            className="min-h-9 rounded-md border border-line px-2 text-xs text-fg"
          >
            Section at root
          </button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.length === 0 ? <li className="px-3 py-6 text-sm text-muted">No nodes yet.</li> : null}
        {rows.map((item) => {
          const uid = nodeUid(item.node);
          const title = fieldOf(item.node, "TITLE") || fieldOf(item.node, "STATEMENT").split("\n")[0] || "Untitled";
          const number = numbers.get(item.path.join("."));
          const expected = prefixes.get(uid);
          const active = uid !== "" && uid === selected;
          return (
            <li key={item.path.join(".")}>
              <div
                className={
                  "flex min-h-9 w-full items-baseline gap-2 pr-2 " + (active ? "bg-surface-2 text-fg" : "text-muted")
                }
                style={{ paddingLeft: `${item.depth * 12 + 8}px` }}
              >
                <button
                  type="button"
                  onClick={() => uid && onSelect(uid)}
                  className="flex min-h-9 min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className="w-14 shrink-0 font-mono text-[10px] tabular-nums text-accent">{number ?? ""}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">{title}</span>
                </button>
                {expected ? (
                  <button
                    type="button"
                    title={`Prefix should be ${expected}. Click to fix.`}
                    onClick={() => onFix(uid)}
                    className="shrink-0 font-mono text-[10px] text-accent"
                  >
                    {uid}
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-muted">{uid}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {row?.node.tag === "SECTION" ? (
        <label className="flex items-center gap-2 border-t border-line px-2 py-2 text-xs text-muted">
          Section prefix
          <input
            value={fieldOf(row.node, "PREFIX")}
            onChange={(event) => onSectionPrefix(selected, event.target.value)}
            placeholder="PROT"
            className="min-h-9 w-24 bg-transparent font-mono text-xs text-fg"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-1 border-t border-line p-2">
        <MoveButton label="Up" disabled={!canUp} onClick={() => apply(reorderSibling(document.nodes, selected, -1))} />
        <MoveButton label="Down" disabled={!canDown} onClick={() => apply(reorderSibling(document.nodes, selected, 1))} />
        <MoveButton label="In" disabled={!canIn} onClick={() => apply(indentNode(document.nodes, selected))} />
        <MoveButton label="Out" disabled={!canOut} onClick={() => apply(outdentNode(document.nodes, selected))} />
        <MoveButton
          label="Root"
          disabled={!row || row.depth === 0}
          onClick={() => apply(moveNode(document.nodes, selected, { where: "root" }))}
        />
      </div>
    </div>
  );
}

function MoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-9 rounded-md border border-line px-2 text-xs text-muted disabled:opacity-40"
    >
      {label}
    </button>
  );
}
