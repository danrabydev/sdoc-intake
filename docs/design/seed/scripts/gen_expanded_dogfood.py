#!/usr/bin/env python3
"""Generate expanded ReqAML dogfood.yaml covering user-actions A–N."""
from __future__ import annotations
from collections import Counter
from pathlib import Path
import yaml

OUT = Path(__file__).resolve().parent.parent / "dogfood.yaml"
IT0, IT1, IT2 = "iter-r0", "iter-r1", "iter-r2"

class DocDumper(yaml.SafeDumper):
    pass

def _none(self, _):
    return self.represent_scalar("tag:yaml.org,2002:null", "null")

def _str(self, data):
    if "\n" in data or (len(data) > 90 and " " in data):
        return self.represent_scalar("tag:yaml.org,2002:str", data, style=">")
    return self.represent_scalar("tag:yaml.org,2002:str", data)

DocDumper.add_representer(type(None), _none)
DocDumper.add_representer(str, _str)

lines, versions, edges, artifacts = [], [], [], []

def L(base, parent, kind, title):
    lines.append({"base_uid": base, "project_id": "reqaml", "parent": parent, "kind": kind, "title": title})

def V(base, statement, *, n=0, status="active", priority=None, iteration=None, rbac_op=None, security=None):
    uid = base if n == 0 else f"{base}.{n}"
    d = {"uid": uid, "base_uid": base, "version_n": n, "status": status, "statement": statement.strip()}
    if priority is not None: d["priority"] = priority
    if iteration is not None: d["iteration"] = iteration
    if rbac_op is not None: d["rbac_op"] = rbac_op
    if security is not None: d["security"] = security
    versions.append(d)

def S(ref, note):
    return {"catalog_ref": ref, "verification_note": note.strip()}

def R(base, parent, title, statement, *, kind="requirement", **kw):
    L(base, parent, kind, title)
    V(base, statement, **kw)

def E(frm, to, kind):
    edges.append({"from": frm, "to": to, "kind": kind})

# --- Sections ---
SECS = [
    ("SEC-IA", "Identity & Access", "Identity and access actions for ReqAML — SSO sign-in/out, client scoped view, profile, project grant administration, and catalog-steward grants."),
    ("SEC-CP", "Client & Project", "Client owns projects; all project work assumes a Client Scoped View. Client and project CRUD, archive, and permission-filtered listing live here."),
    ("SEC-RL", "Requirement Lines & Versions", "Requirement lines are stable tree nodes; requirement versions hold statement and status. Tree edit, version succession, and lineage viewing live here."),
    ("SEC-EDGE", "Traces & Edges", "Traceability edges connect requirement versions (refines, conforms_to, uses, satisfies). Graph/matrix navigation and edge lifecycle live here."),
    ("SEC-CT", "Contracts", "Contracts are junction overlays that mark requirement versions in_scope_of a named agreement. Document views filter by contract and optionally walk parent lines."),
    ("SEC-REL", "Releases", "Releases snapshot the requirement versions they deliver; they are not tree parents. Planned backlog, ship freeze, and release diff live here."),
    ("SEC-CAT", "Catalogs", "Catalogs provide standard and project templates (NIST families, ReqAML security items). Stewardship, browse, reference, and copy actions live here."),
    ("SEC-CAP", "Capabilities & Artifacts", "Capability packs and attached design artifacts (sequences, C4, mockups, OpenAPI) group how requirements are satisfied in the product."),
    ("SEC-WI", "Work Items & Sync", "Work-item sync bridges requirement versions to external trackers: create, map, push/pull fields, conflict resolution, and disconnect."),
    ("SEC-GROOM", "Grooming & Agile Flow", "Grooming flow turns priority leaves into detailed, WI-ready requirements via parent detail-debt walks and iteration assignment."),
    ("SEC-IO", "Import / Export", "Import/export interchange with StrictDoc and snapshot bills of requirements. PDF/Markdown document export is deferred."),
    ("SEC-AUDIT", "Audit & Ops", "Audit log viewing, OTEL sink configuration, and health/version checks for operators and auditors."),
    ("SEC-UI", "UI Architecture", "React UI ownership chain from App providers through routes, layout, pages, and views, plus chrome that does not write domain data."),
    ("SEC-API", "API Architecture", "Node API layers HTTP adapters, RBAC, business services, audit, and schema-first data providers against Postgres."),
    ("SEC-SEC", "Security / RBAC", "Cross-cutting security controls, NIST/STIG alignment notes, and capability packs for access enforcement."),
    ("SEC-MCP", "MCP agent desks", "MCP agents authenticate like UI users, bind to a requirements desk (browser tab routing), mutate via HTTPS API, and receive live desk pushes on a session-sealed WebSocket."),
]
for uid, title, stmt in SECS:
    L(uid, None, "section", title)
    V(uid, stmt)

print("sections ok", len(SECS))

# --- A Identity ---
R("A01","SEC-IA","Sign in via SSO",
  """A user signs in via enterprise SSO (OIDC or SAML). ReqAML validates the IdP token,
establishes a least-privilege session, loads project grants, and emits an auditable sign-in event.
No local password store exists; MFA is enforced at the IdP. Downstream APIs reject callers without a valid session.""",
  priority=10, iteration=IT0, rbac_op="auth:signin",
  security=S("NIST-IA-2","NIST IA-2 / AC-3 / AU-2/3/12. STIG TBD ASD V6R4. No local passwords; MFA at IdP."))
R("A02","SEC-IA","Sign out",
  """An authenticated user signs out. ReqAML terminates the server session, clears the client session handle,
revokes any desk attachments for that session, and records an auditable logout event.
Subsequent API calls with the old handle receive an unauthorized outcome.""",
  priority=20, iteration=IT0, rbac_op="auth:signout",
  security=S("NIST-AC-12","NIST AC-12 session termination; AU-2/3/12 logout audit. STIG TBD ASD V6R4."))
R("A03","SEC-IA","Select Client Scoped View",
  """An authenticated user selects a Client Scoped View. The active clientId is persisted server-side so
subsequent queries and mutations are bound to that client for least privilege.
The UI App shell reads the bound clientId from the session; client-side-only scope is not authoritative.""",
  priority=10, iteration=IT0, rbac_op="client:scope:select",
  security=S("NIST-AC-3","NIST AC-3/AC-6 least privilege via server-bound scope. STIG TBD ASD V6R4."))
R("A04","SEC-IA","Clear / change Scoped View",
  """A user clears or changes Client Scoped View. ReqAML updates or clears the server-side active client binding,
invalidates client-scoped caches for the prior binding, and audits the scope change.
Project routes that require a scoped client refuse to proceed until a valid view is selected again.""",
  priority=30, iteration=IT0, rbac_op="client:scope:clear",
  security=S("NIST-AC-3","NIST AC-3 access enforcement on scope clear/change. STIG TBD ASD V6R4."))
R("A05","SEC-IA","View own profile / grants",
  """A user views their own profile and project grants. ReqAML returns only the caller's identity record and
grants (no cross-subject disclosure). Grant role names and project ids are included so the UI can render
authorized navigation without a separate admin call.""",
  priority=40, iteration=IT0, rbac_op="identity:read_self",
  security=S("NIST-AC-3","NIST AC-3 self-read boundary; AU for access logging where required. STIG TBD ASD V6R4."))
R("A06","SEC-IA","Invite / link identity",
  """An admin invites or links an identity to a client or project. ReqAML records the external IdP subject
binding, creates or updates the identity row, and audits who linked whom.
Invitation does not by itself grant project roles; grant create (A07) is a separate mutating step.""",
  priority=50, iteration=IT0, rbac_op="identity:link",
  security=S("NIST-IA-2","NIST IA-2/AC-2 account/identity linkage; AU-2/3/12 admin actions. STIG TBD ASD V6R4."))
R("A07","SEC-IA","Grant project role",
  """A project admin grants a role on a project to an identity. ReqAML creates a project_grant row and audits
the grant (actor, subject, role, project). Duplicate active grants for the same identity+role are rejected.
Effective permissions are evaluated on every subsequent mutating API call.""",
  priority=50, iteration=IT0, rbac_op="project:grant:create",
  security=S("NIST-AC-2","NIST AC-2/AC-3/AC-6 grant administration. STIG TBD ASD V6R4."))
