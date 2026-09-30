import { Plus, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { elementRoles } from "@/lib/sdoc/grammar";
import { fieldOf, flatten } from "@/lib/sdoc/model";
import type { Relation, SDocDocument, SDocNode } from "@/lib/sdoc/types";
import { RelationTags } from "@/components/sdoc/RelationTags";

function ChoiceFields({
  node,
  path,
  document,
  onField,
}: {
  node: SDocNode;
  path: number[];
  document: SDocDocument;
  onField: (path: number[], name: string, value: string) => void;
}) {
  const specs =
    document.grammar.elements
      .find((element) => element.tag === node.tag)
      ?.fields.filter((field) => field.type === "SingleChoice" && (field.options?.length ?? 0) > 0) ?? [];
  if (specs.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {specs.map((spec) => (
        <label key={spec.title} className="text-[10px] text-muted">
          {spec.title}
          <select
            value={fieldOf(node, spec.title)}
            aria-label={spec.title}
            onChange={(event) => onField(path, spec.title, event.target.value)}
            className="ml-1 min-h-8 rounded-md border border-line bg-bg px-1 font-mono text-xs text-fg"
          >
            <option value="">—</option>
            {(spec.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

const INDENT = ["pl-2", "pl-6", "pl-10", "pl-14"] as const;

function visibleInput(row: number, col: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-cell="${row}:${col}"]`);
  for (const node of nodes) {
    if (node.offsetParent !== null) return node;
  }
  return null;
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
  onInsert: (kind: "REQUIREMENT" | "SECTION", where: "inside" | "after") => void;
  onDelete: () => void;
  markedUids?: ReadonlyMap<string, string>;
}) {
  const rows = flatten(document.nodes);
  const selectedRow = rows.find((row) => fieldOf(row.node, "UID") === selected);
  const intoSection = selectedRow?.node.tag === "SECTION" && selectedRow.node.composite;
  const [statementKey, setStatementKey] = useState("");

  function allowsStatement(tag: string): boolean {
    const element = document.grammar.elements.find((item) => item.tag === tag);
    if (!element) return tag === "REQUIREMENT" || tag === "TEXT";
    return element.fields.some((field) => field.title === "STATEMENT");
  }

  function enterNext(event: KeyboardEvent<HTMLElement>, row: number, col: string) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    visibleInput(row + 1, col)?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs text-muted">
          <span className="font-mono text-accent">{rows.length}</span> nodes
          {intoSection ? " · new nodes go inside the section" : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={!selected}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line px-2 text-xs text-muted disabled:opacity-40"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </button>
          {intoSection ? (
            <button
              type="button"
              onClick={() => onInsert("SECTION", "after")}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-2 text-xs text-muted"
            >
              After
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onInsert("SECTION", intoSection ? "inside" : "after")}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line px-2 text-xs text-fg"
          >
            <Plus className="size-4" aria-hidden="true" />
            Section
          </button>
          <button
            type="button"
            onClick={() => onInsert("REQUIREMENT", intoSection ? "inside" : "after")}
            className="inline-flex min-h-11 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg"
          >
            <Plus className="size-4" aria-hidden="true" />
            Requirement
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="hidden w-full table-fixed border-collapse text-left text-xs lg:table">
          <thead className="sticky top-0 z-10 bg-surface text-muted">
            <tr className="border-b border-line">
              <th className="w-1/6 px-2 py-2 font-medium">UID</th>
              <th className="w-1/5 px-2 py-2 font-medium">Title</th>
              <th className="w-24 px-2 py-2 font-medium">Tag</th>
              <th className="px-2 py-2 font-medium">Statement</th>
              <th className="w-1/4 px-2 py-2 font-medium">Relations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, indexOnPage) => {
              const uid = fieldOf(row.node, "UID");
              const key = row.path.join(".");
              const active = uid !== "" && uid === selected;
              return (
                <tr
                  key={key}
                  data-uid={uid || undefined}
                  onClick={() => onSelect(uid)}
                  className={"border-b border-line align-top " + (active ? "bg-surface-2" : "bg-bg")}
                >
                  <td className="px-2 py-1">
                    <input
                      data-cell={`${indexOnPage}:uid`}
                      value={uid}
                      aria-label="UID"
                      onChange={(event) => onField(row.path, "UID", event.target.value.replace(/\s+/g, ""))}
                      onKeyDown={(event) => enterNext(event, indexOnPage, "uid")}
                      onFocus={() => onSelect(uid)}
                      title={markedUids?.get(uid) ? `Prefix should be ${markedUids.get(uid)}` : undefined}
                      className={
                        "w-full bg-transparent font-mono text-xs " + (markedUids?.has(uid) ? "text-accent" : "text-fg")
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      data-cell={`${indexOnPage}:title`}
                      value={fieldOf(row.node, "TITLE")}
                      aria-label="Title"
                      onChange={(event) => onField(row.path, "TITLE", event.target.value)}
                      onKeyDown={(event) => enterNext(event, indexOnPage, "title")}
                      onFocus={() => onSelect(uid)}
                      className={
                        "w-full bg-transparent text-xs text-fg " +
                        INDENT[Math.min(row.depth, 3)] +
                        (row.node.tag === "SECTION" ? " font-medium" : "")
                      }
                    />
                    <ChoiceFields node={row.node} path={row.path} document={document} onField={onField} />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs tracking-wide text-muted">{row.node.tag}</td>
                  <td className="px-2 py-1">
                    {allowsStatement(row.node.tag) ? (
                      <textarea
                        data-cell={`${indexOnPage}:statement`}
                        value={fieldOf(row.node, "STATEMENT")}
                        aria-label="Statement"
                        rows={statementKey === key ? 4 : 1}
                        onFocus={() => {
                          setStatementKey(key);
                          onSelect(uid);
                        }}
                        onBlur={() => setStatementKey((current) => (current === key ? "" : current))}
                        onChange={(event) => onField(row.path, "STATEMENT", event.target.value)}
                        className="w-full resize-none bg-transparent text-xs leading-relaxed text-fg"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                    {row.node.tag === "REQUIREMENT" ? (
                      <RelationTags
                        relations={row.node.relations}
                        index={index}
                        selfUid={uid}
                        roles={elementRoles(document.grammar.elements, row.node.tag)}
                        onChange={(relations) => onRelations(row.path, relations)}
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ul className="flex flex-col gap-2 p-3 lg:hidden">
          {rows.map((row, indexOnPage) => {
            const uid = fieldOf(row.node, "UID");
            const key = row.path.join(".");
            const active = uid !== "" && uid === selected;
            return (
              <li
                key={key}
                data-uid={uid || undefined}
                className={"rounded-md border border-line p-3 " + (active ? "bg-surface-2" : "bg-surface")}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted">{row.node.tag}</span>
                  <button type="button" className="text-xs text-accent" onClick={() => onSelect(uid)}>
                    Trace
                  </button>
                </div>
                <label className="block text-xs text-muted">
                  UID
                  <input
                    data-cell={`${indexOnPage}:uid`}
                    value={uid}
                    onChange={(event) => onField(row.path, "UID", event.target.value.replace(/\s+/g, ""))}
                    title={markedUids?.get(uid) ? `Prefix should be ${markedUids.get(uid)}` : undefined}
                    className={
                      "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm " +
                      (markedUids?.has(uid) ? "text-accent" : "text-fg")
                    }
                  />
                </label>
                <label className="mt-2 block text-xs text-muted">
                  Title
                  <input
                    data-cell={`${indexOnPage}:title`}
                    value={fieldOf(row.node, "TITLE")}
                    onChange={(event) => onField(row.path, "TITLE", event.target.value)}
                    className={
                      "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg " +
                      (row.node.tag === "SECTION" ? "font-medium" : "")
                    }
                  />
                  <ChoiceFields node={row.node} path={row.path} document={document} onField={onField} />
                </label>
                {allowsStatement(row.node.tag) ? (
                  <label className="mt-2 block text-xs text-muted">
                    Statement
                    <textarea
                      value={fieldOf(row.node, "STATEMENT")}
                      rows={4}
                      onChange={(event) => onField(row.path, "STATEMENT", event.target.value)}
                      className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-2 text-sm leading-relaxed text-fg"
                    />
                  </label>
                ) : null}
                {row.node.tag === "REQUIREMENT" ? (
                  <div className="mt-2">
                    <RelationTags
                      relations={row.node.relations}
                      index={index}
                      selfUid={uid}
                      roles={elementRoles(document.grammar.elements, row.node.tag)}
                      onChange={(relations) => onRelations(row.path, relations)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-sm text-muted">No nodes yet. Add a section or a requirement.</p>
        ) : null}
      </div>
    </div>
  );
}
