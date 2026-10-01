import { useEffect, useMemo, useRef, useState } from "react";
import type { FileResponse, GrammarResponse, IndexNode, TreeFile } from "@/lib/sdoc/api-types";
import { openBrowserFolder, restoreBrowserFolder, subscribeBrowser } from "@/lib/sdoc/browser-fs";
import { ApiError, createDir, createDoc, createGrammar, deleteDoc, getFile, getGrammar, getIndex, getTree, probeServer, putFile, putGrammar } from "@/lib/sdoc/client";
import { explicitMode, FS_MODE_KEY, setActiveMode, type FsMode } from "@/lib/sdoc/fs-mode";
import { resolveGrammarPath, defaultElements } from "@/lib/sdoc/grammar";
import { buildGraph } from "@/lib/sdoc/graph";
import { applyUidRenames, collectUids, flatten, grammarNode, indexDocument, insertRelative, joinPrefix, mapAt, nextUid, nodePrefixChain, nodeUid, prefixExpectations, prefixRenames, removeAt, removeUid, resolveSelection, sectionUidPrefix, selectionKey, usesLegacySections, withField, withRelations } from "@/lib/sdoc/model";
import { parse, parseGrammarFile } from "@/lib/sdoc/parse";
import { detachGrammar, serializeGrammarFile, textForWrite } from "@/lib/sdoc/serialize";
import type { Grammar, Relation, SDocDocument, SDocIssue, SDocNode } from "@/lib/sdoc/types";
import { validate } from "@/lib/sdoc/validate";
import { DropdownMenuItem, EditorChromePortal } from "@/components/editor";
import { FlowMap } from "@/components/sdoc/FlowMap";
import { GrammarEditor } from "@/components/sdoc/GrammarEditor";
import { Graph } from "@/components/sdoc/Graph";
import { IntakeShell } from "@/components/sdoc/IntakeShell";
import { IntakeTable, NodeForm } from "@/components/sdoc/IntakeTable";
import { Outline } from "@/components/sdoc/Outline";
import { Tree } from "@/components/sdoc/Tree";
import { ValidationBar } from "@/components/sdoc/ValidationBar";

interface Editor {
  path: string;
  text: string;
  document: SDocDocument | null;
  grammar: Grammar | null;
  parseFailed: boolean;
  siblingUids: string[];
  siblingEdges: { from: string; to: string }[];
  dirty: boolean;
  external: boolean;
  kind: "sdoc" | "sgra";
}

function stripParents(nodes: SDocNode[], uid: string): SDocNode[] {
  return nodes.map((node) => ({
    ...node,
    relations: node.relations.filter((relation) => !(relation.type === "Parent" && relation.value === uid)),
    children: stripParents(node.children, uid),
  }));
}

function uidsUnder(node: SDocNode): string[] {
  const own = nodeUid(node);
  return [...(own ? [own] : []), ...node.children.flatMap(uidsUnder)];
}

function liveIndex(index: IndexNode[], editor: Editor | null): IndexNode[] {
  if (!editor?.document || editor.parseFailed) return index;
  const others = index.filter((node) => node.file !== editor.path);
  return [...others, ...indexDocument(editor.path, editor.document)];
}

function editorFromView(
  view: Awaited<ReturnType<typeof getFile>>,
  dirty = false,
): Editor {
  return {
    path: view.path,
    text: view.text,
    document: view.document,
    grammar: view.document?.grammar ?? null,
    parseFailed: view.parseFailed,
    siblingUids: view.siblingUids,
    siblingEdges: view.siblingEdges,
    dirty,
    external: false,
    kind: "sdoc",
  };
}

function editorFromGrammar(view: GrammarResponse, dirty = false): Editor {
  const failed = !view.grammar || view.errors.some((issue) => issue.severity === "error");
  return {
    path: view.path,
    text: view.text,
    document: null,
    grammar: view.grammar,
    parseFailed: failed,
    siblingUids: [],
    siblingEdges: [],
    dirty,
    external: false,
    kind: "sgra",
  };
}

function firstRequirement(document: SDocDocument | null): string {
  if (!document) return "";
  for (const row of flatten(document.nodes)) {
    if (row.node.tag !== "REQUIREMENT") continue;
    const id = nodeUid(row.node);
    if (id) return id;
  }
  return "";
}