R("A08","SEC-IA","Revoke project role",
  """A project admin revokes a project role from an identity. ReqAML removes or tombstones the grant and audits
the revocation. Active sessions for the subject lose the role on the next authorization check;
desk attachments that required the role are detached.""",
  priority=50, iteration=IT0, rbac_op="project:grant:revoke",
  security=S("NIST-AC-2","NIST AC-2/AC-3 revoke path; AU-2/3/12. STIG TBD ASD V6R4."))
R("A09","SEC-IA","Grant catalog-steward role",
  """A client or project admin grants catalog-steward at global, client, or project scope to an identity.
ReqAML records the steward grant at the requested catalog scope and audits actor, subject, and scope.
Only stewards may mutate non-standard catalog entries at their scope; standard catalogs remain read-only.""",
  priority=55, iteration=IT1, rbac_op="catalog:steward:grant",
  security=S("NIST-AC-2","NIST AC-2 account management for steward roles; AU-2/3/12. STIG TBD ASD V6R4."))
R("A10","SEC-IA","Revoke catalog-steward role",
  """An admin revokes a catalog-steward grant. ReqAML tombstones the steward grant and audits the revocation.
The subject immediately loses mutate rights on catalogs at that scope; browse/reference of standards remains allowed per Reader rules.""",
  priority=55, iteration=IT1, rbac_op="catalog:steward:revoke",
  security=S("NIST-AC-2","NIST AC-2/AC-3 steward revoke; AU-2/3/12. STIG TBD ASD V6R4."))
R("A11","SEC-IA","List project access",
  """A project admin or auditor lists who has access to a project. ReqAML returns identity display names,
emails, and active roles filtered by the caller's permission to view grants.
The response is read-only and does not expose other projects' grant tables.""",
  priority=45, iteration=IT1, rbac_op="project:grant:list",
  security=S("NIST-AC-3","NIST AC-3 least disclosure of grant listings; AU optional. STIG TBD ASD V6R4."))
L("A12","SEC-IA","requirement","Impersonate / break-glass (deferred)")
V("A12",
  """Break-glass impersonation was considered for support scenarios. The design rejects in-product impersonation
for R0–R1; support uses IdP break-glass outside ReqAML if ever needed.""",
  n=0, status="withdrawn", priority=90, iteration=IT2, rbac_op="identity:impersonate",
  security=S("NIST-AC-6","Withdrawn: no in-product impersonation. NIST AC-6 least privilege preserved by omission."))
V("A12",
  """Impersonation / break-glass remains out of scope. This active successor documents the permanent deferral:
operators must use IdP-level emergency access; ReqAML will not mint subject-as tokens.
Audit note: any future reconsideration requires a new Security package contract review.""",
  n=1, status="active", priority=90, iteration=IT2,
  security=S("NIST-AC-6","Active deferral record. No rbac_op shipped. STIG TBD ASD V6R4."))

# --- B Client/Project ---
R("B01","SEC-CP","Create client",
  """A client admin creates a new client. ReqAML inserts a client row with stable id and display name,
audits the create, and does not auto-create projects. Project grants remain explicit after create.""",
  priority=20, iteration=IT1, rbac_op="client:create",
  security=S("NIST-AC-3","NIST AC-3 client create gated to client admins. AU-2/3/12."))
R("B02","SEC-CP","Update client metadata",
  """A client admin updates client display name or metadata. ReqAML persists the change without altering
project membership or grants, and audits the before/after fields. Id and created_at are immutable.""",
  priority=40, iteration=IT1, rbac_op="client:update")
R("B03","SEC-CP","Archive / deactivate client",
  """A client admin archives or deactivates a client. ReqAML marks the client inactive, blocks new project
creates under it, and refuses Scoped View selection for archived clients. Existing project data is retained.""",
  priority=60, iteration=IT2, rbac_op="client:archive",
  security=S("NIST-AC-3","Archive blocks new scope binds; AU on archive action."))
R("B04","SEC-CP","Create project under client",
  """With Client Scoped View set, an authorized user creates a project under that client. ReqAML inserts a
project row bound to exactly one client_id, sets status active, and audits the create.
Projects never move between clients after create.""",
  priority=15, iteration=IT0, rbac_op="project:create")
R("B05","SEC-CP","Update project",
  """A project admin updates project name, status notes, or metadata. ReqAML persists the change and audits
mutable fields. client_id is immutable; hierarchy changes are not supported.""",
  priority=40, iteration=IT1, rbac_op="project:update")
R("B06","SEC-CP","Archive project",
  """A project admin archives a project. ReqAML marks the project inactive, blocks new requirement lines and
releases, and keeps historical versions and contracts readable to authorized roles.""",
  priority=60, iteration=IT2, rbac_op="project:archive")
R("B07","SEC-CP","List clients (permission-filtered)",
  """An authenticated user lists clients they are allowed to see. ReqAML returns only clients where the
caller has a grant or client-admin binding — never a global client dump for ordinary users.""",
  priority=25, iteration=IT0, rbac_op="client:list",
  security=S("NIST-AC-3","Permission-filtered list; no cross-tenant leakage."))
R("B08","SEC-CP","List projects in scoped client",
  """With Client Scoped View set, a user lists projects in that client. ReqAML filters to projects the
caller can access (Reader or above). Requests without a server-bound scoped client are rejected.""",
  priority=25, iteration=IT0, rbac_op="project:list")
R("ARCH-CP-HIER","SEC-CP","Client → Project hierarchy",
  """ReqAML organizes work as Client → Project. Projects belong to exactly one client; Client Scoped View
is assumed for most project operations. UI and API both refuse cross-client project joins.""",
  priority=5, iteration=IT0)
R("ARCH-CP-SCOPE","ARCH-CP-HIER","Server-side Scoped View binding",
  """Active clientId lives on the server session (not only in browser local storage). Business services
read the bound clientId when resolving project queries so least privilege cannot be bypassed by crafting URLs.""",
  priority=5, iteration=IT0, rbac_op="client:scope:select",
  security=S("REQAML-SEC-SCOPE","Maps to ReqAML project catalog SCOPE item."))
print("A+B ok", len(lines))

# --- C Tree lines ---
R("C01","SEC-RL","Create requirement line",
  """An Author creates a section, requirement, control, or capability line under a parent line (or as a root
section). ReqAML inserts a requirement_line with stable base_uid, kind, and title; parent is always a line
base_uid (or null). Creating a line does not create a version until the author adds first content (D01).""",
  priority=10, iteration=IT0, rbac_op="requirement:line:create")
R("C02","SEC-RL","Rename / retitle line",
  """An Author renames a line's title. ReqAML updates the line title only; version statements and UIDs are
unchanged. The rename is audited with actor and before/after title.""",
  priority=35, iteration=IT0, rbac_op="requirement:line:retitle")
R("C03","SEC-RL","Move line (change parent)",
  """An Author moves a line to a new parent within the same project. ReqAML updates parent to the target
line base_uid, rejects cycles, and does not cascade-fork versions of ancestors or descendants.
Contracts and releases that reference version UIDs remain valid.""",
  priority=30, iteration=IT1, rbac_op="requirement:line:move")
R("C04","SEC-RL","Reorder siblings",
  """An Author reorders sibling lines under the same parent. ReqAML persists sibling order for outline and
mind-map rendering without changing parent pointers or version content.""",
  priority=45, iteration=IT1, rbac_op="requirement:line:reorder")
R("C05","SEC-RL","Soft-delete / tombstone line",
  """An Author soft-deletes a line via the obsolete-version flow (D05) rather than hard-deleting rows.
ReqAML marks the latest content obsolete/withdrawn as a new version and hides the line from default tree
views while retaining lineage for auditors.""",
  priority=50, iteration=IT1, rbac_op="requirement:line:tombstone")
R("C06","SEC-RL","View tree (mind map / outline)",
  """A Reader views the requirement tree as outline or mind map for the scoped project. ReqAML returns
line hierarchy with current active (or draft) version summaries; obsolete lines are filtered unless requested.""",
  priority=15, iteration=IT0, rbac_op="requirement:tree:read")
R("C07","SEC-RL","Expand / collapse / filter tree",
  """A Reader expands, collapses, or filters the tree by kind, status, or text. Filtering is a view concern;
it does not mutate lines. Filters honor Scoped View and RBAC so unauthorized lines never appear.""",
  priority=40, iteration=IT0, rbac_op="requirement:tree:filter")
R("C08","SEC-RL","Search requirements in client/project",
  """A Reader searches requirement statements and titles within the scoped client/project. ReqAML returns
matching version UIDs with snippets; search never crosses clients even if the caller has multi-client grants.""",
  priority=20, iteration=IT1, rbac_op="requirement:search")

