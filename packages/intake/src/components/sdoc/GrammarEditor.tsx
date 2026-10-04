import { useState } from "react";
import type { FieldType, Grammar, GrammarElement, GrammarField, GrammarRelation, RelationType } from "@/lib/sdoc/types";

const FIELD_TYPES: FieldType[] = [
  "String",
  "SingleLineString",
  "MultiLineString",
  "Integer",
  "Boolean",
  "SingleChoice",
];
const RELATION_TYPES: RelationType[] = ["Parent", "Child", "File"];
const TAG = /^[A-Z][A-Z0-9_]*$/;

function updateElement(grammar: Grammar, index: number, element: GrammarElement): Grammar {
  const elements = grammar.elements.map((item, at) => (at === index ? element : item));
  return { ...grammar, elements };
}

export function GrammarEditor({
  grammar,
  onChange,
  onOpenImport,
  onMoveToFile,
  aliases = {},
}: {
  grammar: Grammar;
  onChange: (grammar: Grammar) => void;
  onOpenImport?: (spec: string) => void;
  onMoveToFile?: (path: string) => Promise<void>;
  aliases?: Readonly<Record<string, string>>;
}) {
  const [movePath, setMovePath] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");

  if (grammar.importFrom) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="text-sm text-fg">This document uses a grammar file.</p>
        <p className="mt-1 text-xs text-muted">Edits belong in that file. Clear the path to copy the grammar into this document.</p>
        <label className="mt-3 block text-xs text-muted">
          Grammar import
          <input
            value={grammar.importFrom}
            list="grammar-aliases"
            onChange={(event) => {
              const spec = event.target.value.trim();
              onChange({ ...grammar, explicit: true, importFrom: spec || undefined });
            }}
            placeholder="@name"
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
          />
        </label>
        <AliasList aliases={aliases} />
        <p className="mt-1 text-xs text-muted">
          {grammar.importFrom.startsWith("@")
            ? "Resolved from strictdoc_config.py. A relative path still works in this editor."
            : "StrictDoc wants an @alias. Moving a grammar file registers one in strictdoc_config.py."}
        </p>
        {onOpenImport && grammar.importFrom ? (
          <button
            type="button"
            onClick={() => onOpenImport(grammar.importFrom!)}
            className="mt-2 min-h-11 rounded-md border border-line px-3 text-xs text-fg"
          >
            Open grammar file
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Grammar stored in this file.</p>
        {onMoveToFile ? (
          <button
            type="button"
            onClick={() => {
              setMoving((open) => !open);
              setMoveError("");
            }}
            className="min-h-9 rounded-md border border-line px-2 text-xs text-fg"
          >
            Move grammar to file
          </button>
        ) : null}
      </div>
      {moving && onMoveToFile ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const path = movePath.trim();
            if (!path.endsWith(".sgra") || path.includes("..")) {
              setMoveError("Use a project path that ends in .sgra.");
              return;
            }
            setMoveError("");
            void onMoveToFile(path).catch((err: unknown) => {
              setMoveError(err instanceof Error ? err.message : "Could not move the grammar.");
            });
          }}
        >
          <label className="min-w-0 flex-1 text-xs text-muted">
            New grammar path
            <input
              value={movePath}
              onChange={(event) => setMovePath(event.target.value)}
              placeholder="grammar/name.sgra"
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
            />
          </label>
          <button type="submit" className="min-h-11 rounded-md bg-accent px-3 text-xs text-accent-fg">
            Move
          </button>
        </form>
      ) : null}
      {moving ? (
        <p className="mt-1 text-xs text-muted">The document will import @name, and that alias is written into strictdoc_config.py.</p>
      ) : null}
      {moveError ? <p className="mt-1 text-xs text-danger">{moveError}</p> : null}
      <ul className="mt-3 flex flex-col gap-3">
        {grammar.elements.map((element, index) => (
          <li key={index} className="rounded-md border border-line p-2">
            <div className="flex items-center gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted">
                Element
                <input
                  value={element.tag}
                  onChange={(event) => {
                    const tag = event.target.value.toUpperCase();
                    if (tag && !TAG.test(tag)) return;
                    onChange(
                      updateElement(grammar, index, {
                        ...element,
                        tag,
                        composite: tag === "SECTION" ? (element.composite ?? true) : element.composite,
                      }),
                    );
                  }}
                  className="mt-1 min-h-11 w-full bg-transparent font-mono text-sm text-fg"
                />
              </label>
              <label className="flex min-h-11 items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={element.composite === true || (element.composite === undefined && element.tag === "SECTION")}
                  onChange={(event) =>
                    onChange(updateElement(grammar, index, { ...element, composite: event.target.checked }))
                  }
                />
                Composite
              </label>
              <button
                type="button"
                onClick={() => onChange({ ...grammar, elements: grammar.elements.filter((_, at) => at !== index) })}
                className="min-h-9 text-xs text-muted"
              >
                Remove
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">Fields</p>
            <ul className="mt-1 flex flex-col gap-2">
              {element.fields.map((field, fieldIndex) => (
                <FieldRow
                  key={fieldIndex}
                  field={field}
                  onChange={(next) => {
                    const fields = element.fields.map((item, at) => (at === fieldIndex ? next : item));
                    onChange(updateElement(grammar, index, { ...element, fields }));
                  }}
                  onRemove={() => {
                    const fields = element.fields.filter((_, at) => at !== fieldIndex);
                    onChange(updateElement(grammar, index, { ...element, fields }));
                  }}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                const fields = [...element.fields, { title: "FIELD", type: "String" as const, required: false }];
                onChange(updateElement(grammar, index, { ...element, fields }));
              }}
              className="mt-1 min-h-9 text-xs text-accent"
            >
              Add field
            </button>
            <p className="mt-2 text-xs text-muted">Relations</p>
            <ul className="mt-1 flex flex-col gap-2">
              {element.relations.map((relation, relationIndex) => (
                <li key={relationIndex} className="flex flex-wrap items-center gap-2">
                  <select
                    value={relation.type}
                    onChange={(event) => {
                      const relations = element.relations.map((item, at) =>
                        at === relationIndex ? { ...item, type: event.target.value as RelationType } : item,
                      );
                      onChange(updateElement(grammar, index, { ...element, relations }));
                    }}
                    className="min-h-11 rounded-md border border-line bg-bg px-2 text-xs text-fg"
                  >
                    {RELATION_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <input
                    value={relation.role ?? ""}
                    placeholder="Role"
                    onChange={(event) => {
                      const role = event.target.value.trim();
                      const relations = element.relations.map((item, at) =>
                        at === relationIndex ? { ...item, role: role || undefined } : item,
                      );
                      onChange(updateElement(grammar, index, { ...element, relations }));
                    }}
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-xs text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const relations = element.relations.filter((_, at) => at !== relationIndex);
                      onChange(updateElement(grammar, index, { ...element, relations }));
                    }}
                    className="min-h-9 text-xs text-muted"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                const relations: GrammarRelation[] = [...element.relations, { type: "Parent" }];
                onChange(updateElement(grammar, index, { ...element, relations }));
              }}
              className="mt-1 min-h-9 text-xs text-accent"
            >
              Add relation
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const tag = String(data.get("tag") ?? "").trim().toUpperCase();
          if (!TAG.test(tag)) return;
          onChange({
            ...grammar,
            explicit: true,
            elements: [
              ...grammar.elements,
              {
                tag,
                composite: tag === "SECTION" ? true : undefined,
                fields: [{ title: "TITLE", type: "String", required: false }],
                relations: [],
              },
            ],
          });
          event.currentTarget.reset();
        }}
      >
        <label className="text-xs text-muted">
          New element
          <input
            name="tag"
            placeholder="RELEASE"
            className="mt-1 min-h-11 w-36 rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
          />
        </label>
        <button type="submit" className="min-h-11 rounded-md border border-line px-3 text-xs text-fg">
          Add
        </button>
      </form>
    </div>
  );
}

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: GrammarField;
  onChange: (field: GrammarField) => void;
  onRemove: () => void;
}) {
  return (
    <li className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]">
      <input
        value={field.title}
        aria-label="Field name"
        onChange={(event) => onChange({ ...field, title: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
        className="min-h-11 rounded-md border border-line bg-bg px-2 font-mono text-xs text-fg"
      />
      <select
        value={field.type}
        aria-label={`${field.title} type`}
        onChange={(event) => {
          const type = event.target.value as FieldType;
          onChange({
            ...field,
            type,
            options: type === "SingleChoice" ? field.options ?? ["Draft"] : undefined,
          });
        }}
        className="min-h-11 rounded-md border border-line bg-bg px-2 text-xs text-fg"
      >
        {FIELD_TYPES.map((type) => (
          <option key={type}>{type}</option>
        ))}
      </select>
      <label className="flex min-h-11 items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => onChange({ ...field, required: event.target.checked })}
        />
        Required
      </label>
      <button type="button" onClick={onRemove} className="min-h-11 text-xs text-muted">
        Remove
      </button>
      {field.type === "SingleChoice" ? (
        <input
          value={(field.options ?? []).join(", ")}
          aria-label={`${field.title} choices`}
          placeholder="planned, shipped"
          onChange={(event) => {
            const options = event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item.length > 0);
            onChange({ ...field, options });
          }}
          className="min-h-11 rounded-md border border-line bg-bg px-2 font-mono text-xs text-fg sm:col-span-4"
        />
      ) : null}
    </li>
  );
}

function AliasList({ aliases }: { aliases: Readonly<Record<string, string>> }) {
  const names = Object.keys(aliases);
  if (names.length === 0) return null;
  return (
    <datalist id="grammar-aliases">
      {names.map((alias) => (
        <option key={alias} value={alias}>
          {aliases[alias]}
        </option>
      ))}
    </datalist>
  );
}
