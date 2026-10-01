import { Plus, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { elementLinks, fallbackTag, tagLabel } from "@/lib/sdoc/grammar";
import { fieldOf, flatten, selectionKey } from "@/lib/sdoc/model";
import type { GrammarElement, GrammarField, Relation, SDocDocument, SDocNode } from "@/lib/sdoc/types";
import { RelationTags } from "@/components/sdoc/RelationTags";

function grammarOf(document: SDocDocument, tag: string): GrammarElement | undefined {
  return document.grammar.elements.find((element) => element.tag === tag);
}

function declares(element: GrammarElement | undefined, name: string): boolean {
  if (!element) return name === "UID" || name === "TITLE" || name === "STATEMENT";
  return element.fields.some((field) => field.title === name);
}

function spareFields(element: GrammarElement | undefined): GrammarField[] {
  if (!element) return [];
  return element.fields.filter(
    (field) =>
      field.title !== "UID" &&
      field.title !== "TITLE" &&
      field.title !== "STATEMENT" &&
      field.type !== "SingleChoice" &&
      field.type !== "Choice",
  );
}
function choiceFields(document: SDocDocument, tag: string) {
  return (
    document.grammar.elements
      .find((element) => element.tag === tag)
      ?.fields.filter((field) => field.type === "SingleChoice" && (field.options?.length ?? 0) > 0) ?? []
  );
}

function SpareFields({
  node,
  path,
  fields,
  onField,
}: {
  node: SDocNode;
  path: number[];
  fields: GrammarField[];
  onField: (path: number[], name: string, value: string) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {fields.map((field) => {
        const value = fieldOf(node, field.title);
        const prose = field.type === "MultiLineString" || field.title === "DESCRIPTION" || field.title === "RATIONALE" || field.title === "COMMENT";
        return (
          <label key={field.title} className="block text-[10px] uppercase tracking-wide text-muted">
            {field.title}
            {field.type === "Boolean" ? (
              <select
                aria-label={field.title}
                value={value === "True" || value === "False" ? value : ""}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onField(path, field.title, event.target.value)}
                className="mt-0.5 min-h-8 w-full rounded-md border border-line bg-bg px-2 text-xs normal-case tracking-normal text-fg"
              >
                <option value="">—</option>
                <option value="True">True</option>
                <option value="False">False</option>
              </select>
            ) : prose ? (
              <textarea
                aria-label={field.title}
                value={value}
                rows={2}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onField(path, field.title, event.target.value)}
                className="mt-0.5 w-full resize-none rounded-md border border-line bg-bg px-2 py-1 text-xs normal-case tracking-normal text-fg"
              />
            ) : (
              <input
                aria-label={field.title}
                value={value}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onField(path, field.title, event.target.value)}
                className="mt-0.5 min-h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-xs normal-case tracking-normal text-fg"
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function SpareSummary({ node, fields }: { node: SDocNode; fields: GrammarField[] }) {
  const bits = fields
    .map((field) => {
      const value = fieldOf(node, field.title).replace(/\s+/g, " ").trim();
      return value ? `${field.title} ${value}` : "";
    })
    .filter((bit) => bit.length > 0);
  if (bits.length === 0) return null;
  return <p className="truncate text-[10px] text-muted">{bits.join(" · ")}</p>;
}

function choiceColumns(document: SDocDocument) {
  const seen = new Map<string, string[]>();
  for (const element of document.grammar.elements) {
    for (const field of element.fields) {
      if (field.type === "SingleChoice" && field.options?.length && !seen.has(field.title)) {
        seen.set(field.title, field.options);
      }
    }
  }
  return [...seen.entries()].map(([title, options]) => ({ title, options }));
}

function ChoiceSelect({
  node,
  path,
  title,
  options,
  onField,
}: {
  node: SDocNode;
  path: number[];
  title: string;
  options: string[];
  onField: (path: number[], name: string, value: string) => void;
}) {
  const value = fieldOf(node, title);
  return (
    <select
      value={options.includes(value) ? value : ""}
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onField(path, title, event.target.value)}
      className="min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg"
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
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
  onInsert: (tag: string, where: "inside" | "after") => void;
  onDelete: () => void;
  markedUids?: ReadonlyMap<string, string>;
}) {
  const rows = flatten(document.nodes);
  const choices = choiceColumns(document);
  const elements = document.grammar.elements;
  const tags = elements.map((element) => element.tag);
  const [picked, setPicked] = useState("");
  const addTag = tags.includes(picked) ? picked : fallbackTag(tags, ["REQUIREMENT", "RELEASE", "SECTION"]);
  const selectedRow = rows.find((row) => selectionKey(row.node, row.path) === selected);
  const intoComposite = Boolean(selectedRow?.node.composite);
  const [statementKey, setStatementKey] = useState("");

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
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="hidden w-full table-fixed border-collapse text-left text-xs lg:table">
          <thead className="sticky top-0 z-10 bg-surface text-muted">
            <tr className="border-b border-line">
              <th className="w-1/6 px-2 py-2 font-medium">UID</th>
              <th className="w-1/5 px-2 py-2 font-medium">Title</th>
              <th className="w-24 px-2 py-2 font-medium">Tag</th>
              {choices.map((spec) => (
                <th key={spec.title} className="w-36 px-2 py-2 font-medium">
                  {spec.title}
                </th>
              ))}
              <th className="px-2 py-2 font-medium">Statement</th>
              <th className="w-1/4 px-2 py-2 font-medium">Relations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, indexOnPage) => {
              const uid = fieldOf(row.node, "UID");
              const key = row.path.join(".");
              const pick = selectionKey(row.node, row.path);
              const active = pick === selected;
              const element = grammarOf(document, row.node.tag);
              const spare = spareFields(element);
              const links = elementLinks(document.grammar.elements, row.node.tag);
              return (
                <tr
                  key={key}
                  data-uid={uid || undefined}
                  onClick={() => onSelect(pick)}
                  className={"border-b border-line align-top " + (active ? "bg-surface-2" : "bg-bg")}
                >
                  <td className="px-2 py-1">
                    {declares(element, "UID") ? (
                      <input
                        data-cell={`${indexOnPage}:uid`}
                        value={uid}
                        aria-label="UID"
                        onChange={(event) => onField(row.path, "UID", event.target.value.replace(/\s+/g, ""))}
                        onKeyDown={(event) => enterNext(event, indexOnPage, "uid")}
                        onFocus={() => onSelect(pick)}
                        title={markedUids?.get(uid) ? `Prefix should be ${markedUids.get(uid)}` : undefined}
                        className={
                          "w-full bg-transparent font-mono text-xs " + (markedUids?.has(uid) ? "text-accent" : "text-fg")
                        }
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {declares(element, "TITLE") ? (
                      <input
                        data-cell={`${indexOnPage}:title`}
                        value={fieldOf(row.node, "TITLE")}
                        aria-label="Title"
                        onChange={(event) => onField(row.path, "TITLE", event.target.value)}
                        onKeyDown={(event) => enterNext(event, indexOnPage, "title")}
                        onFocus={() => onSelect(pick)}
                        className={
                          "w-full bg-transparent text-xs text-fg " +
                          INDENT[Math.min(row.depth, 3)] +
                          (row.node.composite ? " font-medium" : "")
                        }
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs tracking-wide text-muted">{row.node.tag}</td>
                  {choices.map((spec) => {
                    const field = choiceFields(document, row.node.tag).find((item) => item.title === spec.title);
                    return (
                      <td key={spec.title} className="px-2 py-1">
                        {field ? (
                          <ChoiceSelect
                            node={row.node}
                            path={row.path}
                            title={field.title}
                            options={field.options ?? []}
                            onField={onField}
                          />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1">
                    {declares(element, "STATEMENT") ? (
                      <textarea
                        data-cell={`${indexOnPage}:statement`}
                        value={fieldOf(row.node, "STATEMENT")}
                        aria-label="Statement"
                        rows={statementKey === key ? 4 : 1}
                        onFocus={() => {
                          setStatementKey(key);
                          onSelect(pick);
                        }}
                        onBlur={() => setStatementKey((current) => (current === key ? "" : current))}
                        onChange={(event) => onField(row.path, "STATEMENT", event.target.value)}
                        className="w-full resize-none bg-transparent text-xs leading-relaxed text-fg"
                      />
                    ) : null}
                    {active ? (
                      <SpareFields node={row.node} path={row.path} fields={spare} onField={onField} />
                    ) : (
                      <SpareSummary node={row.node} fields={spare} />
                    )}
                    {!declares(element, "STATEMENT") && spare.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                    {links.length > 0 ? (
                      <RelationTags
                        relations={row.node.relations}
                        index={index}
                        selfUid={uid}
                        links={links}
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
            const element = grammarOf(document, row.node.tag);
            const spare = spareFields(element);
            const links = elementLinks(document.grammar.elements, row.node.tag);
            const pick = selectionKey(row.node, row.path);
            const active = pick === selected;
            return (
              <li
                key={row.path.join(".")}
                data-uid={uid || undefined}
                onClick={() => onSelect(pick)}
                className={"rounded-md border border-line p-3 " + (active ? "bg-surface-2" : "bg-surface")}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted">{row.node.tag}</span>
                  <button type="button" className="text-xs text-accent" onClick={() => uid && onSelect(uid)}>
                    Trace
                  </button>
                </div>
                {declares(element, "UID") ? (
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
                ) : null}
                {declares(element, "TITLE") ? (
                  <label className="mt-2 block text-xs text-muted">
                    Title
                    <input
                      data-cell={`${indexOnPage}:title`}
                      value={fieldOf(row.node, "TITLE")}
                      onChange={(event) => onField(row.path, "TITLE", event.target.value)}
                      className={
                        "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg " +
                        (row.node.composite ? "font-medium" : "")
                      }
                    />
                  </label>
                ) : null}
                {choiceFields(document, row.node.tag).map((field) => (
                  <label key={field.title} className="mt-2 block text-xs text-muted">
                    {field.title}
                    <div className="mt-1">
                      <ChoiceSelect
                        node={row.node}
                        path={row.path}
                        title={field.title}
                        options={field.options ?? []}
                        onField={onField}
                      />
                    </div>
                  </label>
                ))}
                {declares(element, "STATEMENT") ? (
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
                <SpareFields node={row.node} path={row.path} fields={spare} onField={onField} />
                {links.length > 0 ? (
                  <div className="mt-2">
                    <RelationTags
                      relations={row.node.relations}
                      index={index}
                      selfUid={uid}
                      links={links}
                      onChange={(relations) => onRelations(row.path, relations)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-sm text-muted">No nodes yet. Add an element from the grammar.</p>
        ) : null}
      </div>
    </div>
  );
}