# --- D Versions ---
R("D01","SEC-RL","Create first version of a line",
  """An Author creates the first requirement_version for a line (version_n 0, uid = base_uid). ReqAML stores
statement, status (typically draft), and optional priority/iteration/rbac_op/security metadata.
No in-place overwrite of a published version is allowed afterward — successors use .N.""",
  priority=10, iteration=IT0, rbac_op="requirement:version:create")
R("D02","SEC-RL","Create successor version (.N+1)",
  """An Author creates a successor version with version_n = prior+1 and uid base_uid.N. ReqAML copies or
drafts new statement content; prior versions remain immutable rows. Children stay on the parent line
(parent = base_uid); there is no cascade fork.""",
  priority=10, iteration=IT0, rbac_op="requirement:version:succeed")
R("D03","SEC-RL","Edit draft version fields",
  """An Author edits fields on a draft version (statement, metadata). ReqAML allows mutation only while
status is draft; active/obsolete/withdrawn rows are immutable and require a successor for changes.""",
  priority=15, iteration=IT0, rbac_op="requirement:version:update_draft")
R("D04","SEC-RL","Mark version active",
  """An Author or Release manager marks a draft version active. ReqAML transitions status to active and may
auto-obsolete a prior active version of the same line via a succession rule or explicit obsolete step.
Activation is audited.""",
  priority=20, iteration=IT0, rbac_op="requirement:version:activate")
R("D05","SEC-RL","Mark version obsolete / withdrawn",
  """An Author marks content obsolete or withdrawn by creating a new version with that status (or transitioning
a dedicated successor). ReqAML never silently rewrites an active row's status in place for published history.
Tombstoned lines disappear from default tree views.""",
  priority=35, iteration=IT1, rbac_op="requirement:version:obsolete")
R("D06","SEC-RL","View lineage / succession",
  """A Reader views lineage for a UID — all version_n rows for the base_uid with statuses and timestamps.
The lineage view supports navigation used by mockup 04 (requirement lineage / versions).""",
  priority=25, iteration=IT0, rbac_op="requirement:version:lineage")
R("D07","SEC-RL","Compare two versions",
  """A Reader compares two versions of the same or related UIDs. ReqAML returns a field-level diff of
statements and metadata without mutating either version.""",
  priority=40, iteration=IT1, rbac_op="requirement:version:compare")
R("D08","SEC-RL","Set / clear priority on a version",
  """An Author sets or clears integer priority on a version. Priority feeds grooming queues and release
backlog ordering; clearing removes the version from priority-sorted queues without deleting content.""",
  priority=30, iteration=IT1, rbac_op="requirement:version:priority")
R("D09","SEC-RL","Attach / change iteration on a version",
  """An Author attaches or changes the iteration (sprint window) on a version. ReqAML validates the iteration
belongs to the same project and audits the assignment for work-track views.""",
  priority=30, iteration=IT1, rbac_op="requirement:version:iteration")
R("D10","SEC-RL","Add verification note (tester)",
  """A Tester adds or updates a verification_note on a version's security metadata (or adjacent test note field).
ReqAML records the tester identity and timestamp; Authors cannot silently overwrite tester notes without audit.""",
  priority=45, iteration=IT1, rbac_op="requirement:version:verification_note")
R("D11","SEC-RL","Tag security metadata",
  """A Security reviewer tags catalog_ref and verification guidance on a version. ReqAML stores security
metadata alongside the statement so NIST/STIG alignment travels with the requirement version UID.""",
  priority=35, iteration=IT1, rbac_op="requirement:version:security_tag",
  security=S("NIST-AC-3","Security tagging itself is an audited mutating op."))
R("ARCH-VER","SEC-RL","Static .N requirement versioning",
  """Each requirement line has versions with UIDs base_uid or base_uid.N (static append). Children stay on
the parent line (parent = base_uid); there is no cascade fork. Obsolete/withdrawn is a new version with that status.""",
  priority=5, iteration=IT0)
R("ARCH-VER-SUCC","ARCH-VER","Version succession rules",
  """Succession always increments version_n. uid for version_n 0 is base_uid (or base_uid.0); for n>0 uid is
base_uid.n. Published (active) rows are immutable; edits require a new successor. Exactly one active version
per line is preferred for document views.""",
  priority=5, iteration=IT0)
R("ARCH-VER-TOMB","ARCH-VER","Tombstone via obsolete version",
  """Soft-delete of a line is expressed by an obsolete or withdrawn successor version, not by deleting
requirement_line rows. Historical contracts and releases that delivered prior UIDs remain coherent.""",
  priority=15, iteration=IT1)

# --- E Edges ---
R("E01","SEC-EDGE","Add edge refines",
  """An Author adds a refines edge from one requirement version to another. ReqAML stores from/to version
UIDs and kind=refines, rejects self-edges, and audits the link. Edges never imply tree parenthood.""",
  priority=25, iteration=IT0, rbac_op="edge:create:refines")
R("E02","SEC-EDGE","Add edge conforms_to",
  """An Author or Security reviewer adds a conforms_to edge, typically from a control version to a
requirement or catalog-backed requirement version. ReqAML validates both UIDs exist in the project.""",
  priority=25, iteration=IT0, rbac_op="edge:create:conforms_to")
R("E03","SEC-EDGE","Add edge uses",
  """An Author adds a uses edge when one architecture or capability version depends on another.
ReqAML records the dependency for impact analysis without cascading version forks.""",
  priority=30, iteration=IT1, rbac_op="edge:create:uses")
R("E04","SEC-EDGE","Add edge satisfies",
  """An Author links a capability version to a requirement version via satisfies. ReqAML treats this as
the primary coverage edge for capability packs and regression beds.""",
  priority=20, iteration=IT0, rbac_op="edge:create:satisfies")
R("E05","SEC-EDGE","Remove edge",
  """An Author removes an edge. ReqAML deletes or tombstones the edge row and audits actor, kind, and
endpoints. Requirement versions themselves are unchanged.""",
  priority=40, iteration=IT1, rbac_op="edge:remove")
R("E06","SEC-EDGE","View traceability graph / matrix",
  """A Reader opens a traceability graph or matrix for selected versions. ReqAML returns edges filtered by
Scoped View and RBAC; export of matrix snapshots is optional later.""",
  priority=35, iteration=IT1, rbac_op="edge:matrix:read")
R("E07","SEC-EDGE","Navigate to linked control / capability",
  """From a requirement detail view, a Reader navigates to linked controls and capabilities via edges.
ReqAML resolves satisfies/conforms_to/uses/refines neighbors and opens the target version detail.""",
  priority=35, iteration=IT0, rbac_op="edge:navigate")
print("C+D+E ok", len(lines))

# --- F Contracts (ARCH-CONTRACT succession obsolete→active) ---
L("ARCH-CONTRACT","SEC-CT","requirement","Contracts as overlays")
V("ARCH-CONTRACT",
  """Contracts mark requirements in scope of an agreement. (Initial wording — superseded.)""",
  n=0, status="obsolete", priority=15, iteration=IT0)
V("ARCH-CONTRACT",
  """Contracts are related overlays, not tree parents. A contract links requirement version UIDs via
in_scope_of; document views filter by contract and optionally walk parent lines for context.
Overlapping contracts may share version UIDs; closing a contract does not delete requirement versions.""",
  n=1, status="active", priority=15, iteration=IT0)
R("ARCH-CONTRACT-DOC","ARCH-CONTRACT","Document view walk from contract",
  """Opening a document view from a contract filters to in_scope_of version UIDs and may walk parent lines
to include section context. Toggle include-context-parents controls whether ancestors outside the junction
set are shown for readability (see mockup 03).""",
  priority=20, iteration=IT0)
R("F01","SEC-CT","Create contract",
  """A Project admin or Author creates a contract with name, dates, and status. ReqAML inserts a contract
row as a junction overlay (not a tree parent) and audits the create.""",
  priority=20, iteration=IT0, rbac_op="contract:create")
R("F02","SEC-CT","Update contract metadata",
  """An Author updates contract dates, name, or status (while not closed). ReqAML persists metadata changes
without altering in_scope_of membership unless a separate link/unlink is issued.""",
  priority=35, iteration=IT1, rbac_op="contract:update")
R("F03","SEC-CT","Close contract",
  """A Project admin closes a contract. ReqAML sets status closed and freezes membership edits; requirement
versions remain in the store. Reopening requires an explicit admin action (later policy).""",
  priority=50, iteration=IT2, rbac_op="contract:close")
