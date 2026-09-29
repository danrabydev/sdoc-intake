import { useEffect, useMemo, useRef, useState } from "react";
import type { FileResponse, IndexNode, TreeFile } from "@/lib/sdoc/api-types";
import { openBrowserFolder, restoreBrowserFolder, subscribeBrowser } from "@/lib/sdoc/browser-fs";
import { ApiError, createDoc, deleteDoc, getFile, getIndex, getTree, probeServer, putFile } from "@/lib/sdoc/client";
import { explicitMode, FS_MODE_KEY, setActiveMode, type FsMode } from "@/lib/sdoc/fs-mode";
import { buildGraph } from "@/lib/sdoc/graph";
import { collectUids, fieldOf, flatten, mapAt, nextUid, nodeUid, placeNode, removeUid, requirementNode, sectionNode, sectionUidPrefix, usesLegacySections, withField, withRelations } from "@/lib/sdoc/model";
import { textForWrite } from "@/lib/sdoc/serialize";
import type { Relation, SDocDocument, SDocIssue, SDocNode } from "@/lib/sdoc/types";
import { validate } from "@/lib/sdoc/validate";
import { Graph } from "@/components/sdoc/Graph";
import { IntakeTable } from "@/components/sdoc/IntakeTable";
import { Tree } from "@/components/sdoc/Tree";
import { ValidationBar } from "@/components/sdoc/ValidationBar";

interface Editor {
  path: string;
  text: string;
  document: SDocDocument | null;
  parseFailed: boolean;
  siblingUids: string[];
  siblingEdges: { from: string; to: string }[];
  dirty: boolean;
  external: boolean;
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
  const local: IndexNode[] = [];
  if (editor.document.uid) {
    local.push({
      uid: editor.document.uid,
      title: editor.document.title,
      file: editor.path,
      tag: "DOCUMENT",
      statement: "",
      relations: [],
    });
  }
  for (const row of flatten(editor.document.nodes)) {
    const uid = nodeUid(row.node);
    if (!uid) continue;
    const statement = fieldOf(row.node, "STATEMENT");
    local.push({
      uid,
      title: fieldOf(row.node, "TITLE") || statement.split("\n").find((line) => line.trim()) || "",
      file: editor.path,
      tag: row.node.tag,
      statement,
      relations: row.node.relations.map((relation) => ({
        type: relation.type,
        role: relation.role,
        value: relation.value,
      })),
    });
  }
  return [...others, ...local];
}

