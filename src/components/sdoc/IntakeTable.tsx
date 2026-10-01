import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { elementLinks, fallbackTag, tagLabel } from "@/lib/sdoc/grammar";
import { fieldOf, flatten, outlineNumbers, selectionKey } from "@/lib/sdoc/model";
import type { GrammarElement, GrammarField, Relation, SDocDocument, SDocNode } from "@/lib/sdoc/types";
import { RelationTags } from "@/components/sdoc/RelationTags";

const PROSE = new Set(["STATEMENT", "DESCRIPTION", "RATIONALE", "COMMENT"]);

function grammarOf(document: SDocDocument, tag: string): GrammarElement | undefined {
  return document.grammar.elements.find((element) => element.tag === tag);
}

function fieldsOf(element: GrammarElement | undefined): GrammarField[] {
  if (element) return element.fields;
  return [
    { title: "UID", type: "String", required: false },
    { title: "TITLE", type: "String", required: false },
    { title: "STATEMENT", type: "String", required: false },
  ];
}

function isProse(field: GrammarField): boolean {
  return field.type === "MultiLineString" || PROSE.has(field.title);
}

function FieldControl({
  field,
  node,
  path,
  marked,
  onField,
}: {
  field: GrammarField;
  node: SDocNode;
  path: number[];
  marked?: string;
  onField: (path: number[], name: string, value: string) => void;
}) {
  const value = fieldOf(node, field.title);
  const options = field.options ?? [];
  const choice = (field.type === "SingleChoice" || field.type === "Choice") && options.length > 0;
  const inputClass = "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg";
  return (
    <label className="block text-xs text-muted">
      {field.title}
      {field.required ? <span className="text-accent"> *</span> : null}
      {field.type === "Boolean" ? (
        <select
          aria-label={field.title}
          value={value === "True" || value === "False" ? value : ""}
          onChange={(event) => onField(path, field.title, event.target.value)}
          className={inputClass}
        >
          <option value="">—</option>
          <option value="True">True</option>
          <option value="False">False</option>
        </select>
      ) : choice ? (
        <select
          aria-label={field.title}
          value={options.includes(value) ? value : ""}
          onChange={(event) => onField(path, field.title, event.target.value)}
          className={inputClass}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : isProse(field) ? (
        <textarea
          aria-label={field.title}
          value={value}
          rows={field.title === "STATEMENT" || field.title === "DESCRIPTION" ? 8 : 4}
          onChange={(event) => onField(path, field.title, event.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-2 text-sm leading-relaxed text-fg"
        />
      ) : (
        <input
          aria-label={field.title}
          value={value}
          title={marked}
          onChange={(event) =>
            onField(
              path,
              field.title,
              field.title === "UID" ? event.target.value.replace(/\s+/g, "") : event.target.value,
            )
          }
          className={
            inputClass +
            (field.title === "UID" ? " font-mono" : "") +
            (marked ? " text-accent" : "")
          }
        />
      )}
      {marked ? <span className="mt-1 block text-accent">Prefix should be {marked}</span> : null}
    </label>
  );
}

export function IntakeTable({
  document,
  selected,
  index,
  onSelect,
  onField,
  onRelations,
  onInsert,
  onDelete,
  markedUids,
}: {
  document: SDocDocument;
  selected: string;
  index: IndexNode[];
  onSelect: (uid: string) => void;
  onField: (path: number[], name: string, value: string) => void;
  onRelations: (path: number[], relations: Relation[]) => void;
  onInsert: (tag: string, where: "inside" | "after") => void;
  onDelete: () => void;
  markedUids?: ReadonlyMap<string, string>;
}) {
  const rows = flatten(document.nodes);
  const numbers = outlineNumbers(document.nodes);
  const elements = document.grammar.elements;
  const tags = elements.map((element) => element.tag);
  const [picked, setPicked] = useState("");
  const addTag = tags.includes(picked) ? picked : fallbackTag(tags, ["REQUIREMENT", "RELEASE", "SECTION"]);
  const selectedRow = rows.find((row) => selectionKey(row.node, row.path) === selected);
  const intoComposite = Boolean(selectedRow?.node.composite);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs text-muted">
          <span className="font-mono text-accent">{rows.length}</span> nodes
          {intoComposite ? " · new nodes go inside" : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={!selected}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line px-2 text-xs text-muted disabled:opacity-40"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </button>
          {intoComposite ? (
            <button
              type="button"
              onClick={() => addTag && onInsert(addTag, "after")}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-2 text-xs text-muted"
            >
              After
            </button>
          ) : null}
          <select
            aria-label="Element to add"
            value={addTag}
            onChange={(event) => setPicked(event.target.value)}
            disabled={tags.length === 0}
            className="min-h-11 rounded-md border border-line bg-bg px-2 text-xs text-fg disabled:opacity-40"
          >
            {elements.map((element) => (
              <option key={element.tag} value={element.tag}>
                {tagLabel(element.tag)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addTag}
            onClick={() => onInsert(addTag, intoComposite ? "inside" : "after")}
            className="inline-flex min-h-11 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
        <Group id="sdoc-nodes" orientation="vertical" className="h-full" resizeTargetMinimumSize={{ coarse: 20, fine: 8 }}>
          <Panel id="list" className="h-full min-h-0" defaultSize="38%" minSize="6rem" style={{ overflow: "hidden" }}>
            <div className="h-full overflow-auto">
              <table className="sdoc-nodes text-xs">
                <thead className="sticky top-0 z-10 bg-surface text-muted">
                  <tr className="border-b border-line">
                    <th className="shrink px-2 py-2 font-medium">#</th>
                    <th className="shrink px-2 py-2 font-medium">UID</th>
                    <th className="grow px-2 py-2 font-medium">Title</th>
                    <th className="shrink px-2 py-2 font-medium">Tag</th>
                    <th className="shrink px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const uid = fieldOf(row.node, "UID");
                    const pick = selectionKey(row.node, row.path);
                    const active = pick === selected;
                    const title = fieldOf(row.node, "TITLE") || fieldOf(row.node, "STATEMENT").split("\n")[0] || "Untitled";
                    const status = fieldOf(row.node, "STATUS");
                    const marked = uid ? markedUids?.get(uid) : undefined;
                    return (
                      <tr
                        key={row.path.join(".")}
                        data-uid={uid || undefined}
                        onClick={() => onSelect(pick)}
                        className={"cursor-pointer border-b border-line " + (active ? "bg-surface-2 text-fg" : "text-muted")}
                      >
                        <td className="shrink px-2 py-2 font-mono text-xs tabular-nums text-accent">
                          {numbers.get(row.path.join(".")) ?? ""}
                        </td>
                        <td
                          className={"shrink px-2 py-2 font-mono " + (marked ? "text-accent" : "text-fg")}
                          title={marked ? `Prefix should be ${marked}` : undefined}
                          style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
                        >
                          {uid || "—"}
                        </td>
                        <td className={"grow px-2 py-2 " + (row.node.composite ? "font-medium text-fg" : "text-fg")}>
                          {title}
                        </td>
                        <td className="shrink px-2 py-2 font-mono tracking-wide">{row.node.tag}</td>
                        <td className="shrink px-2 py-2">{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 ? (
                <p className="px-3 py-8 text-sm text-muted">No nodes yet. Add an element from the grammar.</p>
              ) : null}
            </div>
          </Panel>
          <Separator className="sdoc-sash" />
          <Panel id="fields" className="h-full min-h-0" defaultSize="62%" minSize="10rem" style={{ overflow: "hidden" }}>
            <NodeForm
              document={document}
              row={selectedRow}
              index={index}
              markedUids={markedUids}
              onField={onField}
              onRelations={onRelations}
            />
          </Panel>
        </Group>
        </div>
      </div>
    </div>
  );
}

function NodeForm({
  document,
  row,
  index,
  markedUids,
  onField,
  onRelations,
}: {
  document: SDocDocument;
  row: ReturnType<typeof flatten>[number] | undefined;
  index: IndexNode[];
  markedUids?: ReadonlyMap<string, string>;
  onField: (path: number[], name: string, value: string) => void;
  onRelations: (path: number[], relations: Relation[]) => void;
}) {
  if (!row) {
    return <p className="px-4 py-8 text-sm text-muted">Select a node to edit its fields.</p>;
  }
  const element = grammarOf(document, row.node.tag);
  const fields = fieldsOf(element);
  const links = elementLinks(document.grammar.elements, row.node.tag);
  const uid = fieldOf(row.node, "UID");
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <p className="font-mono text-xs tracking-wide text-muted">{row.node.tag}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {fields.map((field) => (
          <div key={field.title} className={isProse(field) ? "lg:col-span-2" : undefined}>
            <FieldControl
              field={field}
              node={row.node}
              path={row.path}
              marked={field.title === "UID" ? markedUids?.get(uid) : undefined}
              onField={onField}
            />
          </div>
        ))}
      </div>
      {links.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">Relations</p>
          <RelationTags
            relations={row.node.relations}
            index={index}
            selfUid={uid}
            links={links}
            onChange={(relations) => onRelations(row.path, relations)}
          />
        </div>
      ) : null}
    </div>
  );
}