R("F04","SEC-CT","Link requirement version to contract",
  """An Author links a requirement version UID into a contract's in_scope_of set. ReqAML validates the
version exists in the project and audits the link.""",
  priority=20, iteration=IT0, rbac_op="contract:link")
R("F05","SEC-CT","Unlink requirement version from contract",
  """An Author unlinks a version UID from a contract. ReqAML removes the junction membership and audits
the unlink; the version row is untouched.""",
  priority=35, iteration=IT1, rbac_op="contract:unlink")
R("F06","SEC-CT","Bulk-link versions to contract",
  """An Author bulk-links a set of version UIDs to a contract in one transaction. ReqAML applies all-or-nothing
membership updates and audits the batch size and actor.""",
  priority=40, iteration=IT1, rbac_op="contract:bulk_link")
R("F07","SEC-CT","Open document view from contract",
  """A Reader opens a document view built from a contract. ReqAML filters to in_scope_of versions, optionally
walks parent lines for section context, and renders a readable document (mockup 03).""",
  priority=15, iteration=IT0, rbac_op="contract:document_view")
R("F08","SEC-CT","Toggle include context parents",
  """A Reader toggles whether document view includes ancestor lines outside the contract junction set.
The toggle is a view preference; it does not mutate in_scope_of.""",
  priority=45, iteration=IT1, rbac_op="contract:document_view:context")
R("F09","SEC-CT","View contract overlap timeline",
  """A Reader views overlapping contracts on a timeline by starts_on/ends_on. ReqAML returns contracts for
the scoped client/project so reviewers can see concurrent agreement scopes.""",
  priority=50, iteration=IT2, rbac_op="contract:timeline")
R("F10","SEC-CT","List contracts for client/project",
  """A Reader lists contracts for the scoped client/project. ReqAML returns name, status, and date fields
permission-filtered to the caller's access.""",
  priority=25, iteration=IT0, rbac_op="contract:list")

# --- G Releases ---
R("ARCH-RELEASE","SEC-REL","Releases deliver version snapshots",
  """A release delivers a snapshot of requirement version UIDs. Shipping freezes the delivered set; releases
do not own the requirement tree. Planned releases may be edited until ship.""",
  priority=15, iteration=IT0)
R("ARCH-RELEASE-FREEZE","ARCH-RELEASE","Ship freezes delivered set",
  """On ship, ReqAML freezes the delivers list as an immutable snapshot. Further edits require a new planned
release or an explicit reopen policy (out of scope for R0). Diff against prior shipped releases uses UID sets.""",
  priority=20, iteration=IT1)
R("G01","SEC-REL","Create planned release",
  """A Release manager creates a planned release with name and planned_on date. ReqAML inserts a release
row with empty or seed delivers list and status planned.""",
  priority=20, iteration=IT0, rbac_op="release:create")
R("G02","SEC-REL","Update planned release",
  """A Release manager updates a planned release's name or planned_on. Shipped releases reject metadata
edits that would rewrite history.""",
  priority=35, iteration=IT1, rbac_op="release:update")
R("G03","SEC-REL","Add/remove versions on planned release",
  """A Release manager adds or removes requirement version UIDs on a planned release's delivers set.
ReqAML validates UIDs and rejects mutations on shipped releases.""",
  priority=20, iteration=IT0, rbac_op="release:membership")
R("G04","SEC-REL","Prioritize release backlog from priorities",
  """A Release manager orders the planned release backlog using requirement version priorities. ReqAML
exposes a sorted candidate list; membership changes remain explicit add/remove operations.""",
  priority=40, iteration=IT1, rbac_op="release:prioritize")
R("G05","SEC-REL","Ship release (freeze snapshot)",
  """A Release manager ships a release. ReqAML sets status shipped, records shipped_on, and freezes delivers.
Audit captures the full UID snapshot at ship time.""",
  priority=15, iteration=IT1, rbac_op="release:ship",
  security=S("NIST-AU-2","Ship is a high-value auditable event (AU-2/3/12)."))
R("G06","SEC-REL","View snapshot vs prior release",
  """A Reader diffs a release snapshot against a prior release. ReqAML computes added/removed/unchanged
version UIDs without mutating either release.""",
  priority=35, iteration=IT1, rbac_op="release:diff")
R("G07","SEC-REL","Open Gantt / schedule view",
  """A Reader opens a schedule view derived from releases, priorities, and iterations. ReqAML provides
data for Gantt-style overlays; planning mockups 05* are exploratory and not locked UI.""",
  priority=55, iteration=IT2, rbac_op="release:gantt")
R("G08","SEC-REL","List releases for project",
  """A Reader lists releases for the scoped project. ReqAML returns planned and shipped releases with
dates and status.""",
  priority=25, iteration=IT0, rbac_op="release:list")

# --- H Catalogs ---
R("H01","SEC-CAT","Create catalog",
  """A catalog steward creates a catalog at global, client, or project scope. ReqAML inserts catalog
metadata with is_standard flag; standard catalogs are immutable after publish policy.""",
  priority=40, iteration=IT1, rbac_op="catalog:create")
R("H02","SEC-CAT","Update catalog metadata",
  """A steward updates catalog title or scope metadata where mutable. Standard catalog titles may be
display-only; ReqAML rejects mutations that would rewrite published standard entry ids.""",
  priority=50, iteration=IT1, rbac_op="catalog:update")
R("H03","SEC-CAT","Publish catalog imprint",
  """A steward publishes a catalog version/imprint when versioning is enabled. ReqAML freezes entry ids
for that imprint so requirement security.catalog_ref values remain stable.""",
  priority=55, iteration=IT2, rbac_op="catalog:publish")
R("H04","SEC-CAT","Add catalog item",
  """A steward adds a catalog entry (id + title template) to a mutable catalog. ReqAML rejects duplicate
entry ids within the catalog.""",
  priority=40, iteration=IT1, rbac_op="catalog:entry:add")
R("H05","SEC-CAT","Update catalog item (non-standard)",
  """A steward updates an entry in a non-standard catalog. Standard catalog entries are read-only;
ReqAML returns a conflict if the catalog is_standard.""",
  priority=45, iteration=IT1, rbac_op="catalog:entry:update")
R("H06","SEC-CAT","Reference standard catalog item",
  """An Author references a standard catalog item from a requirement version (security.catalog_ref) without
copying the entry into the project tree. ReqAML stores the reference id only.""",
  priority=25, iteration=IT0, rbac_op="catalog:entry:reference")
R("H07","SEC-CAT","Copy non-standard template into project line",
  """An Author copies a non-standard catalog template into a new project requirement line. ReqAML creates
a line+version with statement seeded from the template; further edits are ordinary version succession.""",
  priority=45, iteration=IT1, rbac_op="catalog:entry:copy")
R("H08","SEC-CAT","Deprecate catalog item",
  """A steward deprecates a catalog item. ReqAML marks the entry deprecated for browse UI; existing
requirement references remain valid for history.""",
  priority=55, iteration=IT2, rbac_op="catalog:entry:deprecate")
R("H09","SEC-CAT","Browse catalogs at current scope",
  """A Reader browses catalogs available at the current Scoped View (global + client + project).
ReqAML merges visible catalogs without exposing other clients' project catalogs.""",
  priority=30, iteration=IT0, rbac_op="catalog:browse")
print("F+G+H ok", len(lines))

# --- I Capabilities ---
R("I01","SEC-CAP","Create capability line",
  """An Author creates a capability-kind line (or promotes a requirement to capability packaging).
ReqAML inserts kind=capability; content still lives on versions.""",
  priority=25, iteration=IT0, rbac_op="capability:create")
R("I02","SEC-CAP","Link capability satisfies requirement",
  """An Author links a capability version to a requirement via satisfies (see also E04). ReqAML ensures
the edge is the coverage record used by packs and future regression beds.""",
  priority=20, iteration=IT0, rbac_op="capability:satisfies")
R("I03","SEC-CAP","Attach artifact URI",
  """An Author attaches an artifact (OpenAPI, wireframe, mock, other) URI to a capability or architecture
version. ReqAML stores kind+uri rows; URIs should point at repo-relative design assets when possible.""",
  priority=30, iteration=IT0, rbac_op="capability:artifact:attach")
R("I04","SEC-CAP","Update / replace artifact URI",
  """An Author updates or replaces an artifact URI on a version. ReqAML audits before/after URI; kind may
change if the asset type changes.""",
  priority=45, iteration=IT1, rbac_op="capability:artifact:update")
