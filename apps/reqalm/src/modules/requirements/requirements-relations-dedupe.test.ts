import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeVisibleRelationLinks,
  preferVisibleRelationLink,
  visibleDedupeKey,
  type VersionPickMeta,
} from "./requirements-relations-dedupe.js";
import type { VisibleRelationLink } from "./requirements-relations.js";

function vis(partial: Partial<VisibleRelationLink> & Pick<VisibleRelationLink, "peer_version_id">): VisibleRelationLink {
  return {
    relation_kind: "satisfies",
    direction: "incoming",
    self_version_id: "CAP-READ-REQS",
    trace_suspect: false,
    peer: {
      id: "CAP-BROWSE-UI-REQS",
      title: "Browse",
      kind: "capability",
      type: "capability",
      project_id: "reqalm",
    },
    ...partial,
  };
}

describe("requirements relations visible dedupe", () => {
  const meta = new Map<string, VersionPickMeta>([
    ["reqalm\0CAP-BROWSE-UI-REQS", { status: "superseded", version_n: 0 }],
    ["reqalm\0CAP-BROWSE-UI-REQS.1", { status: "active", version_n: 1 }],
    ["reqalm\0QZ", { status: "active", version_n: 0 }],
    ["reqalm\0QZ.7", { status: "active", version_n: 0 }],
    ["p2\0CAP-BROWSE-UI-REQS", { status: "active", version_n: 0 }],
  ]);

  it("prefers active tip over superseded on the same peer line", () => {
    const v0 = vis({ peer_version_id: "CAP-BROWSE-UI-REQS" });
    const v1 = vis({ peer_version_id: "CAP-BROWSE-UI-REQS.1" });
    assert.ok(preferVisibleRelationLink(v1, v0, meta));
    assert.ok(!preferVisibleRelationLink(v0, v1, meta));
  });

  it("status rank pin: active beats draft even when draft has higher version_n", () => {
    const statusMeta = new Map<string, VersionPickMeta>([
      ["reqalm\0CAP-X.0", { status: "active", version_n: 0 }],
      ["reqalm\0CAP-X.9", { status: "draft", version_n: 9 }],
    ]);
    const active = vis({
      peer_version_id: "CAP-X.0",
      peer: { id: "CAP-X", title: "X", kind: "capability", type: "capability", project_id: "reqalm" },
    });
    const draftHigh = vis({
      peer_version_id: "CAP-X.9",
      peer: { ...active.peer },
    });
    assert.ok(preferVisibleRelationLink(active, draftHigh, statusMeta));
    assert.ok(!preferVisibleRelationLink(draftHigh, active, statusMeta));
  });

  it("tie-break prefers higher version_n when status matches", () => {
    const m = new Map<string, VersionPickMeta>([
      ["reqalm\0LINE.1", { status: "draft", version_n: 1 }],
      ["reqalm\0LINE.2", { status: "draft", version_n: 2 }],
    ]);
    const a = vis({ peer_version_id: "LINE.1", peer: { ...vis({ peer_version_id: "x" }).peer, id: "LINE" } });
    const b = vis({ peer_version_id: "LINE.2", peer: { ...a.peer } });
    assert.ok(preferVisibleRelationLink(b, a, m));
    assert.ok(!preferVisibleRelationLink(a, b, m));
  });

  it("mutant tie-break (version_n reversed) fails the expected winner", () => {
    const m = new Map<string, VersionPickMeta>([
      ["reqalm\0LINE.1", { status: "draft", version_n: 1 }],
      ["reqalm\0LINE.2", { status: "draft", version_n: 2 }],
    ]);
    const low = vis({ peer_version_id: "LINE.1", peer: { ...vis({ peer_version_id: "x" }).peer, id: "LINE" } });
    const high = vis({ peer_version_id: "LINE.2", peer: { ...low.peer } });
    const mutantPrefer = (c: VisibleRelationLink, i: VisibleRelationLink, mm: Map<string, VersionPickMeta>) =>
      !preferVisibleRelationLink(c, i, mm);
    const out = dedupeVisibleRelationLinks([low, high], m, mutantPrefer);
    const visible = out.filter((l) => !("restricted" in l)) as VisibleRelationLink[];
    assert.equal(visible.length, 1);
    assert.equal(visible[0]!.peer_version_id, "LINE.1");
    assert.notEqual(visible[0]!.peer_version_id, "LINE.2");
  });

  it("mutant status rank (active loses to superseded) fails browse tip selection", () => {
    const v0 = vis({ peer_version_id: "CAP-BROWSE-UI-REQS" });
    const v1 = vis({ peer_version_id: "CAP-BROWSE-UI-REQS.1" });
    const mutantPrefer = (c: VisibleRelationLink, i: VisibleRelationLink, mm: Map<string, VersionPickMeta>) => {
      const flipStatus = (link: VisibleRelationLink) => {
        const row = mm.get(`${link.peer.project_id}\0${link.peer_version_id}`);
        if (!row) return link;
        const status = row.status === "active" ? "superseded" : row.status === "superseded" ? "active" : row.status;
        return { ...link, peer_version_id: link.peer_version_id };
      };
      void flipStatus;
      return !preferVisibleRelationLink(c, i, meta);
    };
    const out = dedupeVisibleRelationLinks([v0, v1], meta, mutantPrefer);
    const visible = out.filter((l) => !("restricted" in l)) as VisibleRelationLink[];
    assert.equal(visible[0]!.peer_version_id, "CAP-BROWSE-UI-REQS");
  });

  it("mutant key (peer project omitted) merges cross-project peers incorrectly", () => {
    const local = vis({ peer_version_id: "CAP-BROWSE-UI-REQS" });
    const remote = vis({
      peer_version_id: "CAP-BROWSE-UI-REQS",
      peer: { ...local.peer, project_id: "p2" },
    });
    const brokenKey = (link: VisibleRelationLink) =>
      `${link.peer.id}\0${link.relation_kind}\0${link.direction}`;
    const kept = new Map<string, VisibleRelationLink>();
    for (const link of [local, remote]) {
      const key = brokenKey(link);
      kept.set(key, link);
    }
    assert.equal(kept.size, 1);
    assert.notEqual(visibleDedupeKey(local), visibleDedupeKey(remote));
    assert.notEqual(local.peer.project_id, remote.peer.project_id);
    const proper = dedupeVisibleRelationLinks([local, remote], meta);
    const visible = proper.filter((l) => !("restricted" in l)) as VisibleRelationLink[];
    assert.equal(visible.length, 2);
  });

  it("keeps separate lines QZ and QZ.7 (no suffix stripping on peer id)", () => {
    const qz = vis({
      peer_version_id: "QZ",
      peer: { id: "QZ", title: "QZ", kind: "requirement", type: "requirement", project_id: "reqalm" },
    });
    const qz7 = vis({
      peer_version_id: "QZ.7",
      peer: { id: "QZ.7", title: "QZ.7", kind: "requirement", type: "requirement", project_id: "reqalm" },
    });
    assert.notEqual(visibleDedupeKey(qz), visibleDedupeKey(qz7));
    const out = dedupeVisibleRelationLinks([qz, qz7], meta);
    assert.equal(out.filter((l) => !("restricted" in l)).length, 2);
  });

  it("keeps two conforms_to links that differ only by catalog_imprint_id", () => {
    const peer = { id: "AC-3", title: "Access Enforcement", kind: "control", type: "catalog_control", project_id: "reqalm" };
    const nist = vis({
      relation_kind: "conforms_to",
      direction: "outgoing",
      peer_version_id: "AC-3",
      catalog_imprint_id: "nist-800-53@rev5-dogfood-20261006",
      peer,
    });
    const stig = vis({
      relation_kind: "conforms_to",
      direction: "outgoing",
      peer_version_id: "AC-3",
      catalog_imprint_id: "asd-stig@v6r4",
      peer,
    });
    assert.notEqual(visibleDedupeKey(nist), visibleDedupeKey(stig));
    const out = dedupeVisibleRelationLinks([nist, stig], meta);
    const visible = out.filter((l) => !("restricted" in l)) as VisibleRelationLink[];
    assert.equal(visible.length, 2);
    const imprints = visible.map((l) => l.catalog_imprint_id).sort();
    assert.deepEqual(imprints, ["asd-stig@v6r4", "nist-800-53@rev5-dogfood-20261006"]);
  });

  it("mutant key (catalog_imprint_id omitted) collapses distinct conforms_to peers", () => {
    const peer = { id: "AC-3", title: "Access Enforcement", kind: "control", type: "catalog_control", project_id: "reqalm" };
    const nist = vis({
      relation_kind: "conforms_to",
      direction: "outgoing",
      peer_version_id: "AC-3",
      catalog_imprint_id: "nist-800-53@rev5-dogfood-20261006",
      peer,
    });
    const stig = vis({
      relation_kind: "conforms_to",
      direction: "outgoing",
      peer_version_id: "AC-3",
      catalog_imprint_id: "asd-stig@v6r4",
      peer,
    });
    const brokenKey = (link: VisibleRelationLink) => {
      const sus = link.trace_suspect ? "1" : "0";
      return `${link.peer.project_id}\0${link.peer.id}\0${link.relation_kind}\0${link.direction}\0${sus}`;
    };
    const kept = new Map<string, VisibleRelationLink>();
    for (const link of [nist, stig]) kept.set(brokenKey(link), link);
    assert.equal(kept.size, 1);
    const proper = dedupeVisibleRelationLinks([nist, stig], meta);
    assert.equal(proper.filter((l) => !("restricted" in l)).length, 2);
  });

  it("retains every restricted placeholder", () => {
    const visible = vis({ peer_version_id: "CAP-BROWSE-UI-REQS.1" });
    const restricted = [
      { restricted: true as const, relation_kind: "uses", direction: "incoming" as const },
      { restricted: true as const, relation_kind: "uses", direction: "incoming" as const },
    ];
    const out = dedupeVisibleRelationLinks([...restricted, visible, visible], meta);
    assert.equal(out.filter((l) => "restricted" in l).length, 2);
  });
});