function editorFromView(
  view: Awaited<ReturnType<typeof getFile>>,
  dirty = false,
): Editor {
  return {
    path: view.path,
    text: view.text,
    document: view.document,
    parseFailed: view.parseFailed,
    siblingUids: view.siblingUids,
    siblingEdges: view.siblingEdges,
    dirty,
    external: false,
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
  initial: { root: string; files: TreeFile[]; nodes: IndexNode[]; file: FileResponse | null };
  file: string;
  uid: string;
  onSelect: (file: string, uid: string) => void;
}) {
  const [files, setFiles] = useState<TreeFile[]>(initial.files);
  const [root, setRoot] = useState(initial.root);
  const [index, setIndex] = useState<IndexNode[]>(initial.nodes);
  const [editor, setEditor] = useState<Editor | null>(initial.file ? editorFromView(initial.file) : null);
  const [selected, setSelected] = useState(uid || firstRequirement(initial.file?.document ?? null));
  const [strict, setStrict] = useState(false);
  const [flat, setFlat] = useState(false);
  const [pane, setPane] = useState<"files" | "intake" | "trace">("intake");
  const [depth, setDepth] = useState(2);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ path: "", title: "", uid: "", prefix: "", root: false });
  const [draftError, setDraftError] = useState("");
  const [forceNext, setForceNext] = useState(false);
  const [serverIssues, setServerIssues] = useState<SDocIssue[] | null>(null);
  const [fsMode, setFsMode] = useState<FsMode | null>(null);
  const [folderReady, setFolderReady] = useState(false);
  const [boot, setBoot] = useState(0);
  const editorRef = useRef<Editor | null>(null);
  const selectedRef = useRef(selected);
  const selfWrite = useRef(false);
  editorRef.current = editor;
  selectedRef.current = selected;

  async function refreshLists() {
    const [tree, listed] = await Promise.all([getTree(), getIndex()]);
    setRoot(tree.root);
    setFiles(tree.files);
    setIndex(listed.nodes);
    return tree.files;
  }

  async function openPath(path: string, nextUid = "", options?: { discard?: boolean }) {
    const current = editorRef.current;
    if (current?.dirty && current.path !== path && !options?.discard) {
      if (!window.confirm("Discard unsaved edits?")) return;
    }
    const view = await getFile(path);
    setEditor(editorFromView(view));
    setSelected(nextUid);
    setForceNext(false);
    setServerIssues(null);
    setFlat(false);
    setNotice("");
    onSelect(path, nextUid);
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
      void getFile(current.path)
        .then((view) => {
          if (editorRef.current?.dirty || editorRef.current?.path !== view.path) return;
          setEditor(editorFromView(view));
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
      if (!editorRef.current) {
        try {
          const listed = await refreshLists();
          if (!cancel) {
            const path = file || listed[0]?.path || "";
            if (path) {
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
      return { ...current, document: fn(current.document), dirty: true };
    });
  }

  const catalog = useMemo(() => liveIndex(index, editor), [index, editor]);
  const checked = useMemo(() => {
    if (!editor) return null;
    const shared = {
      siblingUids: editor.siblingUids,
      siblingEdges: editor.siblingEdges,
      mode: "write" as const,
      strict,
      indexComplete: true,
      file: editor.path,
    };
    if (editor.parseFailed || !editor.document) return validate(editor.text, shared);
    return validate(textForWrite(editor.document), shared);
  }, [editor, strict]);
  const issues = serverIssues ?? checked?.errors ?? [];
  const canSave = Boolean(editor?.dirty && checked?.ok && !serverIssues && !saving);
  const graph = useMemo(() => buildGraph(catalog, selected, depth), [catalog, selected, depth]);

  async function save() {
    const current = editorRef.current;
    if (!current || saving || selfWrite.current) return;
    const gate = current.parseFailed || !current.document
      ? validate(current.text, {
          siblingUids: current.siblingUids,
          siblingEdges: current.siblingEdges,
          mode: "write",
          strict,
          indexComplete: true,
          file: current.path,
        })
      : validate(textForWrite(current.document), {
          siblingUids: current.siblingUids,
          siblingEdges: current.siblingEdges,
          mode: "write",
          strict,
          indexComplete: true,
          file: current.path,
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
      void openPath(path, next, { discard: false }).then(() => setPane("intake"));
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

  function addNode(kind: "REQUIREMENT" | "SECTION", where: "inside" | "after") {
    if (!editor?.document) return;
    const uids = [...editor.siblingUids, ...collectUids(editor.document)];
    const id =
      kind === "SECTION"
        ? nextUid(sectionUidPrefix(editor.document.prefix), uids)
        : nextUid(editor.document.prefix || "REQ-", uids);
    const node =
      kind === "SECTION"
        ? sectionNode(id, "New section", usesLegacySections(editor.document.nodes))
        : requirementNode(id, "New requirement", "");
    const anchor = selected || undefined;
    mutate((document) => ({
      ...document,
      nodes: placeNode(document.nodes, anchor, node, where),
    }));
    setSelected(id);
    onSelect(editor.path, id);
  }

  function deleteSelected() {
    if (!editor?.document || !selected) return;
    const row = flatten(editor.document.nodes).find((item) => nodeUid(item.node) === selected);
    const doomed = new Set(row ? uidsUnder(row.node) : [selected]);
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
    const uid = selected;
    mutate((document) => {
      let nodes = document.nodes;
      for (const id of doomed) nodes = stripParents(nodes, id);
      return { ...document, nodes: removeUid(nodes, uid).nodes };
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
      setDraft({ path: "", title: "", uid: "", prefix: "", root: false });
      await refreshLists();
      setEditor(editorFromView(view));
      setSelected("");
      onSelect(view.path, "");
      setPane("intake");
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Could not create the file.");
    }
  }

  const paneClass = (name: "files" | "intake" | "trace", extra: string) =>
    `${pane === name ? "flex" : "hidden"} min-h-0 flex-col lg:flex ${extra}`;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <p className="font-mono text-xs tracking-widest text-accent">SDOC</p>
        <h1 className="text-sm font-semibold">Intake</h1>
        <p className="text-xs text-muted">
          {fsMode === "browser" ? "Files stay in the folder you pick." : "Edit the tree. Invalid SDoc is never written."}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Where documents live">
            <button
              type="button"
              aria-pressed={fsMode === "server"}
              onClick={() => void chooseMode("server")}
              className={
                "min-h-11 rounded px-2 text-xs " + (fsMode === "server" ? "bg-surface-2 text-fg" : "text-muted")
              }
            >
              Server
            </button>
            <button
              type="button"
              aria-pressed={fsMode === "browser"}
              onClick={() => void chooseMode("browser")}
              className={
                "min-h-11 rounded px-2 text-xs " + (fsMode === "browser" ? "bg-surface-2 text-fg" : "text-muted")
              }
            >
              This computer
            </button>
          </div>
          {editor ? <p className="max-w-48 truncate font-mono text-xs text-fg">{editor.path}</p> : null}
        </div>
      </header>
      <div className="flex border-b border-line lg:hidden">
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
            onClick={() => setPane(id)}
            className={
              "min-h-11 flex-1 text-sm " + (pane === id ? "border-b-2 border-accent text-fg" : "text-muted")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {loadError ? <p className="border-b border-line px-3 py-2 text-sm text-danger">{loadError}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
        <aside className={paneClass("files", "border-line lg:border-r")}>
          <Tree
            root={root}
            files={files}
            active={editor?.path ?? ""}
            onOpen={(path) => {
              void openPath(path)
                .then(() => setPane("intake"))
                .catch((err: unknown) => {
                  setLoadError(err instanceof Error ? err.message : "Could not open the file.");
                });
            }}
            onCreate={() => {
              setDraftError("");
              setCreating(true);
            }}
            onDelete={(path) => {
              void removeFile(path);
            }}
          />
        </aside>
        <section className={paneClass("intake", "min-w-0 bg-bg")}>
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
              <p className="pb-2 font-mono text-xs text-muted">
                {editor.document.prefix ? `Prefix ${editor.document.prefix}` : "No prefix"}
                {editor.document.root === false ? " · ROOT false" : editor.document.root ? " · ROOT true" : ""}
              </p>
              <button
                type="button"
                onClick={() => setFlat((value) => !value)}
                className="min-h-11 rounded-md border border-line px-2 text-xs text-muted"
              >
                {flat ? "This file" : "All nodes"}
              </button>
            </div>
          ) : null}
          {flat ? (
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
              index={catalog}
              onSelect={(next) => chooseUid(next)}
              onField={(path, name, value) => {
                mutate((document) => ({
                  ...document,
                  nodes: mapAt(document.nodes, path, (node) => withField(node, name, value)),
                }));
              }}
              onRelations={(path, relations: Relation[]) => {
                mutate((document) => ({
                  ...document,
                  nodes: mapAt(document.nodes, path, (node) => withRelations(node, relations)),
                }));
              }}
              onInsert={addNode}
              onDelete={deleteSelected}
            />
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 px-6">
              {fsMode === "browser" && !folderReady ? (
                <>
                  <p className="max-w-md text-sm text-muted">
                    No server. Open a folder of .sdoc files. They stay on this computer. Chrome or Edge is required.
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
                    onClick={() => setCreating(true)}
                    className="min-h-11 rounded-md bg-accent px-3 text-sm text-accent-fg"
                  >
                    New .sdoc
                  </button>
                </>
              )}
            </div>
          )}
        </section>
        <aside className={paneClass("trace", "border-line lg:border-l")}>
          <Graph
            graph={graph}
            focus={selected}
            depth={depth}
            onDepth={setDepth}
            onPick={(next) => {
              const node = catalog.find((item) => item.uid === next && item.tag !== "DOCUMENT");
              chooseUid(next, node?.file);
              setPane("intake");
            }}
          />
        </aside>
      </div>
      <ValidationBar
        issues={issues}
        strict={strict}
        dirty={Boolean(editor?.dirty)}
        saving={saving}
        external={Boolean(editor?.external)}
        notice={notice}
        canSave={canSave}
        onStrict={setStrict}
        onSave={() => {
          void save();
        }}
        onJump={(issue) => {
          if (issue.uid) chooseUid(issue.uid, issue.file);
          setPane("intake");
        }}
        onReload={() => {
          if (!editor) return;
          void getFile(editor.path).then((view) => setEditor(editorFromView(view)));
        }}
      />
      {creating ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
          <form
            className="w-full max-w-md rounded-lg border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft();
            }}
          >
            <h2 className="text-sm font-semibold">New document</h2>
            <p className="mt-1 text-xs text-muted">Created under the data root. Validated before it is written.</p>
            <label className="mt-3 block text-xs text-muted">
              Path
              <input
                required
                value={draft.path}
                onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                placeholder="CAB.sdoc"
                className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-2 font-mono text-sm text-fg"
              />
            </label>
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