R("I05","SEC-CAP","Remove artifact",
  """An Author removes an artifact attachment. ReqAML deletes the artifact row; the capability version remains.""",
  priority=50, iteration=IT1, rbac_op="capability:artifact:remove")
R("I06","SEC-CAP","View capability pack grouping",
  """A Reader views capability pack / regression-bed grouping (later). ReqAML returns capabilities with
their satisfies edges and artifacts for pack review; full regression automation is deferred.""",
  priority=70, iteration=IT2, rbac_op="capability:pack:view")
R("CAP-SSO","SEC-SEC","Federated SSO session",
  """Capability pack for federated SSO session establishment and teardown against the enterprise IdP.
Covers sign-in and sign-out paths used by UI and MCP hosts.""",
  kind="capability", priority=10, iteration=IT0)
R("CAP-SCOPED-VIEW","SEC-SEC","Client Scoped View binding",
  """Capability pack for selecting, clearing, and binding Client Scoped View on the server session.
UI App providers consume the bound clientId for navigation guards.""",
  kind="capability", priority=10, iteration=IT0)
R("CAP-RBAC","SEC-SEC","Project RBAC grants",
  """Capability pack for project_grant create/revoke/list and permission checks used by business services
on every mutating API.""",
  kind="capability", priority=10, iteration=IT0)
R("CAP-MCP-DESK","SEC-MCP","ReqAML MCP requirements desk channel",
  """Capability pack for ReqAML MCP server, desk list/attach, and session-sealed desk WebSocket.
Mutations stay on HTTPS; the desk socket is push-only.""",
  kind="capability", priority=10, iteration=IT0, status="draft")
R("CAP-TREE","SEC-CAP","Requirement tree editing pack",
  """Capability pack covering line create/move/reorder, tree views, and search for the requirements shell
(mockup 01).""",
  kind="capability", priority=15, iteration=IT0)
R("CAP-CONTRACT-UI","SEC-CAP","Contracts & document view pack",
  """Capability pack for contract list/detail and document view from contract (mockups 02–03).""",
  kind="capability", priority=15, iteration=IT0)
R("CAP-VERSION-UI","SEC-CAP","Version lineage pack",
  """Capability pack for version succession, lineage, and compare UX (mockup 04).""",
  kind="capability", priority=15, iteration=IT0)
R("CAP-AUDIT","SEC-AUDIT","Audit & OTEL pack",
  """Capability pack for entity/client audit log reads and OTEL export configuration used by auditors and ops.""",
  kind="capability", priority=25, iteration=IT1)

# --- J Work items ---
R("J01","SEC-WI","Mark requirement ready for work item",
  """An Author marks a requirement version ready for work-item creation (grooming state WI-ready).
ReqAML records readiness metadata used by J02; it does not create the external ticket yet.""",
  priority=30, iteration=IT1, rbac_op="workitem:mark_ready")
R("J02","SEC-WI","Create work item from requirement version",
  """An Author or Developer creates an external work item from a requirement version. ReqAML stores the
link mapping (external id, system) and seeds the ticket summary from the statement.""",
  priority=25, iteration=IT1, rbac_op="workitem:create")
R("J03","SEC-WI","Update work item link mapping",
  """An Author updates the mapping between a requirement version and an external work item id.
ReqAML audits remaps; orphaned external tickets are not auto-deleted.""",
  priority=45, iteration=IT2, rbac_op="workitem:remap")
R("J04","SEC-WI","Push field changes req → work item",
  """An Author pushes selected field changes from a requirement version to the linked work item.
ReqAML records last-push timestamp and which fields synced.""",
  priority=40, iteration=IT2, rbac_op="workitem:push")
R("J05","SEC-WI","Pull field changes work item → req",
  """An Author pulls selected fields from the work item back into a draft requirement successor when needed.
Pull into active immutable versions is rejected; succession rules apply.""",
  priority=40, iteration=IT2, rbac_op="workitem:pull")
R("J06","SEC-WI","Resolve sync conflict",
  """When push/pull detects conflicting edits, an Author resolves the conflict by choosing req, work item,
or manual merge into a new draft successor. ReqAML audits the resolution choice.""",
  priority=50, iteration=IT2, rbac_op="workitem:conflict_resolve")
R("J07","SEC-WI","View sync status / last sync",
  """A Reader views sync status and last sync timestamps for a requirement–work-item link.""",
  priority=45, iteration=IT1, rbac_op="workitem:status")
R("J08","SEC-WI","Disconnect work item link",
  """An Author disconnects a work-item link. ReqAML removes the mapping and audits the disconnect;
the external ticket is left as-is.""",
  priority=50, iteration=IT2, rbac_op="workitem:disconnect")

# --- K Grooming ---
R("K01","SEC-GROOM","Open priority queue",
  """An Author opens the priority queue (“what to groom next”). ReqAML returns versions with priority set,
sorted for grooming, filtered by Scoped View and project.""",
  priority=20, iteration=IT1, rbac_op="groom:queue")
R("K02","SEC-GROOM","Walk parent detail-debt",
  """From a priority leaf, an Author walks parent detail-debt to see which ancestors need richer statements
before the leaf is WI-ready. ReqAML returns ancestor versions lacking detail markers.""",
  priority=30, iteration=IT1, rbac_op="groom:detail_debt")
R("K03","SEC-GROOM","Advance grooming state",
  """An Author advances grooming state along want → detailed → WI-ready. ReqAML stores grooming state on
the version (or adjacent metadata) and audits transitions.""",
  priority=25, iteration=IT1, rbac_op="groom:advance")
R("K04","SEC-GROOM","Assign iteration / sprint",
  """An Author assigns an iteration/sprint on a version during grooming (overlaps D09). ReqAML validates
project membership of the iteration.""",
  priority=30, iteration=IT1, rbac_op="groom:assign_iteration")
R("K05","SEC-GROOM","View work track by iteration",
  """A Reader views the work track for an iteration — versions assigned to that window with grooming state
and priorities.""",
  priority=35, iteration=IT1, rbac_op="groom:work_track")
R("K06","SEC-GROOM","View release path vs work track",
  """A Reader compares release delivers membership against the iteration work track to spot gaps
(planned release vs groomed work).""",
  priority=45, iteration=IT2, rbac_op="groom:release_path")

# --- L Import/export ---
R("L01","SEC-IO","Import StrictDoc / notation file",
  """An Author imports a StrictDoc (.sdoc) or approved notation file into a project. ReqAML maps sections
and requirements into lines+versions without treating StrictDoc as the system of record afterward.""",
  priority=40, iteration=IT1, rbac_op="io:import:strictdoc")
R("L02","SEC-IO","Export project or contract to StrictDoc",
  """An Author exports a project tree or contract document view to StrictDoc interchange. ReqAML emits
.sdoc suitable for external tools; Postgres remains authoritative.""",
  priority=35, iteration=IT0, rbac_op="io:export:strictdoc")
R("L03","SEC-IO","Export document view (PDF/Markdown) — later",
  """Export of document view to PDF/Markdown is deferred past R1. This requirement records the intent
without committing R0 delivery.""",
  priority=80, iteration=IT2, rbac_op="io:export:document", status="draft")
R("L04","SEC-IO","Export snapshot bill of requirements",
  """A Release manager exports a bill of requirements for a release snapshot (delivered version UIDs +
statements). ReqAML generates a stable artifact for review packages.""",
  priority=40, iteration=IT1, rbac_op="io:export:snapshot")

# --- M Audit ---
R("M01","SEC-AUDIT","View audit log for an entity",
  """An Auditor or Project admin views the audit log for a specific entity (requirement version, grant,
contract, etc.). ReqAML returns structured events with actor, action, and timestamps.""",
  priority=30, iteration=IT1, rbac_op="audit:entity:read",
  security=S("NIST-AU-2","AU-2/3/6/12 event review."))
R("M02","SEC-AUDIT","View audit log for a client",
  """An Auditor views audit events across a client (permission-gated). ReqAML never returns other clients'
events even for platform operators without explicit break-glass outside product.""",
  priority=35, iteration=IT1, rbac_op="audit:client:read",
  security=S("NIST-AU-6","AU-6 audit review; cross-client isolation."))
R("M03","SEC-AUDIT","Configure OTEL / log sinks",
  """An operator configures OTEL/OTLP endpoints and log sinks. ReqAML stores sink configuration and
validates connectivity without exposing sink credentials in API responses.""",
  priority=50, iteration=IT2, rbac_op="ops:otel:configure",
  security=S("NIST-AU-12","AU-12 audit generation pipeline config."))