export function IntakeApp({
  initial,
  file,
  uid,
  onSelect,
}: {
  initial: { root: string; files: TreeFile[]; dirs?: string[]; nodes: IndexNode[]; file: FileResponse | null };
  file: string;
  uid: string;
  onSelect: (file: string, uid: string) => void;
}) {
  const [files, setFiles] = useState<TreeFile[]>(initial.files);
  const [dirs, setDirs] = useState<string[]>(initial.dirs ?? []);
  const [root, setRoot] = useState(initial.root);
  const [index, setIndex] = useState<IndexNode[]>(initial.nodes);
  const [editor, setEditor] = useState<Editor | null>(initial.file ? editorFromView(initial.file) : null);
  const [selected, setSelected] = useState(uid || firstRequirement(initial.file?.document ?? null));
  const [strict, setStrict] = useState(false);
  const [center, setCenter] = useState<"table" | "nodes" | "flow" | "grammar" | "text">("table");
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>(() => {
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    return { explorer: !narrow, inspector: !narrow };
  });
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState("problems");
  const [drawer, setDrawer] = useState<"trace" | "outline">("outline");
  const [depth, setDepth] = useState(2);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ path: "", title: "", uid: "", prefix: "", root: false, kind: "sdoc" as "sdoc" | "sgra" });
  const [grammarTexts, setGrammarTexts] = useState<Record<string, string>>({});
  const [draftError, setDraftError] = useState("");
  const [forceNext, setForceNext] = useState(false);
  const [serverIssues, setServerIssues] = useState<SDocIssue[] | null>(null);
  const [fsMode, setFsMode] = useState<FsMode | null>(null);
  const [folderReady, setFolderReady] = useState(false);
  const [boot, setBoot] = useState(0);
  const editorRef = useRef<Editor | null>(null);
  const selectedRef = useRef(selected);
  const grammarTextsRef = useRef<Record<string, string>>({});
  const selfWrite = useRef(false);
  editorRef.current = editor;
  selectedRef.current = selected;
  grammarTextsRef.current = grammarTexts;

  async function refreshLists() {
    const [tree, listed] = await Promise.all([getTree(), getIndex()]);
    setRoot(tree.root);
    setFiles(tree.files);
    setDirs(tree.dirs ?? []);
    setIndex(listed.nodes);
    const texts: Record<string, string> = {};
    await Promise.all(
      tree.files
        .filter((item) => item.kind === "sgra" || item.path.endsWith(".sgra"))
        .map(async (item) => {
          try {
            texts[item.path] = (await getGrammar(item.path)).text;
          } catch {
            /* unread */
          }
        }),
    );
    setGrammarTexts(texts);
    return tree.files;
  }

  async function openPath(path: string, nextUid = "", options?: { discard?: boolean; keepView?: boolean }) {
    const current = editorRef.current;
    if (current?.dirty && current.path !== path && !options?.discard) {
      if (!window.confirm("Discard unsaved edits?")) return;
    }
    if (path.endsWith(".sgra")) {
      const view = await getGrammar(path);
      setEditor(editorFromGrammar(view));
      setSelected("");
      setForceNext(false);
      setServerIssues(null);
      setCenter("grammar");
      setNotice("");
      onSelect(path, "");
      return;
    }
    const view = await getFile(path);
    setEditor(editorFromView(view));
    setSelected(nextUid);
    setForceNext(false);
    setServerIssues(null);
    if (!options?.keepView) setCenter("table");
    setNotice("");
    onSelect(path, nextUid);
  }

  function revealEditor() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setPanelOpen((current) => ({ ...current, explorer: false, inspector: false }));
    }
  }

  useEffect(() => {
    let cancel = false;
    let source: EventSource | null = null;
    let stopWatch: () => void = () => undefined;
    const onDiskChange = () => {
      void refreshLists().catch(() => undefined);
      if (selfWrite.current) return;
      const current = editorRef.current;
      if (!current) return;
      if (current.dirty) {
        setEditor({ ...current, external: true });
        return;
      }
      void (current.kind === "sgra" ? getGrammar(current.path) : getFile(current.path))
        .then((view) => {
          if (editorRef.current?.dirty || editorRef.current?.path !== view.path) return;
          setEditor(current.kind === "sgra" ? editorFromGrammar(view as GrammarResponse) : editorFromView(view as FileResponse));
        })
        .catch(() => undefined);
    };
    void (async () => {
      const chosen =
        explicitMode(window.location.search, window.localStorage.getItem(FS_MODE_KEY)) ??
        ((await probeServer()) ? "server" : "browser");
      if (cancel) return;
      setActiveMode(chosen);
      setFsMode(chosen);
      if (chosen === "browser") {
        const ready = await restoreBrowserFolder();
        if (cancel) return;
        setFolderReady(ready);
        if (!ready) return;
        stopWatch = subscribeBrowser(onDiskChange);
      } else {
        setFolderReady(true);
      }
      if (cancel) {
        stopWatch();
        return;
      }
      try {
        const listed = await refreshLists();
        if (!cancel && !editorRef.current) {
          const path = file || listed[0]?.path || "";
          if (path.endsWith(".sgra")) {
            const view = await getGrammar(path);
            if (!cancel) setEditor(editorFromGrammar(view));
          } else if (path) {
            const view = await getFile(path);
            if (!cancel) {
              setEditor(editorFromView(view));
              if (!selectedRef.current) setSelected(firstRequirement(view.document));
              if (path !== file) onSelect(path, selectedRef.current || firstRequirement(view.document));
            }
          }
        }
      } catch (err) {
        if (!cancel) setLoadError(err instanceof Error ? err.message : "Could not read the tree.");
      }
      if (cancel || chosen !== "server") return;
      source = new EventSource("/api/events");
      source.onmessage = (event) => {
        let data: { type?: string };
        try {
          data = JSON.parse(event.data) as { type?: string };
        } catch {
          return;
        }
        if (data.type === "change") onDiskChange();
      };
    })();
    return () => {
      cancel = true;
      source?.close();
      stopWatch();
    };
    // Mount, and again after the folder flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  const importedGrammar = editor?.kind === "sdoc" ? editor.document?.grammar.importFrom : undefined;
  const importedFrom = editor?.path ?? "";
  useEffect(() => {
    if (!importedFrom || !importedGrammar) return;
    const rel = resolveGrammarPath(importedFrom, importedGrammar);
    if (!rel || grammarTextsRef.current[rel] !== undefined) return;
    let cancel = false;
    void getGrammar(rel)
      .then((view) => {
        if (cancel) return;
        setGrammarTexts((current) => (current[rel] !== undefined ? current : { ...current, [rel]: view.text }));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [importedFrom, importedGrammar]);

  function rememberMode(mode: FsMode) {
    window.localStorage.setItem(FS_MODE_KEY, mode);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function chooseMode(next: FsMode) {
    if (next === "browser") {
      try {
        const opened = await openBrowserFolder();
        if (!opened) return;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not open the folder.");
        return;
      }
    }
    rememberMode(next);
    setActiveMode(next);
    setFsMode(next);
    editorRef.current = null;
    setEditor(null);
    setFiles([]);
    setIndex([]);
    setLoadError("");
    setNotice("");
    setBoot((value) => value + 1);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // save reads latest editor through refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strict, forceNext, saving]);

  function mutate(fn: (document: SDocDocument) => SDocDocument) {
    setServerIssues(null);
    setNotice("");
    setEditor((current) => {
      if (!current?.document || current.parseFailed) return current;
      const document = fn(current.document);
      return { ...current, document, text: textForWrite(document), dirty: true };
    });
  }

  function editSource(text: string) {
    const current = editorRef.current;
    if (!current) return;
    setNotice("");
    if (current.kind === "sgra") {
      const parsed = parseGrammarFile(text);
      const failed = !parsed.grammar || parsed.errors.some((issue) => issue.severity === "error");
      setServerIssues(failed ? parsed.errors : null);
      setEditor({
        ...current,
        text,
        grammar: parsed.grammar ?? current.grammar,
        parseFailed: failed,
        dirty: true,
      });
      return;
    }
    const parsed = parse(text);
    const failed = !parsed.document || parsed.errors.some((issue) => issue.severity === "error");
    setServerIssues(failed ? parsed.errors : null);
    setEditor({
      ...current,
      text,
      parseFailed: failed,
      document: failed ? current.document : parsed.document,
      grammar: parsed.document?.grammar ?? current.grammar,
      dirty: true,
    });
  }

  function selectView(next: "table" | "nodes" | "flow" | "grammar" | "text") {
    if (next === "text") {
      setEditor((current) => {
        if (!current || current.kind === "sgra" || current.parseFailed || !current.document) return current;
        const text = textForWrite(current.document);
        return text === current.text ? current : { ...current, text };
      });
    }
    setCenter(next);
  }

  const catalog = useMemo(() => liveIndex(index, editor), [index, editor]);
  const projectText = (rel: string, current: Editor | null = editor) => {
    if (current?.kind === "sgra" && current.path === rel) return current.text;
    return grammarTexts[rel];
  };
  const checked = useMemo(() => {
    if (!editor) return null;
    if (editor.kind === "sgra") {
      const parsed = parseGrammarFile(editor.text);
      return { ok: !parsed.errors.some((issue) => issue.severity === "error"), errors: parsed.errors, document: null };
    }
    const shared = {
      siblingUids: editor.siblingUids,
      siblingEdges: editor.siblingEdges,
      mode: "write" as const,
      strict,
      indexComplete: true,
      file: editor.path,
      readText: (rel: string) => projectText(rel, editor),
    };
    if (editor.parseFailed || !editor.document) return validate(editor.text, shared);
    return validate(textForWrite(editor.document), shared);
  }, [editor, strict, grammarTexts]);
  const issues = serverIssues ?? checked?.errors ?? [];
  const canSave = Boolean(editor?.dirty && checked?.ok && !serverIssues && !saving);
  const blocking = issues.filter((issue) => issue.severity === "error" || (strict && issue.code === "missing-parent"));
  const errorCount = blocking.length;
  const warningCount = issues.length - errorCount;
  const graph = useMemo(() => buildGraph(catalog, selected, depth), [catalog, selected, depth]);

  async function save() {
    const current = editorRef.current;
    if (!current || saving || selfWrite.current) return;
    const readText = (rel: string) =>
      current.kind === "sgra" && current.path === rel ? current.text : grammarTextsRef.current[rel];
    if (current.kind === "sgra") {
      const parsed = parseGrammarFile(current.text);
      if (parsed.errors.some((issue) => issue.severity === "error") || !parsed.grammar) {
        setServerIssues(parsed.errors);
        setNotice("Fix errors before saving");
        return;
      }
      setSaving(true);
      selfWrite.current = true;
      try {
        const view = await putGrammar(current.path, { grammar: parsed.grammar });
        setEditor(editorFromGrammar(view));
        setServerIssues(null);
        setNotice("Written");
        await refreshLists();
      } catch (err) {
        if (err instanceof ApiError) {
          setServerIssues(err.errors);
          setNotice(err.message);
        } else {
          setNotice(err instanceof Error ? err.message : "Save failed");
        }
      } finally {
        setSaving(false);
        window.setTimeout(() => {
          selfWrite.current = false;
        }, 600);
      }
      return;
    }
    const gate = current.parseFailed || !current.document
      ? validate(current.text, {
          siblingUids: current.siblingUids,
          siblingEdges: current.siblingEdges,
          mode: "write",
          strict,
          indexComplete: true,
          file: current.path,
          readText,
        })
      : validate(textForWrite(current.document), {
          siblingUids: current.siblingUids,
          siblingEdges: current.siblingEdges,
          mode: "write",
          strict,
          indexComplete: true,
          file: current.path,
          readText,
        });
    if (!gate.ok) {
      setServerIssues(gate.errors);
      setNotice("Fix errors before saving");
      return;
    }
    setSaving(true);
    selfWrite.current = true;
    try {
      const view = await putFile(
        current.path,
        current.parseFailed || !current.document ? { text: current.text } : { document: current.document },
        strict,
        forceNext,
      );
      setEditor(editorFromView(view));
      setForceNext(false);
      setServerIssues(null);
      setNotice("Written");
      await refreshLists();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.errors);
        setNotice(err.message);
      } else {
        setNotice(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => {
        selfWrite.current = false;
      }, 600);
    }
  }

  function chooseUid(next: string, path?: string) {
    if (path && editor && path !== editor.path) {
      void openPath(path, next, { discard: false, keepView: center === "flow" }).then(() => revealEditor());
      return;
    }
    setSelected(next);
    if (editor) onSelect(editor.path, next);
    const row = document.querySelectorAll<HTMLElement>(`[data-uid="${CSS.escape(next)}"]`);
    for (const node of row) {
      if (node.offsetParent !== null) {
        node.scrollIntoView({ block: "nearest" });
        break;
      }
    }
  }

  function chooseRow(key: string) {
    if (key.startsWith("#")) setSelected(key);
    else chooseUid(key);
    setBottomTab("node");
    setBottomOpen(true);
  }

  function addNode(tag: string, where: "inside" | "after") {
    if (!editor?.document) return;
    const elements = editor.document.grammar.elements.length > 0 ? editor.document.grammar.elements : defaultElements();
    const element = elements.find((item) => item.tag === tag);
    if (!element) return;
    const anchor = resolveSelection(editor.document.nodes, selected);
    const inside = where === "inside" && Boolean(anchor?.node.composite);
    const chain = anchor
      ? nodePrefixChain(editor.document, inside ? [...anchor.path, -1] : anchor.path)
      : joinPrefix([editor.document.prefix]);
    const uids = [...editor.siblingUids, ...collectUids(editor.document)];
    const hasUid = element.fields.some((field) => field.title === "UID");
    const id = !hasUid
      ? ""
      : nextUid(
          element.tag === "SECTION"
            ? sectionUidPrefix(chain || editor.document.prefix)
            : chain || editor.document.prefix || `${tag.slice(0, 3)}-`,
          uids,
        );
    const node = grammarNode(element, id, element.tag === "SECTION" && usesLegacySections(editor.document.nodes));
    const nextPath = anchor
      ? inside
        ? [...anchor.path, anchor.node.children.length]
        : [...anchor.path.slice(0, -1), (anchor.path[anchor.path.length - 1] ?? 0) + 1]
      : [editor.document.nodes.length];
    mutate((document) => ({
      ...document,
      nodes: anchor ? insertRelative(document.nodes, anchor.path, node, where) : [...document.nodes, node],
    }));
    setSelected(id || selectionKey(node, nextPath));
    if (id) onSelect(editor.path, id);
  }

  function addRoot(tag: string) {
    if (!editor?.document) return;
    const elements = editor.document.grammar.elements.length > 0 ? editor.document.grammar.elements : defaultElements();
    const element = elements.find((item) => item.tag === tag);
    if (!element) return;
    const uids = [...editor.siblingUids, ...collectUids(editor.document)];
    const hasUid = element.fields.some((field) => field.title === "UID");
    const id = !hasUid
      ? ""
      : nextUid(
          element.tag === "SECTION" ? sectionUidPrefix(editor.document.prefix) : editor.document.prefix || `${tag.slice(0, 3)}-`,
          uids,
        );
    const node = grammarNode(element, id, element.tag === "SECTION" && usesLegacySections(editor.document.nodes));
    const nextPath = [editor.document.nodes.length];
    mutate((document) => ({ ...document, nodes: [...document.nodes, node] }));
    setSelected(id || selectionKey(node, nextPath));
    if (id) onSelect(editor.path, id);
  }

  function setSectionPrefix(uid: string, value: string) {
    mutate((document) => {
      const row = flatten(document.nodes).find((item) => nodeUid(item.node) === uid);
      if (!row || row.node.tag !== "SECTION") return document;
      return {
        ...document,
        nodes: mapAt(document.nodes, row.path, (node) => withField(node, "PREFIX", value.trim())),
      };
    });
  }

  async function applyPrefixFix(onlyUid: string) {
    const current = editorRef.current;
    if (!current?.document || current.parseFailed || saving) return;
    const renames = prefixRenames(current.document, current.siblingUids, onlyUid);
    if (renames.size === 0) {
      setNotice("Prefixes already match");
      return;
    }
    const document = { ...current.document, nodes: applyUidRenames(current.document.nodes, renames) };
    const gate = validate(textForWrite(document), {
      siblingUids: current.siblingUids,
      siblingEdges: current.siblingEdges,
      mode: "write",
      strict,
      indexComplete: true,
      file: current.path,
    });
    if (!gate.ok) {
      setServerIssues(gate.errors);
      setNotice("Fix other errors before renaming prefixes");
      return;
    }
    setSaving(true);
    selfWrite.current = true;
    try {
      const view = await putFile(current.path, { document }, strict, true);
      const oldIds = new Set(renames.keys());
      const files = new Set(
        catalog
          .filter(
            (node) => node.file !== current.path && node.relations.some((relation) => oldIds.has(relation.value)),
          )
          .map((node) => node.file),
      );
      for (const file of files) {
        const other = await getFile(file);
        if (!other.document) continue;
        await putFile(
          file,
          { document: { ...other.document, nodes: applyUidRenames(other.document.nodes, renames) } },
          false,
          false,
        );
      }
      setEditor(editorFromView(view));
      setSelected((uid) => renames.get(uid) ?? uid);
      setServerIssues(null);
      setNotice(`Renamed ${renames.size} ${renames.size === 1 ? "id" : "ids"}`);
      await refreshLists();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.errors);
        setNotice(err.message);
      } else {
        setNotice(err instanceof Error ? err.message : "Prefix rename failed");
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => {
        selfWrite.current = false;
      }, 600);
    }
  }

  async function moveGrammarTo(grammarPath: string) {
    const current = editorRef.current;
    if (!current?.document || current.kind !== "sdoc") return;
    const detached = detachGrammar(current.document, current.path, grammarPath);
    if ("error" in detached) {
      setNotice(detached.error);
      return;
    }
    setSaving(true);
    selfWrite.current = true;
    try {
      await createGrammar(grammarPath, detached.text);
      try {
        const view = await putFile(current.path, { document: detached.document }, strict, false);
        setEditor(editorFromView(view));
        setNotice(`Grammar moved to ${grammarPath}`);
        await refreshLists();
      } catch (err) {
        await deleteDoc(grammarPath, true).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setServerIssues(err.errors);
        setNotice(err.message);
      } else {
        setNotice(err instanceof Error ? err.message : "Could not move the grammar.");
      }
    } finally {
      setSaving(false);
      window.setTimeout(() => {
        selfWrite.current = false;
      }, 600);
    }
  }

  function editGrammar(grammar: Grammar) {
    const text = grammar.importFrom ? undefined : serializeGrammarFile(grammar.elements);
    setServerIssues(null);
    setNotice("");
    setEditor((current) => {
      if (!current) return current;
      if (current.kind === "sgra") {
        return {
          ...current,
          grammar: { ...grammar, explicit: true, importFrom: undefined },
          text: text ?? current.text,
          dirty: true,
          parseFailed: false,
        };
      }
      if (!current.document) return current;
      return {
        ...current,
        grammar,
        document: { ...current.document, grammar: { ...grammar, explicit: true } },
        dirty: true,
      };
    });
  }

  function deleteSelected() {
    if (!editor?.document || !selected) return;
    const row = resolveSelection(editor.document.nodes, selected);
    if (!row) return;
    const doomed = new Set(uidsUnder(row.node));
    const incoming = catalog.filter(
      (node) =>
        node.file !== editor.path &&
        node.relations.some((relation) => relation.type === "Parent" && doomed.has(relation.value)),
    );
    if (incoming.length > 0) {
      const proceed = window.confirm(
        `${incoming.map((node) => node.uid).join(", ")} parent-point at ${[...doomed].join(", ")}. Remove it anyway?`,
      );
      if (!proceed) return;
      setForceNext(true);
    }
    const uid = nodeUid(row.node);
    const path = row.path;
    mutate((document) => {
      let nodes = document.nodes;
      for (const id of doomed) nodes = stripParents(nodes, id);
      return { ...document, nodes: uid ? removeUid(nodes, uid).nodes : removeAt(nodes, path) };
    });
    setSelected("");
  }

  async function removeFile(path: string) {
    try {
      await deleteDoc(path, false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) {
        setNotice(err instanceof Error ? err.message : "Delete failed");
        return;
      }
      if (!window.confirm(`${err.message} Delete anyway?`)) return;
      try {
        await deleteDoc(path, true);
      } catch (forceErr) {
        setNotice(forceErr instanceof Error ? forceErr.message : "Delete failed");
        return;
      }
    }
    const listed = await refreshLists();
    if (editor?.path === path) {
      const next = listed.find((item) => item.path !== path);
      if (next) await openPath(next.path, "", { discard: true });
      else setEditor(null);
    }
  }

  async function submitDraft() {
    setDraftError("");
    const path = draft.path.trim();
    if (draft.kind === "sgra") {
      if (!path.endsWith(".sgra") || path.includes("..")) {
        setDraftError("Use a relative path that ends in .sgra.");
        return;
      }
      try {
        const view = await createGrammar(path);
        setCreating(false);
        setDraft({ path: "", title: "", uid: "", prefix: "", root: false, kind: "sdoc" });
        await refreshLists();
        setEditor(editorFromGrammar(view));
        setCenter("grammar");
        setSelected("");
        onSelect(view.path, "");
        revealEditor();
      } catch (err) {
        setDraftError(err instanceof Error ? err.message : "Could not create the grammar file.");
      }
      return;
    }
    if (!path.endsWith(".sdoc") || path.includes("..")) {
      setDraftError("Use a relative path that ends in .sdoc.");
      return;
    }
    try {
      const view = await createDoc({
        path,
        title: draft.title.trim(),
        uid: draft.uid.trim() || undefined,
        prefix: draft.prefix.trim() || undefined,
        root: draft.root,
      });
      setCreating(false);
      setDraft({ path: "", title: "", uid: "", prefix: "", root: false, kind: "sdoc" });
      await refreshLists();
      setEditor(editorFromView(view));
      setSelected("");
      onSelect(view.path, "");
      revealEditor();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not create the file.");
    }
  }

  const views = [
    ["table", "This file"],
    ["text", "Text"],
    ["grammar", "Grammar"],
    ["nodes", "All nodes"],
    ["flow", "Flow"],
  ] as const;

  function startCreate(kind: "sdoc" | "sgra") {
    setDraftError("");
    setDraft({ path: "", title: "", uid: "", prefix: "", root: false, kind });
    setCreating(true);
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      {loadError ? <p className="border-b border-line px-3 py-2 text-sm text-danger">{loadError}</p> : null}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
        <IntakeShell
          panelOpen={panelOpen}
          onPanelOpenChange={(id, open) => setPanelOpen((current) => (current[id] === open ? current : { ...current, [id]: open }))}
          bottomOpen={bottomOpen}
          onBottomOpenChange={setBottomOpen}
          bottomTab={bottomTab}
          onBottomTabChange={setBottomTab}
          onSave={() => {
            void save();
          }}
          canSave={canSave && !saving}
          breadcrumb={
            <p className="min-w-0 truncate font-mono text-xs text-muted">
              {editor?.path ?? "No file"}
              {editor?.dirty ? <span className="text-accent"> · unsaved</span> : null}
            </p>
          }
          statusBar={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {editor?.external ? (
                <span className="text-fg">
                  File changed on disk.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      if (!editor) return;
                      void (editor.kind === "sgra" ? getGrammar(editor.path) : getFile(editor.path)).then((view) => {
                        setEditor(editor.kind === "sgra" ? editorFromGrammar(view as GrammarResponse) : editorFromView(view as FileResponse));
                      });
                    }}
                  >
                    Load disk copy
                  </button>
                </span>
              ) : null}
              <button
                type="button"
                className="min-h-7 text-left"
                onClick={() => {
                  setBottomTab("problems");
                  setBottomOpen(true);
                }}
              >
                <span className={errorCount > 0 ? "text-danger" : "text-ok"}>
                  {errorCount} {errorCount === 1 ? "error" : "errors"}
                </span>
                <span className="text-muted">
                  {" "}
                  · {warningCount} {warningCount === 1 ? "warning" : "warnings"}
                </span>
              </button>
              <label className="inline-flex min-h-7 items-center gap-2 text-muted">
                <input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} />
                Strict parents
              </label>
              {editor?.dirty ? <span className="text-accent">Unsaved</span> : null}
              {notice ? <span className="text-ok">{notice}</span> : null}
              <button
                type="button"
                onClick={() => {
                  void save();
                }}
                disabled={!canSave || saving}
                className="ml-auto min-h-7 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"
              >
                {saving ? "Saving" : "Save"}
              </button>
            </div>
          }
          files={
        <div className="flex h-full min-h-0 flex-col">
          <Tree
            root={root}
            files={files}
            dirs={dirs}
            active={editor?.path ?? ""}
            onOpen={(path) => {
              void openPath(path)
                .then(() => revealEditor())
                .catch((err: unknown) => {
                  setLoadError(err instanceof Error ? err.message : "Could not open the file.");
                });
            }}
            onCreateFile={(folder) => {
              setDraftError("");
              setDraft({ path: folder ? `${folder}/` : "", title: "", uid: "", prefix: "", root: false, kind: "sdoc" });
              setCreating(true);
            }}
            onCreateFolder={async (path) => {
              await createDir(path);
              await refreshLists();
            }}
            onDelete={(path) => {
              void removeFile(path);
            }}
          />
        </div>
          }
          editor={
        <>
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg">
          {editor?.document && !editor.parseFailed ? (
            <div className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
              <label className="min-w-0 flex-1 text-xs text-muted">
                Document title
                <input
                  value={editor.document.title}
                  onChange={(event) => {
                    const title = event.target.value;
                    mutate((document) => ({ ...document, title }));
                  }}
                  className="mt-1 min-h-11 w-full bg-transparent text-sm text-fg"
                />
              </label>
              <label className="text-xs text-muted">
                Prefix
                <input
                  value={editor.document.prefix ?? ""}
                  onChange={(event) => {
                    const prefix = event.target.value;
                    mutate((document) => ({ ...document, prefix: prefix.length > 0 ? prefix : undefined }));
                  }}
                  placeholder="SYS-"
                  className="mt-1 min-h-11 w-28 bg-transparent font-mono text-sm text-fg"
                />
              </label>
              {editor.document.root === undefined ? null : (
                <p className="pb-2 font-mono text-xs text-muted">
                  {editor.document.root === false ? "ROOT false" : "ROOT true"}
                </p>
              )}
            </div>
          ) : null}
          {center === "text" && editor ? (
            <textarea
              value={editor.text}
              onChange={(event) => editSource(event.target.value)}
              aria-label="File source"
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none bg-bg p-3 font-mono text-xs leading-relaxed text-fg"
            />
          ) : editor?.kind === "sgra" ? (
            editor.parseFailed || !editor.grammar ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <p className="border-b border-line px-3 py-2 text-sm text-danger">
                  This grammar file does not parse. Fix the source. Nothing is written until it validates.
                </p>
                <textarea
                  value={editor.text}
                  onChange={(event) => editSource(event.target.value)}
                  className="min-h-0 w-full flex-1 resize-none bg-bg p-3 font-mono text-xs leading-relaxed text-fg"
                  spellCheck={false}
                />
              </div>
            ) : (
              <GrammarEditor grammar={editor.grammar} onChange={editGrammar} />
            )
          ) : center === "grammar" && editor?.document ? (
            <GrammarEditor
              grammar={
                editor.document.grammar.explicit || editor.document.grammar.importFrom
                  ? editor.document.grammar
                  : { explicit: false, elements: defaultElements() }
              }
              onChange={editGrammar}
              onOpenImport={(spec) => {
                const rel = resolveGrammarPath(editor.path, spec);
                if (!rel) {
                  setNotice("That grammar path is outside the project.");
                  return;
                }
                void openPath(rel);
              }}
              onMoveToFile={editor.document.grammar.importFrom ? undefined : moveGrammarTo}
            />
          ) : center === "flow" ? (
            <FlowMap
              nodes={catalog}
              focus={selected}
              file={editor?.kind === "sdoc" ? editor.path : ""}
              onPick={(uid, path) => {
                chooseUid(uid, path);
              }}
            />
          ) : center === "nodes" ? (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {catalog
                .filter((node) => node.tag !== "DOCUMENT")
                .map((node) => (
                  <li key={`${node.file}:${node.uid}`}>
                    <button
                      type="button"
                      onClick={() => chooseUid(node.uid, node.file)}
                      className="flex min-h-11 w-full items-baseline gap-2 border-b border-line px-3 text-left"
                    >
                      <span className="font-mono text-xs text-accent">{node.uid}</span>
                      <span className="truncate text-sm">{node.title}</span>
                      <span className="ml-auto font-mono text-xs text-muted">{node.file}</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : editor?.parseFailed ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="border-b border-line px-3 py-2 text-sm text-danger">
                This file does not parse. Fix the source. Nothing is written until it validates.
              </p>
              <textarea
                value={editor.text}
                onChange={(event) => {
                  const text = event.target.value;
                  setServerIssues(null);
                  setEditor((current) => (current ? { ...current, text, dirty: true } : current));
                }}
                className="min-h-0 w-full flex-1 resize-none bg-bg p-3 font-mono text-xs leading-relaxed text-fg"
                spellCheck={false}
              />
            </div>
          ) : editor?.document ? (
            <IntakeTable
              document={editor.document}
              selected={selected}
              onSelect={(next) => chooseRow(next)}
              onInsert={addNode}
              onDelete={deleteSelected}
              markedUids={editor.document ? prefixExpectations(editor.document) : undefined}
            />
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 px-6">
              {fsMode === "browser" && !folderReady ? (
                <>
                  <p className="max-w-md text-sm text-muted">
                    {window.location.protocol === "file:"
                      ? "This file is open from disk. Chrome will not grant a folder that way. Serve sdoc-intake.html over http or https, then open a folder of .sdoc files."
                      : "No server. Open a folder of .sdoc files. They stay on this computer. Chrome or Edge is required."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void chooseMode("browser")}
                    className="min-h-11 rounded-md bg-accent px-3 text-sm text-accent-fg"
                  >
                    Open folder
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">No file open.</p>
                  <button
                    type="button"
                    onClick={() => startCreate("sdoc")}
                    className="min-h-11 rounded-md bg-accent px-3 text-sm text-accent-fg"
                  >
                    New .sdoc
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <EditorChromePortal slot="menuFile">
          <>
            <DropdownMenuItem onSelect={() => startCreate("sdoc")}>New document</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startCreate("sgra")}>New grammar</DropdownMenuItem>
          </>
        </EditorChromePortal>
        <EditorChromePortal slot="menuView">
          <>
            {views.map(([id, label]) => (
              <DropdownMenuItem key={id} onSelect={() => selectView(id)}>
                {center === id ? "✓ " : ""}
                {label}
              </DropdownMenuItem>
            ))}
          </>
        </EditorChromePortal>
        <EditorChromePortal slot="menuTools">
          <DropdownMenuItem onSelect={() => setStrict((value) => !value)}>
            {strict ? "✓ " : ""}
            Strict parents
          </DropdownMenuItem>
        </EditorChromePortal>
        <EditorChromePortal slot="viewMode">
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Center view">
            {views.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={center === id}
                onClick={() => selectView(id)}
                className={"h-7 rounded px-2 text-xs " + (center === id ? "bg-surface-2 text-fg" : "text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
        </EditorChromePortal>
        <EditorChromePortal slot="actions">
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Where documents live">
            <button
              type="button"
              aria-pressed={fsMode === "server"}
              onClick={() => void chooseMode("server")}
              className={"h-7 rounded px-2 text-xs " + (fsMode === "server" ? "bg-surface-2 text-fg" : "text-muted")}
            >
              Server
            </button>
            <button
              type="button"
              aria-pressed={fsMode === "browser"}
              onClick={() => void chooseMode("browser")}
              className={"h-7 rounded px-2 text-xs " + (fsMode === "browser" ? "bg-surface-2 text-fg" : "text-muted")}
            >
              This computer
            </button>
          </div>
        </EditorChromePortal>
        <EditorChromePortal slot="node">
          {editor?.document && !editor.parseFailed ? (
            <NodeForm
              document={editor.document}
              row={flatten(editor.document.nodes).find((row) => selectionKey(row.node, row.path) === selected)}
              index={catalog}
              markedUids={prefixExpectations(editor.document)}
              onField={(path, name, value) => {
                mutate((document) => ({
                  ...document,
                  nodes: mapAt(document.nodes, path, (node) => withField(node, name, value)),
                }));
                if (name === "UID") {
                  const next = value.trim();
                  setSelected(next || `#${path.join(".")}`);
                  if (editor) onSelect(editor.path, next);
                }
              }}
              onRelations={(path, relations: Relation[]) => {
                mutate((document) => ({
                  ...document,
                  nodes: mapAt(document.nodes, path, (node) => withRelations(node, relations)),
                }));
              }}
            />
          ) : (
            <p className="px-1 text-xs text-muted">Open a document and select a node.</p>
          )}
        </EditorChromePortal>
        <EditorChromePortal slot="problems">
          <ValidationBar
            issues={issues}
            onJump={(issue) => {
              if (issue.uid) chooseUid(issue.uid, issue.file);
              setBottomOpen(true);
              setBottomTab("problems");
              revealEditor();
            }}
          />
        </EditorChromePortal>
        </>
          }
          inspector={
        <div className="flex h-full min-h-0 flex-col bg-surface">
          <div className="flex border-b border-line">
            {(
              [
                ["outline", "Outline"],
                ["trace", "Trace"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDrawer(id)}
                className={
                  "min-h-11 flex-1 text-xs " + (drawer === id ? "border-b-2 border-accent text-fg" : "text-muted")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {drawer === "outline" && editor?.document && !editor.parseFailed ? (
            <div className="min-h-0 flex-1">
              <Outline
                document={editor.document}
                selected={selected}
                onSelect={(uid) => chooseRow(uid)}
                onChange={(nodes) => mutate((document) => ({ ...document, nodes }))}
                onAddRoot={addRoot}
                onFix={(uid) => {
                  void applyPrefixFix(uid);
                }}
                onSectionPrefix={setSectionPrefix}
              />
            </div>
          ) : null}
          {drawer === "outline" && (!editor?.document || editor.parseFailed) ? (
            <p className="px-3 py-6 text-sm text-muted">Open a document to change its outline.</p>
          ) : null}
          {drawer === "trace" ? (
            <div className="min-h-0 flex-1">
              <Graph
                graph={graph}
                focus={selected}
                depth={depth}
                onDepth={setDepth}
                onPick={(next) => {
                  const node = catalog.find((item) => item.uid === next && item.tag !== "DOCUMENT");
                  chooseUid(next, node?.file);
                  revealEditor();
                }}
              />
            </div>
          ) : null}
        </div>
          }
        />
        </div>
      </div>
      {creating ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-bg/80 p-4 sm:items-center">
          <form
            className="w-full max-w-md rounded-lg border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft();
            }}
          >
            <h2 className="text-sm font-semibold">{draft.kind === "sgra" ? "New grammar" : "New document"}</h2>
            <div className="mt-2 flex rounded-md border border-line p-0.5" role="group" aria-label="File kind">
              <button
                type="button"
                aria-pressed={draft.kind === "sdoc"}
                onClick={() => setDraft({ ...draft, kind: "sdoc" })}
                className={"min-h-9 flex-1 rounded text-xs " + (draft.kind === "sdoc" ? "bg-surface-2 text-fg" : "text-muted")}
              >
                Document
              </button>
              <button
                type="button"
                aria-pressed={draft.kind === "sgra"}
                onClick={() =>
                  setDraft({
                    ...draft,
                    kind: "sgra",
                    path: draft.path.endsWith(".sdoc") ? draft.path.replace(/\.sdoc$/, ".sgra") : draft.path,
                  })
                }
                className={"min-h-9 flex-1 rounded text-xs " + (draft.kind === "sgra" ? "bg-surface-2 text-fg" : "text-muted")}
              >
                Grammar
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              {draft.kind === "sgra"
                ? "A .sgra file other documents can import."
                : "Created under the data root. Validated before it is written."}
            </p>
            <label className="mt-3 block text-xs text-muted">
              Path
              <input
                required
                value={draft.path}
                onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                placeholder={draft.kind === "sgra" ? "grammar/org.sgra" : "CAB.sdoc"}
                className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
              />
            </label>
            {draft.kind === "sdoc" ? (
              <>
            <label className="mt-3 block text-xs text-muted">
              Title
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Document UID
                <input
                  value={draft.uid}
                  onChange={(event) => setDraft({ ...draft, uid: event.target.value })}
                  placeholder="DOC-CAB"
                  className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
                />
              </label>
              <label className="text-xs text-muted">
                Prefix
                <input
                  value={draft.prefix}
                  onChange={(event) => setDraft({ ...draft, prefix: event.target.value })}
                  placeholder="CAB-"
                  className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
                />
              </label>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.root}
                onChange={(event) => setDraft({ ...draft, root: event.target.checked })}
              />
              ROOT true
            </label>
              </>
            ) : null}
            {draftError ? <p className="mt-2 text-sm text-danger">{draftError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="min-h-11 rounded-md px-3 text-sm text-muted">
                Cancel
              </button>
              <button type="submit" className="min-h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
