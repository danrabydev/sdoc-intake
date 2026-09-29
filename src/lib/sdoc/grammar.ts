import type { Grammar, GrammarElement, SDocDocument } from "./types.ts";

export const ORG_ROLES = ["Refines", "Satisfies", "Uses", "ConformsTo"] as const;

export function defaultElements(): GrammarElement[] {
  return [
    {
      tag: "TEXT",
      fields: [{ title: "STATEMENT", type: "String", required: true }],
      relations: [],
    },
    {
      tag: "SECTION",
      fields: [
        { title: "UID", type: "String", required: false },
        { title: "TITLE", type: "String", required: true },
      ],
      relations: [],
    },
    requirementElement(),
  ];
}

export function requirementElement(): GrammarElement {
  return {
    tag: "REQUIREMENT",
    fields: [
      { title: "UID", type: "String", required: false },
      { title: "TITLE", type: "String", required: false },
      { title: "STATEMENT", type: "String", required: false },
      { title: "RATIONALE", type: "String", required: false },
      { title: "COMMENT", type: "String", required: false },
      { title: "STATUS", type: "String", required: false },
    ],
    relations: orgRelations(),
  };
}

function orgRelations(): GrammarElement["relations"] {
  const relations: GrammarElement["relations"] = [
    { type: "Parent" },
    { type: "Child" },
    { type: "File" },
  ];
  for (const role of ORG_ROLES) relations.push({ type: "Parent", role });
  return relations;
}

export function defaultGrammar(): Grammar {
  return { explicit: false, elements: defaultElements() };
}

/** Register this org's Parent roles. Does not mutate the input. */
export function ensureOrgGrammar(doc: SDocDocument): SDocDocument {
  const next = structuredClone(doc);
  const grammar: Grammar = next.grammar.explicit
    ? next.grammar
    : { explicit: true, elements: defaultElements() };
  grammar.explicit = true;
  let requirement = grammar.elements.find((element) => element.tag === "REQUIREMENT");
  if (!requirement) {
    requirement = requirementElement();
    grammar.elements.push(requirement);
  }
  for (const relation of orgRelations()) {
    const exists = requirement.relations.some(
      (item) => item.type === relation.type && (item.role ?? "") === (relation.role ?? ""),
    );
    if (!exists) requirement.relations.push({ ...relation });
  }
  if (!grammar.elements.some((element) => element.tag === "TEXT")) {
    grammar.elements.unshift(defaultElements()[0]!);
  }
  if (!grammar.elements.some((element) => element.tag === "SECTION")) {
    grammar.elements.splice(1, 0, defaultElements()[1]!);
  }
  next.grammar = grammar;
  return next;
}