R("M04","SEC-AUDIT","Health check / read API version",
  """Any authenticated caller (or public probe per deploy policy) reads health and API version.
ReqAML returns liveness/readiness without leaking client data.""",
  priority=20, iteration=IT0, rbac_op="ops:health")
R("ARCH-OTEL","SEC-API","OTEL audit trail",
  """Security-relevant actions emit structured audit events exported via OTEL (OTLP) for centralized
review, aligned to NIST AU families and STIG TBD ASD V6R4.""",
  priority=25, iteration=IT0, security=S("NIST-AU-2","NIST AU-2/3/6/12. STIG TBD ASD V6R4."))

# --- N UI chrome + ARCH-UI ---
R("N01","SEC-UI","Toggle mind-map vs tree vs document view",
  """A Reader toggles among mind-map, tree outline, and document views. The toggle is chrome-only and
does not write domain data; underlying queries still honor Scoped View and RBAC.""",
  priority=30, iteration=IT0, rbac_op="ui:view_mode")
R("N02","SEC-UI","Pin favorite contract / project",
  """A Reader pins a favorite contract or project for quick navigation. Pins are per-user preferences
stored server-side or in user settings without altering domain junctions.""",
  priority=50, iteration=IT1, rbac_op="ui:pin")
R("N03","SEC-UI","Use global search",
  """A Reader uses global search across titles and statements in the scoped client. Results deep-link to
requirement detail; search does not mutate data.""",
  priority=25, iteration=IT1, rbac_op="ui:global_search")
R("ARCH-UI","SEC-UI","App → Routes → Layout → Page → View",
  """UI stack is App (auth + ClientScope) → Routes + guards → Layout → Page → View → pure components,
with optional stores scoped by clientId. Pages own data fetching; views stay presentational where practical.""",
  priority=20, iteration=IT0)
R("ARCH-UI-GUARD","ARCH-UI","Route guards enforce session + scope",
  """Protected shell routes require a valid session and, for project pages, a server-bound Client Scoped View.
Guards redirect to sign-in or scope selection rather than rendering empty shells with client-side-only checks.""",
  priority=15, iteration=IT0, security=S("NIST-AC-3","Route guards are AC-3 enforcement in the UI shell."))

# --- API ---
R("ARCH-API","SEC-API","HTTP → business → data, OpenAPI schema-first",
  """API is schema-first (Zod + OpenAPI): HTTP adapters validate DTOs, RBAC authorizes, business services
orchestrate, data providers implement repositories against Postgres.""",
  priority=20, iteration=IT0)
R("ARCH-API-RBAC","ARCH-API","RBAC on every mutating API",
  """Every mutating business operation checks project_grant (and steward grants where applicable) before
writes. Denied calls return a consistent unauthorized/forbidden outcome and emit an audit event.""",
  priority=10, iteration=IT0, rbac_op="rbac:authorize",
  security=S("REQAML-SEC-RBAC","Maps to ReqAML RBAC catalog item."))
R("ARCH-API-LAYERS","ARCH-API","Layering: adapter → service → repository",
  """HTTP adapters do not embed SQL. Business services own orchestration and authorization calls; repositories
own persistence. This layering is mandatory for MCP tools and UI clients alike.""",
  priority=20, iteration=IT0)

# --- Controls ---
R("CTL-AC-3","SEC-SEC","Enforce access control on routes and APIs",
  """Route guards and API RBAC enforce authorized access for every protected shell route and mutating
operation; unauthorized callers receive a denied outcome that is auditable.""",
  kind="control", priority=10, iteration=IT0,
  security=S("NIST-AC-3","Conforms to NIST AC-3 (Access Enforcement). STIG TBD ASD V6R4."))
R("CTL-AU-2","SEC-SEC","Audit event generation",
  """ReqAML generates audit events for security-relevant actions (sign-in/out, grants, scope changes,
requirement mutations, release ship, catalog steward changes). Events include actor, action, target, and time.""",
  kind="control", priority=15, iteration=IT0,
  security=S("NIST-AU-2","NIST AU-2/3/12 event content. STIG TBD ASD V6R4."))
R("CTL-IA-2","SEC-SEC","Identification via enterprise SSO",
  """Users and MCP hosts identify via enterprise SSO only. ReqAML does not store local passwords;
identity is bound to IdP subject (external_sub) on the identity row.""",
  kind="control", priority=10, iteration=IT0,
  security=S("NIST-IA-2","NIST IA-2 organizational users. STIG TBD ASD V6R4."))
R("CTL-SC-8","SEC-SEC","Protect transmission confidentiality",
  """All UI, API, and MCP HTTP traffic uses TLS. Desk WebSockets are session-sealed WSS. ReqAML rejects
cleartext endpoints in production deployments.""",
  kind="control", priority=15, iteration=IT0,
  security=S("NIST-SC-8","NIST SC-8 transmission confidentiality. STIG TBD ASD V6R4."))

# --- MCP ---
R("MC01","SEC-MCP","MCP authenticate session & desk bind",
  """An MCP host connects to ReqAML MCP (stdio or Streamable HTTP), establishes a platform session
(OAuth opaque token or login aligned with A01), lists desks, and attach/detach routing to a browser
requirements desk; live pushes use session-sealed WSS.""",
  priority=60, iteration=IT0, status="draft",
  rbac_op="mcp:session:create, desk:list, desk:attach, desk:detach",
  security=S("NIST-SC-8","NIST IA/AC/AU/SC; desk sealing pattern (OC ADR 0018 analogue). STIG TBD ASD V6R4."))
V("MC01",
  """An MCP host authenticates with the same enterprise identity path as UI users (A01-aligned), lists
requirements desks, and attaches to exactly one desk for live preview. Session tokens are opaque; desk
WebSocket traffic is sealed to the session. Mutating tools are not exposed on the desk socket.""",
  n=1, status="draft", priority=55, iteration=IT1,
  rbac_op="mcp:session:create, desk:list, desk:attach, desk:detach",
  security=S("NIST-SC-8","Draft successor refining desk-seal wording. STIG TBD ASD V6R4."))
R("MC02","SEC-MCP","MCP mutating tool with desk attached",
  """With a desk attached, an MCP tool updates a draft requirement version field over HTTPS
(HTTP→business→data→Postgres), audits the agent write, and pushes preview to the desk channel.
Mutations never travel on the desk WebSocket.""",
  priority=60, iteration=IT0, status="draft",
  rbac_op="requirement:version:update_draft",
  security=S("NIST-AC-3","NIST AC-3/CM-3/AU; mutations not on desk socket. STIG TBD ASD V6R4."))
R("MC03","SEC-MCP","MCP tool RBAC mirrors UI permissions",
  """MCP tools enforce the same project_grant checks as UI/API callers for the authenticated identity.
An agent cannot escalate privileges by using MCP; denied tools return structured errors and audit events.""",
  priority=55, iteration=IT1, status="draft",
  rbac_op="mcp:authorize",
  security=S("REQAML-SEC-RBAC","MCP uses same RBAC pack as UI."))
print("I-N+ARCH+CTL+MCP ok", len(lines), len(versions))

