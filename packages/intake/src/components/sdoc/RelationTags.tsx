import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { IndexNode } from "@/lib/sdoc/api-types";
import { ORG_ROLES } from "@/lib/sdoc/grammar";
import type { Relation, RelationType } from "@/lib/sdoc/types";

export function RelationTags({
  relations,
  index,
  selfUid,
  roles,
  links,
  onChange,
}: {
  relations: Relation[];
  index: IndexNode[];
  selfUid: string;
  roles?: readonly string[];
  links?: readonly { type: RelationType; role?: string }[];
  onChange: (relations: Relation[]) => void;
}) {
  const specs =
    links && links.length > 0
      ? links
      : (roles && roles.length > 0 ? roles : ORG_ROLES).map((role) => ({ type: "Parent" as const, role }));
  const keyOf = (spec: { type: RelationType; role?: string }) => `${spec.type}:${spec.role ?? ""}`;
  const labelOf = (spec: { type: RelationType; role?: string }) =>
    spec.role ? (spec.type === "Parent" ? spec.role : `${spec.type} ${spec.role}`) : spec.type;
  const [picked, setPicked] = useState(keyOf(specs[0] ?? { type: "Parent", role: "Refines" }));
  const spec = specs.find((item) => keyOf(item) === picked) ?? specs[0];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const titles = useMemo(() => new Map(index.map((node) => [node.uid, node.title])), [index]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return index
      .filter((node) => node.tag !== "DOCUMENT" && node.uid !== selfUid)
      .filter((node) => {
        if (!needle) return true;
        return node.uid.toLowerCase().includes(needle) || node.title.toLowerCase().includes(needle);
      })
      .slice(0, 8);
  }, [index, query, selfUid]);

  function add(uid: string) {
    const next = spec ?? { type: "Parent" as const, role: "Refines" };
    if (
      relations.some(
        (relation) =>
          relation.type === next.type && relation.value === uid && (relation.role ?? "") === (next.role ?? ""),
      )
    ) {
      setOpen(false);
      setQuery("");
      return;
    }
    onChange([...relations, { type: next.type, role: next.role, value: uid, line: 1 }]);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {relations.map((relation, indexOnNode) => {
          const label = `${relation.role ?? relation.type}:${relation.value}`;
          const title = titles.get(relation.value);
          return (
            <span
              key={`${label}:${indexOnNode}`}
              title={title ? `${label} — ${title}` : label}
              className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line bg-bg px-2 font-mono text-xs text-fg"
            >
              {label}
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => onChange(relations.filter((_, item) => item !== indexOnNode))}
                className="inline-flex size-11 items-center justify-center rounded-full text-muted lg:size-6"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {adding ? (
          <>
            <label className="sr-only" htmlFor={`role-${selfUid || "row"}`}>
              Relation role
            </label>
            <select
              id={`role-${selfUid || "row"}`}
              value={specs.some((item) => keyOf(item) === picked) ? picked : keyOf(specs[0] ?? { type: "Parent" })}
              onChange={(event) => setPicked(event.target.value)}
              className="min-h-11 rounded-md border border-line bg-bg px-1 font-mono text-xs text-fg lg:min-h-8"
            >
              {specs.map((item) => (
                <option key={keyOf(item)} value={keyOf(item)}>
                  {labelOf(item)}
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1">
              <input
                value={query}
                placeholder="UID or title"
                aria-label="Link a requirement"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches[0]) {
                    event.preventDefault();
                    add(matches[0].uid);
                    setAdding(false);
                  }
                  if (event.key === "Escape") {
                    setOpen(false);
                    setAdding(false);
                  }
                }}
                className="min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-xs text-fg lg:min-h-8"
              />
              {open && matches.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
                  {matches.map((node) => (
                    <li key={`${node.file}:${node.uid}`}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          add(node.uid);
                          setAdding(false);
                        }}
                        className="flex min-h-11 w-full flex-col items-start px-2 py-1 text-left hover:bg-surface-2"
                      >
                        <span className="font-mono text-xs text-accent">{node.uid}</span>
                        <span className="truncate text-xs text-muted">{node.title || node.tag}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-11 rounded-md px-1 text-xs text-accent lg:min-h-8"
          >
            Link
          </button>
        )}
      </div>
    </div>
  );
}