# --- Artifacts ---
artifacts.extend([
    {"requirement_version_uid": "CAP-SSO", "kind": "other", "uri": "../c4/sequences/A01-sign-in-sso.puml"},
    {"requirement_version_uid": "CAP-SSO", "kind": "other", "uri": "../c4/sequences/A02-sign-out.puml"},
    {"requirement_version_uid": "CAP-SCOPED-VIEW", "kind": "other", "uri": "../c4/sequences/A03-select-client-scoped-view.puml"},
    {"requirement_version_uid": "CAP-SCOPED-VIEW", "kind": "other", "uri": "../c4/sequences/A04-clear-change-scoped-view.puml"},
    {"requirement_version_uid": "CAP-RBAC", "kind": "other", "uri": "../c4/sequences/A07-grant-project-role.puml"},
    {"requirement_version_uid": "CAP-RBAC", "kind": "other", "uri": "../c4/sequences/A08-revoke-project-role.puml"},
    {"requirement_version_uid": "A05", "kind": "other", "uri": "../c4/sequences/A05-view-own-profile-grants.puml"},
    {"requirement_version_uid": "A06", "kind": "other", "uri": "../c4/sequences/A06-invite-link-identity.puml"},
    {"requirement_version_uid": "ARCH-API", "kind": "openapi", "uri": "future://reqaml/openapi.yaml"},
    {"requirement_version_uid": "ARCH-API", "kind": "other", "uri": "../c4/L3-api-components.puml"},
    {"requirement_version_uid": "ARCH-UI", "kind": "wireframe", "uri": "../c4/L3-ui-components.puml"},
    {"requirement_version_uid": "ARCH-CP-HIER", "kind": "other", "uri": "../c4/L1-system-context.puml"},
    {"requirement_version_uid": "ARCH-API", "kind": "other", "uri": "../c4/L2-containers.puml"},
    {"requirement_version_uid": "ARCH-VER", "kind": "other", "uri": "../c4/data-erd.puml"},
    {"requirement_version_uid": "MC01.1", "kind": "other", "uri": "../c4/sequences/MC01-mcp-auth-desk-bind.puml"},
    {"requirement_version_uid": "MC02", "kind": "other", "uri": "../c4/sequences/MC02-mcp-mutate-requirement-version.puml"},
    {"requirement_version_uid": "CAP-TREE", "kind": "mock", "uri": "../mockups/01-requirements-tree-detail.jpg"},
    {"requirement_version_uid": "CAP-CONTRACT-UI", "kind": "mock", "uri": "../mockups/02-contracts-list-detail.jpg"},
    {"requirement_version_uid": "CAP-CONTRACT-UI", "kind": "mock", "uri": "../mockups/03-document-view-from-contract.jpg"},
    {"requirement_version_uid": "CAP-VERSION-UI", "kind": "mock", "uri": "../mockups/04-requirement-lineage-versions.jpg"},
    {"requirement_version_uid": "F07", "kind": "mock", "uri": "../mockups/03-document-view-from-contract.jpg"},
    {"requirement_version_uid": "D06", "kind": "mock", "uri": "../mockups/04-requirement-lineage-versions.jpg"},
    {"requirement_version_uid": "C06", "kind": "mock", "uri": "../mockups/01-requirements-tree-detail.jpg"},
])

# --- Edges ---
for a in ["A01", "A02"]:
    E("CAP-SSO", a, "satisfies")
for a in ["A03", "A04"]:
    E("CAP-SCOPED-VIEW", a, "satisfies")
for a in ["A05", "A06", "A07", "A08", "A09", "A10", "A11"]:
    E("CAP-RBAC", a, "satisfies")
E("CAP-MCP-DESK", "MC01.1", "satisfies")
E("CAP-MCP-DESK", "MC02", "satisfies")
E("CAP-MCP-DESK", "MC03", "satisfies")
E("CAP-TREE", "C01", "satisfies")
E("CAP-TREE", "C06", "satisfies")
E("CAP-TREE", "C08", "satisfies")
E("CAP-CONTRACT-UI", "F01", "satisfies")
E("CAP-CONTRACT-UI", "F07", "satisfies")
E("CAP-CONTRACT-UI", "F10", "satisfies")
E("CAP-VERSION-UI", "D02", "satisfies")
E("CAP-VERSION-UI", "D06", "satisfies")
E("CAP-VERSION-UI", "D07", "satisfies")
E("CAP-AUDIT", "M01", "satisfies")
E("CAP-AUDIT", "M02", "satisfies")
E("CAP-AUDIT", "ARCH-OTEL", "satisfies")
E("CTL-AC-3", "A01", "conforms_to")
E("CTL-AC-3", "A03", "conforms_to")
E("CTL-AC-3", "A07", "conforms_to")
E("CTL-AC-3", "B07", "conforms_to")
E("CTL-AC-3", "ARCH-API-RBAC", "conforms_to")
E("CTL-IA-2", "A01", "conforms_to")
E("CTL-IA-2", "CAP-SSO", "conforms_to")
E("CTL-AU-2", "ARCH-OTEL", "conforms_to")
E("CTL-AU-2", "M01", "conforms_to")
E("CTL-AU-2", "G05", "conforms_to")
E("CTL-SC-8", "MC01.1", "conforms_to")
E("CTL-SC-8", "A01", "conforms_to")
E("ARCH-UI", "ARCH-CP-HIER", "uses")
E("ARCH-UI", "ARCH-UI-GUARD", "uses")
E("ARCH-API", "ARCH-VER", "uses")
E("ARCH-API", "ARCH-API-RBAC", "uses")
E("ARCH-API", "ARCH-API-LAYERS", "uses")
E("ARCH-OTEL", "A01", "refines")
E("ARCH-OTEL", "G05", "refines")
E("A03", "ARCH-CP-HIER", "refines")
E("A03", "ARCH-CP-SCOPE", "refines")
E("ARCH-CP-SCOPE", "CAP-SCOPED-VIEW", "uses")
E("MC02", "ARCH-API", "uses")
E("MC02", "D03", "uses")
E("MC01.1", "A01", "refines")
E("MC03", "CAP-RBAC", "uses")
E("ARCH-CONTRACT.1", "ARCH-CONTRACT-DOC", "uses")
E("F07", "ARCH-CONTRACT-DOC", "refines")
E("F07", "ARCH-CONTRACT.1", "uses")
E("G05", "ARCH-RELEASE-FREEZE", "refines")
E("D02", "ARCH-VER-SUCC", "refines")
E("C05", "ARCH-VER-TOMB", "refines")
E("D05", "ARCH-VER-TOMB", "uses")
E("C03", "ARCH-VER", "uses")
E("L02", "ARCH-CONTRACT.1", "uses")
E("L04", "ARCH-RELEASE", "uses")
E("K01", "D08", "uses")
E("K03", "J01", "uses")
E("J02", "D04", "uses")
E("I02", "E04", "refines")
E("H06", "D11", "uses")
E("N01", "C06", "uses")
E("N03", "C08", "uses")
E("B04", "ARCH-CP-HIER", "refines")
E("B08", "A03", "uses")
E("CAP-RBAC", "ARCH-API-RBAC", "satisfies")
E("E04", "I02", "uses")
E("A12.1", "CTL-AC-3", "conforms_to")
E("D11", "CTL-AC-3", "conforms_to")
E("M03", "ARCH-OTEL", "uses")
E("F04", "ARCH-CONTRACT.1", "uses")
E("G03", "ARCH-RELEASE", "uses")

design_uids = [
    "A01","A02","A03","A04","A05","A06","A07","A08","A09","A10","A11","A12.1",
    "B01","B04","B07","B08","C01","C03","C06","C08","D01","D02","D03","D04","D06",
    "E01","E02","E04","F01","F04","F07","F10","G01","G03","G05","G08","H06","H09",
    "I01","I03","ARCH-CP-HIER","ARCH-CP-SCOPE","ARCH-VER","ARCH-VER-SUCC",
    "ARCH-CONTRACT.1","ARCH-CONTRACT-DOC","ARCH-RELEASE","ARCH-RELEASE-FREEZE",
    "ARCH-UI","ARCH-UI-GUARD","ARCH-API","ARCH-API-RBAC","ARCH-API-LAYERS","ARCH-OTEL",
    "CTL-AC-3","CTL-IA-2","CTL-AU-2","CTL-SC-8",
    "CAP-SSO","CAP-SCOPED-VIEW","CAP-RBAC","CAP-TREE","CAP-CONTRACT-UI","CAP-VERSION-UI",
    "MC01.1","MC02","MC03",
]
security_uids = [
    "A01","A02","A03","A04","A06","A07","A08","A09","A10","A11","A12.1",
    "ARCH-CP-SCOPE","ARCH-API-RBAC","ARCH-OTEL","ARCH-UI-GUARD",
    "CTL-AC-3","CTL-IA-2","CTL-AU-2","CTL-SC-8",
    "CAP-SSO","CAP-SCOPED-VIEW","CAP-RBAC","CAP-MCP-DESK","CAP-AUDIT",
    "MC01.1","MC02","MC03","M01","M02","M03","D11","H06",
]
platform_uids = [
    "A01","A03","B04","B07","B08","C01","C06","D01","D02","D03","D04",
    "ARCH-CP-HIER","ARCH-VER","ARCH-API","ARCH-API-LAYERS","ARCH-UI",
    "CAP-SSO","CAP-SCOPED-VIEW","CAP-RBAC","CAP-TREE","CTL-AC-3","CTL-IA-2",
    "L02","M04","N01",
]

contracts = [
    {"id":"contract-design-2026-10","client_id":"raby-family","project_id":"reqaml","name":"Design-2026-10",
     "starts_on":"2026-10-06","ends_on":None,"status":"active","in_scope_of":design_uids},
    {"id":"contract-security-package","client_id":"raby-family","project_id":"reqaml","name":"Security package",
     "starts_on":"2026-10-06","ends_on":None,"status":"active","in_scope_of":security_uids},
    {"id":"contract-platform-baseline","client_id":"raby-family","project_id":"reqaml","name":"Platform baseline",
     "starts_on":"2026-10-01","ends_on":"2026-12-31","status":"active","in_scope_of":platform_uids},
]

releases = [
    {"id":"rel-r0-sequences","project_id":"reqaml","name":"R0-sequences","planned_on":"2026-10-15",
     "shipped_on":"2026-10-06","status":"shipped",
     "delivers":["A01","A02","A03","A04","A05","A06","A07","A08","ARCH-CP-HIER","ARCH-VER","ARCH-UI",
                 "ARCH-API","ARCH-OTEL","CTL-AC-3","CAP-SSO","CAP-SCOPED-VIEW","CAP-RBAC","MC01.1","MC02"]},
    {"id":"rel-r1-core-alm","project_id":"reqaml","name":"R1-core-ALM","planned_on":"2026-11-30",
     "shipped_on":None,"status":"planned",
     "delivers":["A09","A10","A11","A12.1","B01","B04","B05","B07","B08","C01","C02","C03","C06","C08",
                 "D01","D02","D03","D04","D05","D06","D08","D09","E01","E02","E04","E06",
                 "F01","F04","F07","F10","G01","G03","G05","G08","H06","H09","I01","I03",
                 "J01","J02","J07","K01","K03","K05","L01","L02","L04","M01","M04","N01","N03",
                 "ARCH-CONTRACT.1","ARCH-RELEASE","ARCH-VER-SUCC","CAP-TREE","CAP-CONTRACT-UI",
                 "CAP-VERSION-UI","CAP-AUDIT","CTL-AU-2","CTL-IA-2","CTL-SC-8","MC03"]},
]

doc = {
    "schema_version": "2026-10-06",
    "client": {"id":"raby-family","name":"Raby-Family","created_at":"2026-10-06T00:00:00-04:00"},
    "projects": [{"id":"reqaml","client_id":"raby-family","name":"ReqAML","status":"active",
                  "notes":"Requirements/ALM product replacing StrictDoc-as-store. Current intake / diagram repo often called sdoc-intake."}],
    "identities": [
        {"id":"dan","external_sub":"oidc:dan-raby","email":"dan@therabyfamily.com","display_name":"Dan Raby"},
        {"id":"alex-author","external_sub":"oidc:alex-author","email":"alex.author@therabyfamily.com","display_name":"Alex Author"},
        {"id":"sam-security","external_sub":"oidc:sam-security","email":"sam.security@therabyfamily.com","display_name":"Sam Security"},
        {"id":"taylor-tester","external_sub":"oidc:taylor-tester","email":"taylor.tester@therabyfamily.com","display_name":"Taylor Tester"},
        {"id":"riley-release","external_sub":"oidc:riley-release","email":"riley.release@therabyfamily.com","display_name":"Riley Release"},
        {"id":"casey-reader","external_sub":"oidc:casey-reader","email":"casey.reader@therabyfamily.com","display_name":"Casey Reader"},
    ],
    "project_grants": [
        {"id":"grant-dan-reqaml-author","project_id":"reqaml","identity_id":"dan","role":"Author"},
        {"id":"grant-dan-reqaml-admin","project_id":"reqaml","identity_id":"dan","role":"Project admin"},
        {"id":"grant-alex-author","project_id":"reqaml","identity_id":"alex-author","role":"Author"},
        {"id":"grant-sam-security","project_id":"reqaml","identity_id":"sam-security","role":"Security"},
        {"id":"grant-taylor-tester","project_id":"reqaml","identity_id":"taylor-tester","role":"Tester"},
        {"id":"grant-riley-release","project_id":"reqaml","identity_id":"riley-release","role":"Release manager"},
        {"id":"grant-casey-reader","project_id":"reqaml","identity_id":"casey-reader","role":"Reader"},
    ],
    "catalogs": [
        {"id":"cat-nist-global","scope":"global","client_id":None,"project_id":None,
         "title":"NIST SP 800-53 Rev5 (selected controls)","is_standard":True,
         "entries":[
            {"id":"NIST-AC","title":"Access Control (AC) family"},
            {"id":"NIST-AC-2","title":"AC-2 Account Management"},
            {"id":"NIST-AC-3","title":"AC-3 Access Enforcement"},
            {"id":"NIST-AC-6","title":"AC-6 Least Privilege"},
            {"id":"NIST-AC-12","title":"AC-12 Session Termination"},
            {"id":"NIST-AU","title":"Audit and Accountability (AU) family"},
            {"id":"NIST-AU-2","title":"AU-2 Event Logging"},
            {"id":"NIST-AU-3","title":"AU-3 Content of Audit Records"},
            {"id":"NIST-AU-6","title":"AU-6 Audit Record Review"},
            {"id":"NIST-AU-12","title":"AU-12 Audit Record Generation"},
            {"id":"NIST-IA","title":"Identification and Authentication (IA) family"},
            {"id":"NIST-IA-2","title":"IA-2 Identification and Authentication (Organizational Users)"},
            {"id":"NIST-SC","title":"System and Communications Protection (SC) family"},
            {"id":"NIST-SC-8","title":"SC-8 Transmission Confidentiality and Integrity"},
         ]},
        {"id":"cat-reqaml-security","scope":"project","client_id":"raby-family","project_id":"reqaml",
         "title":"ReqAML project security catalog","is_standard":False,
         "entries":[
            {"id":"REQAML-SEC-SSO","title":"Enterprise SSO only (no local passwords)"},
            {"id":"REQAML-SEC-SCOPE","title":"Server-side client scoped view"},
            {"id":"REQAML-SEC-RBAC","title":"Permission checks on every mutating API"},
            {"id":"REQAML-SEC-MCP","title":"MCP desk OC-style session sealing; mutations on HTTPS only"},
            {"id":"REQAML-SEC-AUDIT","title":"OTEL-exported audit for security-relevant actions"},
            {"id":"REQAML-SEC-CATALOG","title":"Standard catalog reference without copy; steward-gated edits"},
         ]},
    ],
    "iterations": [
        {"id":"iter-r0","project_id":"reqaml","name":"R0 design sequences","starts_on":"2026-10-01","ends_on":"2026-10-31"},
        {"id":"iter-r1","project_id":"reqaml","name":"R1 core ALM","starts_on":"2026-11-01","ends_on":"2026-11-30"},
        {"id":"iter-r2","project_id":"reqaml","name":"R2 sync & polish","starts_on":"2026-12-01","ends_on":"2026-12-31"},
    ],
    "requirement_lines": lines,
    "requirement_versions": versions,
    "capability_artifacts": artifacts,
    "edges": edges,
    "contracts": contracts,
    "releases": releases,
}

# Sanity checks
base = {x["base_uid"] for x in lines}
for v in versions:
    assert v["base_uid"] in base, v["uid"]
vc = Counter(v["base_uid"] for v in versions)
missing = [x["base_uid"] for x in lines if vc[x["base_uid"]] == 0]
assert not missing, missing
vuids = {v["uid"] for v in versions}
for e in edges:
    assert e["from"] in vuids and e["to"] in vuids, e
for c in contracts:
    for u in c["in_scope_of"]:
        assert u in vuids, (c["name"], u)
for r in releases:
    for u in r["delivers"]:
        assert u in vuids, (r["name"], u)
for a in artifacts:
    assert a["requirement_version_uid"] in vuids, a

header = """# ReqAML dogfood seed — design ReqAML with ReqAML
# Schema: locked 2026-10-06 ERD (../c4/data-erd.puml)
# Expanded coverage of user-actions.md groups A–N (2026-10-06)
"""
with OUT.open("w", encoding="utf-8") as f:
    f.write(header)
    yaml.dump(doc, f, Dumper=DocDumper, default_flow_style=False, sort_keys=False, allow_unicode=True, width=100)

n_sec = sum(1 for x in lines if x["kind"] == "section")
print(f"wrote {OUT}")
print(f"lines={len(lines)} (sections={n_sec}, other={len(lines)-n_sec}) versions={len(versions)} edges={len(edges)} artifacts={len(artifacts)} contracts={len(contracts)} releases={len(releases)}")
