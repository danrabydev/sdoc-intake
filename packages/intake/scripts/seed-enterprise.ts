import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { flatten, fieldOf, nodeUid } from "../src/lib/sdoc/model.ts";
import { parse } from "../src/lib/sdoc/parse.ts";
import { validate } from "../src/lib/sdoc/validate.ts";

const root = join(import.meta.dirname, "..", "data");

type Status = "Draft" | "Active" | "Approved";

interface Req {
  key?: string;
  title: string;
  shall: string;
  nist?: string[];
  cap?: string;
  plt?: string;
  status?: Status;
  rationale?: string;
  stig?: boolean;
  supersedes?: boolean;
}

interface Sec {
  uid: string;
  title: string;
  prefix?: string;
  reqs?: Req[];
  children?: Sec[];
}

const caps: Sec[] = [
  {
    uid: "ENT-SEC-ID",
    title: "Identity and access",
    prefix: "ID",
    reqs: [
      ["Workforce sign-in", "A workforce user can prove who they are and open a session."],
      ["Customer sign-in", "A customer can sign in to the services they are enrolled in."],
      ["Privileged access", "Administration is limited to named privileged accounts."],
      ["Joiner, mover, leaver", "Accounts are created, changed, and removed as employment changes."],
      ["Partner federation", "A partner organization can be trusted for sign-in without a local password."],
      ["Session control", "A session ends when it is idle, revoked, or the user signs out."],
      ["Break-glass access", "Emergency access is available, attributed, and reviewed afterward."],
      ["Non-person identity", "A service and a device can be identified apart from a person."],
    ].map(cap("workforce customer privileged joiner federation session breakglass npe".split(" "))),
  },
  {
    uid: "ENT-SEC-REC",
    title: "Records and privacy",
    prefix: "REC",
    reqs: [
      ["Official record", "A business event that must be kept is captured as a record."],
      ["Retention", "A record is kept for its retention period and then disposed of."],
      ["Legal hold", "A record under hold is not disposed of."],
      ["Consent", "Processing that needs consent does not proceed without it."],
      ["Subject access", "A person can request a copy of the information held about them."],
      ["De-identification", "A data set released for analysis does not identify a person."],
    ].map(cap("record retention hold consent access deident".split(" "))),
  },
  {
    uid: "ENT-SEC-PAY",
    title: "Payments",
    prefix: "PAY",
    reqs: [
      ["Payment initiation", "An authorized user can start a payment from an approved account."],
      ["Payment approval", "A payment above the threshold waits for a second approver."],
      ["Reconciliation", "Settled payments are matched to the ledger."],
      ["Refunds", "A refund is tied to the original payment and approved."],
      ["Sanctions screening", "A payee is screened before the payment is released."],
      ["Settlement", "Merchant settlement is calculated from cleared transactions."],
    ].map(cap("initiate approve reconcile refund screen settle".split(" "))),
  },
  {
    uid: "ENT-SEC-CLI",
    title: "Harbor clinic",
    prefix: "CLI",
    reqs: [
      ["Patient registration", "A patient can be registered and matched to one record."],
      ["Scheduling", "A patient can book and change an appointment."],
      ["Chart access", "A clinician can open the chart of a patient they are treating."],
      ["Prescribing", "An authorized prescriber can send a prescription."],
      ["Results release", "A result is released to the patient when it is final."],
      ["Encounter billing", "A completed encounter produces a billable claim."],
    ].map(cap("register schedule chart prescribe results billing".split(" "))),
  },
  {
    uid: "ENT-SEC-COM",
    title: "Communications",
    prefix: "COM",
    reqs: [
      ["Workforce messaging", "Workforce users can exchange messages inside the enterprise."],
      ["Patient messaging", "A patient and a care team can exchange messages about care."],
      ["Notices", "A required notice is delivered and the delivery is recorded."],
      ["Emergency notification", "An emergency notice reaches the on-call roster."],
    ].map(cap("work-msg patient-msg notice emergency".split(" "))),
  },
  {
    uid: "ENT-SEC-END",
    title: "Endpoints",
    prefix: "END",
    reqs: [
      ["Enrollment", "A managed device is enrolled before it can reach enterprise data."],
      ["Patch compliance", "A device that is behind on patches is reported and blocked."],
      ["Removable media", "Removable media is blocked unless an exception is approved."],
      ["Lost device", "A lost device can be locked and its enterprise data wiped."],
    ].map(cap("enroll patch media lost".split(" "))),
  },
  {
    uid: "ENT-SEC-LOG",
    title: "Logistics",
    prefix: "LOG",
    reqs: [
      ["Warehouse receipt", "Inbound goods are received against a purchase order."],
      ["Inventory accuracy", "On-hand quantity is adjusted only through an attributed transaction."],
      ["Shipment tender", "An outbound shipment is tendered to a carrier with a tracking id."],
      ["Chain of custody", "A controlled item has a recorded custodian at each handoff."],
    ].map(cap("receipt inventory tender custody".split(" "))),
  },
  {
    uid: "ENT-SEC-WEB",
    title: "Public presence",
    prefix: "WEB",
    reqs: [
      ["Publishing", "Public pages are published from an approved source."],
      ["Anonymous request", "A person can submit a request without an account."],
      ["Content withdrawal", "A published page can be withdrawn and the withdrawal recorded."],
      ["Abuse handling", "An abusive submission can be blocked and reviewed."],
    ].map(cap("publish anonymous withdraw abuse".split(" "))),
  },
  {
    uid: "ENT-SEC-HR",
    title: "Workforce",
    prefix: "HR",
    reqs: [
      ["Position of record", "Each person has one current position, a manager, and a job code."],
      ["Time record", "Time worked is attested by the person and accepted by the manager."],
      ["Payroll access", "Pay data is visible only to the payroll role and the person it concerns."],
      ["Training assignment", "A person is assigned the training their job requires, and completion is recorded."],
      ["Contractor access", "A contractor has a sponsor, an end date, and no access after that date."],
      ["Separation checklist", "A departure closes accounts, badges, and equipment against one checklist."],
    ].map(cap("position time payroll training contractor separation".split(" "))),
  },
  {
    uid: "ENT-SEC-PRC",
    title: "Procurement",
    prefix: "PRC",
    reqs: [
      ["Vendor register", "A vendor is registered, owned, and marked active before it can be paid."],
      ["Contract obligation", "A purchase cites the contract that authorizes it."],
      ["Purchase approval", "A purchase above the threshold is approved by someone other than the requester."],
      ["Invoice match", "An invoice is paid only when it matches the order and the receipt."],
      ["Conflict check", "A buyer discloses a personal interest before approving a vendor."],
      ["Supplier assurance", "A vendor that handles restricted data has an assessed security obligation."],
    ].map(cap("vendor contract purchase invoice conflict supplier".split(" "))),
  },
  {
    uid: "ENT-SEC-SOC",
    title: "Security operations",
    prefix: "SOC",
    reqs: [
      ["Control assessment", "A claimed control is assessed on a schedule, and the result is recorded."],
      ["Vulnerability intake", "A scan finding is accepted into one queue and given a due date."],
      ["Risk exception", "An unmet control is allowed only by an exception that expires."],
      ["Incident record", "A confirmed incident has a severity, an owner, and the affected accounts."],
      ["Evidence package", "Assessment evidence is a record the producing team cannot alter."],
      ["Threat notice", "A notice that customers or patients must receive is tracked to delivery."],
      ["Authorization boundary", "The systems inside the authorization boundary are listed and owned."],
      ["Flaw acceptance", "An accepted vulnerability is reviewed again before its expiry."],
    ].map(cap("assess vuln-in exception incident evidence threat boundary accept".split(" "))),
  },
  {
    uid: "ENT-SEC-DAT",
    title: "Data platform",
    prefix: "DAT",
    reqs: [
      ["Pipeline", "A data pipeline runs as a workload identity and records what it wrote."],
      ["Warehouse access", "A warehouse role is named, purposed, and is not a shared login."],
      ["Bulk export", "A bulk export of restricted data is approved before the file is released."],
      ["Analytics purpose", "An analytics use names its purpose and does not reuse a care or payment purpose."],
      ["Dataset catalog", "A data set has an owner and a classification before it can be queried."],
      ["Copy disposal", "An analytics copy is disposed when the source record is disposed."],
    ].map(cap("pipeline warehouse export analytics dataset copy-dispose".split(" "))),
  },
];

function cap(keys: string[]) {
  return (pair: string[], index: number): Req => ({
    key: keys[index],
    title: pair[0]!,
    shall: pair[1]!,
    status: index === keys.length - 1 ? "Draft" : "Active",
  });
}

const platform: Sec[] = [
  {
    uid: "PLT-SEC-ID",
    title: "Identity services",
    prefix: "ID",
    reqs: [
      r("plt-mfa", "Phishing-resistant workforce authenticator", "The identity service shall require a phishing-resistant authenticator for every privileged workforce session.", ["IA-2.1", "IA-2.2", "AC-6"], "privileged", true),
      r("plt-customer-auth", "Customer authenticator", "The identity service shall authenticate a customer with an authenticator bound to that customer.", ["IA-2", "IA-5"], "customer"),
      r("plt-account", "Account record", "The identity service shall keep one account record for each person or non-person identity.", ["AC-2", "IA-4"], "joiner"),
      r("plt-disable", "Disable departed accounts", "The identity service shall disable an account when the joiner-mover-leaver feed says the person has left.", ["AC-2.3", "PS-4"], "joiner", true),
      r("plt-federation", "Federated sign-in", "The identity service shall accept a partner assertion only from a registered issuer.", ["IA-8", "AC-20"], "federation"),
      r("plt-session", "Session lifetime", "The identity service shall end a session at the configured idle time and when the user signs out.", ["AC-11", "AC-12"], "session"),
      r("plt-breakglass", "Break-glass account", "The identity service shall issue a break-glass credential that expires and is alerted on use.", ["AC-2", "AC-6"], "breakglass", true),
      r("plt-npe", "Service identity", "The identity service shall identify a workload with a credential that is not a shared password.", ["IA-3", "IA-5"], "npe"),
    ],
  },
  {
    uid: "PLT-SEC-AUD",
    title: "Audit",
    prefix: "AUD",
    reqs: [
      r("plt-audit-events", "Security audit events", "The platform shall record sign-in, access denial, privilege change, and export as audit events.", ["AU-2", "AU-3"], "workforce", true),
      r("plt-audit-content", "Audit record content", "An audit record shall include who, what, when, where, and the outcome.", ["AU-3"], "record"),
      r("plt-audit-review", "Audit review", "The platform shall make audit records available for review by the security operations role.", ["AU-6"], "workforce"),
      r("plt-audit-protect", "Audit integrity", "The platform shall protect stored audit records from change by the application that produced them.", ["AU-9"], "record", true),
      r("plt-audit-retain", "Audit retention", "The platform shall retain audit records for the retention period of the record they describe.", ["AU-11"], "retention"),
      r("plt-audit-clock", "Audit time source", "Audit timestamps shall come from the enterprise time source.", ["AU-8"], "record"),
      r("plt-audit-export", "Audit export", "The platform shall export audit records to the central store within five minutes.", ["AU-12"], "record"),
      r("plt-audit-fail", "Audit failure", "The platform shall alert when audit recording fails and shall not drop the action silently.", ["AU-5"], "record"),
    ],
  },
  {
    uid: "PLT-SEC-CRY",
    title: "Cryptography",
    prefix: "CRY",
    reqs: [
      r("plt-tls", "Protected channels", "The platform shall protect data in transit with an approved protocol.", ["SC-8", "SC-13"], "workforce", true),
      r("plt-at-rest", "Encryption at rest", "The platform shall encrypt stored restricted data with an enterprise-managed key.", ["SC-28", "SC-12"], "record", true),
      r("plt-keys", "Key custody", "Cryptographic keys shall be generated and stored in the enterprise key service.", ["SC-12"], "record"),
      r("plt-hash", "Password storage", "The platform shall store memorized secrets only as a salted one-way secret.", ["IA-5.1"], "workforce"),
      r("plt-cert", "Certificate lifetime", "A service certificate shall be replaced before it expires.", ["SC-17"], "npe"),
      r("plt-crypto-mod", "Approved modules", "Cryptographic operations shall use modules on the enterprise approved list.", ["SC-13"], "workforce"),
    ],
  },
  {
    uid: "PLT-SEC-CFG",
    title: "Configuration",
    prefix: "CFG",
    reqs: [
      r("plt-baseline", "Configuration baseline", "Each environment shall be built from a recorded baseline.", ["CM-2", "CM-6"], "enroll"),
      r("plt-change", "Change control", "A change to production shall be requested, approved, and traceable.", ["CM-3"], "record"),
      r("plt-least-fn", "Least functionality", "A deployed component shall not enable a service the baseline does not list.", ["CM-7"], "enroll", true),
      r("plt-inventory", "Component inventory", "The platform shall keep an inventory of deployed components and their owners.", ["CM-8"], "inventory"),
      r("plt-secret-cfg", "No secrets in config", "A configuration store shall not hold a plaintext long-lived secret.", ["IA-5", "SC-28"], "npe"),
      r("plt-harden", "Hardened image", "A workload image shall be built from the hardened base image.", ["CM-6", "SI-2"], "patch"),
      r("plt-drift", "Drift detection", "The platform shall report a host whose configuration has left the baseline.", ["CM-2", "SI-4"], "patch"),
      r("plt-flag", "Feature flag owner", "A feature flag that changes security behavior shall have a named owner.", ["CM-3"], "privileged"),
    ],
  },
  {
    uid: "PLT-SEC-CON",
    title: "Continuity",
    prefix: "CON",
    reqs: [
      r("plt-backup", "Backup", "The platform shall back up restricted data on the schedule in the continuity plan.", ["CP-9"], "record"),
      r("plt-restore", "Restore test", "A backup of each system of record shall be restored in a test at least quarterly.", ["CP-9", "CP-10"], "record"),
      r("plt-rto", "Recovery objective", "The platform shall document a recovery time objective for each system of record.", ["CP-2"], "record"),
      r("plt-failover", "Failover", "A loss of the primary site shall not silently drop an accepted transaction.", ["CP-10"], "reconcile"),
      r("plt-contingency-access", "Contingency access", "Break-glass access shall still be available when the primary identity store is degraded.", ["CP-2", "AC-2"], "breakglass"),
      r("plt-backup-protect", "Backup protection", "Backups shall be protected from deletion by the application administrator.", ["CP-9", "AU-9"], "record", true),
    ],
  },
  {
    uid: "PLT-SEC-MON",
    title: "Monitoring and flaw remediation",
    prefix: "MON",
    reqs: [
      r("plt-vuln", "Vulnerability scanning", "Internet-facing and internal components shall be scanned for known vulnerabilities.", ["RA-5"], "patch", true),
      r("plt-patch-time", "Patch window", "A fix for a critical vulnerability shall be applied inside the enterprise window.", ["SI-2", "RA-5"], "patch"),
      r("plt-malware", "Malicious code protection", "A managed endpoint and a server workload shall run malicious-code protection.", ["SI-3"], "enroll"),
      r("plt-detect", "Attack detection", "The platform shall alert on authentication attacks and unusual data export.", ["SI-4", "AU-6"], "workforce", true),
      r("plt-integrity", "Software integrity", "A deployed artifact shall be checked against its signed digest before start.", ["SI-7"], "enroll"),
      r("plt-input", "Input handling", "The platform shall reject input that does not match the expected type and length.", ["SI-10"], "abuse"),
      r("plt-error", "Error handling", "An error shown to a user shall not include a secret or a stack trace.", ["SI-11"], "publish"),
      r("plt-ir", "Incident handoff", "A confirmed security incident shall be opened in the incident system with the affected accounts.", ["IR-4", "IR-6"], "emergency"),
    ],
  },
  {
    uid: "PLT-SEC-OPS",
    title: "Security operations support",
    prefix: "OPS",
    reqs: [
      r("plt-assess", "Assessment calendar", "The platform shall record the last result and the next due date for each control the enterprise claims.", ["CA-2", "CA-7"], "assess"),
      r("plt-exception", "Exception expiry", "The platform shall expire an accepted risk and shall not renew it without a new approval.", ["CA-5", "RA-5"], "exception", true),
      r("plt-incident", "Incident case", "The platform shall require a severity, an owner, and the affected accounts on a confirmed incident.", ["IR-4", "IR-8"], "incident"),
      r("plt-evidence", "Evidence store", "The platform shall store assessment evidence as a record the producing team cannot change.", ["AU-9", "AU-11"], "evidence", true),
      r("plt-boundary", "Boundary record", "The platform shall list the systems inside the authorization boundary and the owner of each.", ["PL-8", "CM-8"], "boundary"),
      r("plt-vendor-feed", "Vendor risk feed", "The platform shall show a vendor's risk rating to procurement and to security operations.", ["SA-9", "RA-3"], "supplier"),
      r("plt-poam", "Finding clock", "The platform shall keep a due date on an open finding and alert when the date passes.", ["CA-5"], "assess"),
      r("plt-threat", "Threat bulletin", "The platform shall record who received a threat notice and whether delivery succeeded.", ["SI-5", "IR-6"], "threat"),
    ],
  },
  {
    uid: "PLT-SEC-DAT",
    title: "Data platform support",
    prefix: "DAT",
    reqs: [
      r("plt-dataset", "Dataset owner", "The platform shall refuse a queryable data set that has no owner and no classification.", ["PT-2", "AC-16"], "dataset"),
      r("plt-export-gate", "Export approval", "The platform shall hold a bulk export of restricted data until the recorded approver releases it.", ["AC-3", "AC-6"], "export", true),
      r("plt-pipeline-id", "Pipeline identity", "The platform shall run a pipeline as a workload identity, not as a shared password.", ["IA-3", "IA-5"], "pipeline"),
      r("plt-purpose", "Purpose on the role", "The platform shall bind a warehouse role to one stated purpose.", ["AC-6", "PT-2"], "analytics"),
      r("plt-lineage", "Write lineage", "The platform shall name the pipeline that wrote a derived table.", ["AU-3", "CM-8"], "pipeline"),
      r("plt-copy-dispose", "Dispose the copy", "The platform shall delete an analytics copy when the source record is disposed.", ["SI-12", "MP-6"], "copy-dispose"),
      r("plt-query-audit", "Query audit", "The platform shall audit who queried a restricted data set and which role they used.", ["AU-2", "AU-3"], "warehouse", true),
    ],
  },
];

function r(
  key: string,
  title: string,
  shall: string,
  nist: string[],
  cap: string,
  stig?: boolean,
): Req {
  return { key, title, shall, nist, cap, stig: stig === true, status: "Approved" };
}

const apps: { dir: string; uid: string; title: string; prefix: string; intro: string; sections: Sec[] }[] = [
  {
    dir: "identity",
    uid: "APP-IDN",
    title: "Identity",
    prefix: "IDN-",
    intro: "Workforce and customer identity for Northline. Requirements refine the identity capabilities and the platform identity service.",
    sections: [
      {
        uid: "IDN-SEC-ACC",
        title: "Access",
        prefix: "ACC",
        children: [
          {
            uid: "IDN-SEC-AUTH",
            title: "Authentication",
            prefix: "AUTH",
            reqs: [
              req("SMS one-time password", "Identity shall accept SMS as a second factor for a workforce account.", ["IA-2"], "privileged", "plt-mfa", "Approved"),
              req("Privileged sign-in", "Identity shall refuse a privileged session that did not use a phishing-resistant authenticator.", ["IA-2.1", "AC-6"], "privileged", "plt-mfa", "Approved", true, true),
              req("Customer step-up", "Identity shall step up a customer session before showing payment instruments or health information.", ["IA-2", "AC-3"], "customer", "plt-customer-auth"),
              req("Lockout", "Identity shall temporarily lock an account after the configured number of failed attempts.", ["AC-7"], "session", "plt-session"),
              req("Authenticator recovery", "Identity shall recover a lost authenticator only after a second channel that is not the authenticator itself.", ["IA-5"], "workforce", "plt-customer-auth"),
              req("Replay", "Identity shall reject a reused authenticator response.", ["IA-2.8"], "workforce", "plt-mfa", "Active", true),
              req("Sign-out", "Identity shall revoke the session tokens when the user signs out.", ["AC-12"], "session", "plt-session"),
              req("Remembered device", "Identity shall bind a remembered browser to the customer and expire that binding.", ["IA-3"], "customer", "plt-customer-auth", "Draft"),
            ],
          },
          {
            uid: "IDN-SEC-AUTHZ",
            title: "Authorization",
            prefix: "AUTHZ",
            reqs: [
              req("Role grant", "Identity shall grant an administrative role only from an approved request.", ["AC-2", "AC-6"], "privileged", "plt-account"),
              req("Least privilege", "Identity shall not include an administrative role in a standard workforce profile.", ["AC-6"], "privileged", "plt-mfa"),
              req("Separation", "Identity shall stop one person from both requesting and approving the same privileged grant.", ["AC-5"], "privileged", "plt-account"),
              req("Temporary elevation", "Identity shall expire a temporary elevation at the time recorded on the request.", ["AC-2", "AC-6"], "breakglass", "plt-breakglass", "Active", true),
              req("Access review", "Identity shall present privileged grants for review every quarter.", ["AC-2.9"], "privileged", "plt-account"),
              req("Deny by default", "Identity shall deny an action that no grant covers.", ["AC-3"], "workforce", "plt-account"),
            ],
          },
        ],
      },
      {
        uid: "IDN-SEC-PRV",
        title: "Provisioning",
        prefix: "PRV",
        reqs: [
          req("Hire feed", "Identity shall open a workforce account from the HR hire event and not from a free-text request.", ["AC-2", "IA-4"], "joiner", "plt-account"),
          req("Transfer", "Identity shall replace role grants when HR records a transfer.", ["AC-2"], "joiner", "plt-account"),
          req("Departure", "Identity shall disable sign-in within one hour of a recorded departure.", ["AC-2.3", "PS-4"], "joiner", "plt-disable", "Approved", true),
          req("Orphan account", "Identity shall list accounts that no longer match a person or a workload.", ["AC-2", "IA-4"], "npe", "plt-npe"),
          req("Service account owner", "Identity shall require a named owner on every service account.", ["AC-2", "IA-3"], "npe", "plt-npe"),
          req("Dormant account", "Identity shall disable a workforce account with no successful sign-in for the configured period.", ["AC-2"], "joiner", "plt-disable", "Draft"),
        ],
      },
      {
        uid: "IDN-SEC-FED",
        title: "Federation",
        prefix: "FED",
        reqs: [
          req("Registered issuer", "Identity shall reject an assertion whose issuer is not on the partner register.", ["IA-8"], "federation", "plt-federation", "Approved", true),
          req("Audience", "Identity shall reject an assertion that does not name this service as the audience.", ["IA-8"], "federation", "plt-federation"),
          req("Lifetime", "Identity shall reject an assertion outside its validity window.", ["IA-8", "AU-8"], "federation", "plt-federation"),
          req("Attribute map", "Identity shall map partner attributes to local roles through an approved map, not through a default role.", ["AC-3", "AC-6"], "federation", "plt-account"),
          req("Partner offboarding", "Identity shall stop accepting an issuer the day the partnership ends.", ["AC-2.3", "IA-8"], "federation", "plt-disable"),
          req("Federation audit", "Identity shall audit the issuer and subject of every federated sign-in.", ["AU-2", "AU-3"], "federation", "plt-audit-events"),
        ],
      },
    ],
  },
  {
    dir: "records",
    uid: "APP-REC",
    title: "Records",
    prefix: "REC-",
    intro: "Official records, retention, hold, and privacy requests for Northline.",
    sections: [
      {
        uid: "REC-SEC-CAP",
        title: "Capture",
        prefix: "CAP",
        reqs: [
          req("Declare a record", "Records shall store an official record with its classification, owner, and retention schedule.", ["AC-16"], "record", "plt-audit-content"),
          req("Immutable content", "Records shall keep the bytes of a declared record unchanged.", ["AU-9", "SI-7"], "record", "plt-audit-protect", "Approved", true),
          req("Classification", "Records shall require a classification before a file enters an official repository.", ["AC-16", "RA-3"], "record"),
          req("Version", "Records shall keep prior versions of a record that was superseded.", ["AU-9"], "record", "plt-audit-protect"),
          req("Source system", "Records shall record which system declared the record.", ["AU-3"], "record", "plt-audit-content"),
          req("Bulk import", "Records shall reject a bulk import that has no owner.", ["AC-2"], "record", "plt-account", "Draft"),
        ],
      },
      {
        uid: "REC-SEC-RET",
        title: "Retention and hold",
        prefix: "RET",
        reqs: [
          req("Schedule", "Records shall apply the retention schedule attached to the record category.", ["AU-11"], "retention", "plt-audit-retain"),
          req("Disposition approval", "Records shall require approval before destroying a record that has reached the end of retention.", ["MP-6"], "retention"),
          req("Hold flag", "Records shall stop disposition of a record while a legal hold names it.", ["AU-11"], "hold", "plt-audit-protect", "Approved", true),
          req("Hold release", "Records shall resume the schedule only after the hold is released by the counsel role.", ["AU-11"], "hold"),
          req("Destruction proof", "Records shall record who destroyed a record and when.", ["AU-3", "MP-6"], "retention", "plt-audit-content"),
          req("Hold notice", "Records shall notify the record owner when a hold is placed.", ["IR-6"], "hold", "plt-ir"),
        ],
      },
      {
        uid: "REC-SEC-PRV",
        title: "Privacy",
        prefix: "PRV",
        reqs: [
          req("Purpose", "Records shall record the purpose for which personal information was collected.", ["PT-2"], "consent"),
          req("Consent record", "Records shall store the consent text and the time it was given.", ["PT-2"], "consent", "plt-audit-content"),
          req("Consent withdrawal", "Records shall stop optional processing when consent is withdrawn.", ["PT-2"], "consent"),
          req("Subject request", "Records shall open a subject-access case and track its due date.", ["PT-1"], "access"),
          req("Export for the subject", "Records shall export the information held about a person in a readable file.", ["PT-1", "AU-3"], "access"),
          req("De-identify", "Records shall remove direct identifiers before a data set is released to analytics.", ["SI-12", "PT-2"], "deident", "plt-at-rest", "Active", true),
          req("Minimum necessary", "Records shall not return fields the caller's purpose does not need.", ["AC-6", "PT-2"], "access", "plt-account"),
        ],
      },
    ],
  },
  {
    dir: "payments",
    uid: "APP-PAY",
    title: "Payments",
    prefix: "PAY-",
    intro: "Payment initiation, approval, screening, and reconciliation for Northline treasury.",
    sections: [
      {
        uid: "PAY-SEC-INIT",
        title: "Initiation",
        prefix: "INIT",
        reqs: [
          req("Entitled account", "Payments shall start a payment only from an account the user is entitled to.", ["AC-3", "AC-6"], "initiate", "plt-account"),
          req("Dual control", "Payments shall hold a payment above the threshold until a second person approves it.", ["AC-5", "AC-6"], "approve", "plt-account", "Approved", true),
          req("Payee on file", "Payments shall send funds only to a payee record that has been approved.", ["AC-3"], "initiate"),
          req("Amount limit", "Payments shall reject an amount above the user's limit.", ["AC-6"], "initiate", "plt-account"),
          req("Idempotent submit", "Payments shall not create a second payment when the same request is repeated.", ["SI-10"], "initiate"),
          req("After hours", "Payments shall queue an international payment started outside the dealing window.", ["AC-2"], "initiate", undefined, "Draft"),
        ],
      },
      {
        uid: "PAY-SEC-SCR",
        title: "Screening and fraud",
        prefix: "SCR",
        reqs: [
          req("Sanctions list", "Payments shall screen the payee against the current sanctions list before release.", ["RA-3"], "screen", undefined, "Approved", true),
          req("Screen fail closed", "Payments shall not release a payment when the screening service is unavailable.", ["SC-5"], "screen"),
          req("Velocity", "Payments shall hold a burst of payments from one account for review.", ["SI-4"], "screen", "plt-detect"),
          req("Changed bank details", "Payments shall require step-up authentication when bank details change.", ["IA-2", "AC-2"], "screen", "plt-customer-auth", "Active", true),
          req("Fraud case", "Payments shall open a case when a payment is held for fraud.", ["IR-4"], "screen", "plt-ir"),
          req("Recall", "Payments shall record a recall request against the original payment.", ["AU-3"], "refund"),
        ],
      },
      {
        uid: "PAY-SEC-LED",
        title: "Ledger",
        prefix: "LED",
        reqs: [
          req("Match settlement", "Payments shall match each settled item to one ledger entry.", ["AU-3"], "reconcile"),
          req("Unmatched item", "Payments shall list unmatched items older than one business day.", ["AU-6"], "reconcile", "plt-audit-review"),
          req("Refund link", "Payments shall refuse a refund that does not name the original payment.", ["AC-3"], "refund"),
          req("Refund approval", "Payments shall require approval for a refund above the threshold.", ["AC-5"], "approve"),
          req("Merchant total", "Payments shall compute merchant settlement from cleared transactions only.", ["AU-3"], "settle"),
          req("Ledger audit", "Payments shall audit who posted an adjusting entry.", ["AU-2", "AU-3"], "reconcile", "plt-audit-events", "Active", true),
        ],
      },
    ],
  },
  {
    dir: "clinic",
    uid: "APP-CLI",
    title: "Harbor clinic",
    prefix: "CLI-",
    intro: "Patient registration, chart access, prescribing, and results for the Harbor clinic portal. This is a fictional care setting.",
    sections: [
      {
        uid: "CLI-SEC-REG",
        title: "Registration",
        prefix: "REG",
        reqs: [
          req("Match the patient", "Clinic shall match a registration to an existing patient before creating a second record.", ["IA-4"], "register"),
          req("Demographic minimum", "Clinic shall require the identifiers the registration policy lists.", ["IA-4"], "register"),
          req("Merge", "Clinic shall merge duplicate patients only under the health-information role, and shall audit the merge.", ["AC-6", "AU-2"], "register", "plt-audit-events", "Approved", true),
          req("Proxy", "Clinic shall let an authorized proxy act for a patient and shall record the authority.", ["AC-2", "AC-3"], "register"),
          req("Minor", "Clinic shall apply the minor-access rule before showing a chart to a guardian.", ["AC-3"], "register", undefined, "Draft"),
        ],
      },
      {
        uid: "CLI-SEC-SCH",
        title: "Scheduling",
        prefix: "SCH",
        reqs: [
          req("Book", "Clinic shall book an appointment only into an open slot for a clinician who treats that service.", ["AC-3"], "schedule", "plt-account"),
          req("Change", "Clinic shall keep the prior slot when an appointment is moved.", ["AU-9"], "schedule", "plt-audit-protect"),
          req("Cancel reason", "Clinic shall record who cancelled an appointment and the reason.", ["AU-3"], "schedule", "plt-audit-content"),
          req("Reminder", "Clinic shall send the appointment reminder through patient messaging and record delivery.", ["IR-6"], "notice", "plt-ir"),
          req("No-show", "Clinic shall mark a no-show and shall not delete the slot history.", ["AU-9"], "schedule"),
          req("Overbook", "Clinic shall allow an overbook only for the role named in the clinic policy.", ["AC-6"], "schedule", "plt-account", "Draft"),
        ],
      },
      {
        uid: "CLI-SEC-CHART",
        title: "Chart",
        prefix: "CHART",
        reqs: [
          req("Treatment relationship", "Clinic shall open a chart only when the clinician has a treatment relationship or an emergency override.", ["AC-3", "AC-6"], "chart", "plt-account", "Approved", true),
          req("Break-glass chart", "Clinic shall alert privacy when a chart is opened with the emergency override.", ["AC-6", "AU-6"], "breakglass", "plt-breakglass", "Active", true),
          req("Note authorship", "Clinic shall record the author of a clinical note and shall not allow a silent rewrite.", ["AU-9"], "chart", "plt-audit-protect"),
          req("Sensitive note", "Clinic shall hide a note marked sensitive from a role that is not on its list.", ["AC-3", "AC-6"], "chart"),
          req("Print", "Clinic shall audit a chart print or download.", ["AU-2"], "chart", "plt-audit-events"),
          req("External image", "Clinic shall accept an outside image only into the designated repository.", ["SC-8", "CM-7"], "chart", "plt-tls"),
        ],
      },
      {
        uid: "CLI-SEC-RX",
        title: "Orders and results",
        prefix: "RX",
        reqs: [
          req("Prescriber check", "Clinic shall send a prescription only for a user with the prescriber grant.", ["AC-6", "IA-2"], "prescribe", "plt-mfa", "Approved", true),
          req("Prescription sign", "Clinic shall sign a prescription with the prescriber's authenticator, not a shared kiosk session.", ["IA-2.1"], "prescribe", "plt-mfa"),
          req("Result final", "Clinic shall release a result to the patient only after it is marked final.", ["AC-3"], "results"),
          req("Abnormal notice", "Clinic shall send the abnormal-result notice through patient messaging.", ["IR-6"], "results", "plt-ir"),
          req("Claim from encounter", "Clinic shall build a claim from the signed encounter and not from an unsigned note.", ["AU-3"], "billing"),
          req("Claim audit", "Clinic shall audit a change to a diagnosis on a claim.", ["AU-2"], "billing", "plt-audit-events"),
        ],
      },
    ],
  },
  {
    dir: "messaging",
    uid: "APP-MSG",
    title: "Messaging",
    prefix: "MSG-",
    intro: "Workforce and patient messaging, including delivery of required notices.",
    sections: [
      {
        uid: "MSG-SEC-WRK",
        title: "Workforce",
        prefix: "WRK",
        reqs: [
          req("Directory only", "Messaging shall address workforce messages to directory identities, not to free-typed mailboxes.", ["IA-4", "AC-3"], "work-msg", "plt-account"),
          req("Attachment type", "Messaging shall block an attachment type that the baseline does not allow.", ["CM-7", "SI-3"], "work-msg", "plt-malware", "Active", true),
          req("Retention of messages", "Messaging shall keep a workforce message for the messaging retention period.", ["AU-11"], "retention", "plt-audit-retain"),
          req("External banner", "Messaging shall mark a message that arrived from outside the enterprise.", ["SI-8"], "work-msg"),
          req("Forward audit", "Messaging shall audit a forward of a restricted message to an external address.", ["AU-2"], "work-msg", "plt-audit-events"),
          req("Channel protection", "Messaging shall transport messages over the protected channel.", ["SC-8"], "work-msg", "plt-tls", "Approved", true),
        ],
      },
      {
        uid: "MSG-SEC-PAT",
        title: "Patients and notices",
        prefix: "PAT",
        reqs: [
          req("Care-team thread", "Messaging shall open a patient thread only for the assigned care team.", ["AC-3"], "patient-msg", "plt-account"),
          req("Patient identity on thread", "Messaging shall show the patient identity on every thread so a message is not filed to the wrong chart.", ["IA-4"], "patient-msg"),
          req("Notice record", "Messaging shall record that a required notice was sent and whether delivery succeeded.", ["AU-3"], "notice", "plt-audit-content"),
          req("On-call fan-out", "Messaging shall deliver an emergency notice to the current on-call roster.", ["IR-6"], "emergency", "plt-ir", "Approved", true),
          req("Quiet hours exception", "Messaging shall still deliver an emergency notice during quiet hours.", ["IR-6"], "emergency"),
          req("Undelivered notice", "Messaging shall raise an alert when a required notice is undelivered after the configured time.", ["AU-5"], "notice", "plt-audit-fail"),
        ],
      },
    ],
  },
  {
    dir: "endpoint",
    uid: "APP-END",
    title: "Endpoint management",
    prefix: "END-",
    intro: "Enrollment, patch compliance, media control, and lost-device response for managed endpoints.",
    sections: [
      {
        uid: "END-SEC-ENR",
        title: "Enrollment",
        prefix: "ENR",
        reqs: [
          req("Corporate device", "Endpoint shall enroll a device before it is allowed to open enterprise data.", ["AC-19", "CM-8"], "enroll", "plt-inventory"),
          req("Owner", "Endpoint shall record the person a device is assigned to.", ["CM-8", "IA-4"], "enroll", "plt-npe"),
          req("Unenrolled block", "Endpoint shall block a device that is not enrolled from the enterprise network profile.", ["AC-3", "CM-7"], "enroll", "plt-least-fn", "Approved", true),
          req("Certificate", "Endpoint shall install a device certificate from the enterprise authority.", ["SC-17", "IA-3"], "enroll", "plt-cert"),
          req("Retire", "Endpoint shall wipe enterprise data when a device is retired.", ["MP-6"], "lost", "plt-disable"),
          req("Lost", "Endpoint shall lock a reported-lost device and wipe it if it does not check in.", ["MP-6", "IR-4"], "lost", "plt-ir", "Approved", true),
        ],
      },
      {
        uid: "END-SEC-PAT",
        title: "Compliance",
        prefix: "CMP",
        reqs: [
          req("Patch level", "Endpoint shall mark a device non-compliant when a critical patch is missing past the window.", ["SI-2", "RA-5"], "patch", "plt-patch-time", "Active", true),
          req("Disk encryption", "Endpoint shall require disk encryption before a device is compliant.", ["SC-28"], "enroll", "plt-at-rest"),
          req("Screen lock", "Endpoint shall require a screen lock within the configured idle time.", ["AC-11"], "session", "plt-session"),
          req("Malware agent", "Endpoint shall require the malware agent to be running and current.", ["SI-3"], "enroll", "plt-malware"),
          req("Media block", "Endpoint shall block removable storage unless an exception names the device and the expiry.", ["AC-20", "MP-2"], "media", "plt-least-fn", "Approved", true),
          req("Exception review", "Endpoint shall expire a media exception and list it for review.", ["CM-3"], "media", "plt-change"),
          req("Drift report", "Endpoint shall report a device whose configuration has left the baseline.", ["CM-2", "SI-4"], "patch", "plt-drift"),
        ],
      },
    ],
  },
  {
    dir: "logistics",
    uid: "APP-LOG",
    title: "Logistics",
    prefix: "LOG-",
    intro: "Warehouse receipt, inventory, shipment, and chain of custody.",
    sections: [
      {
        uid: "LOG-SEC-WH",
        title: "Warehouse",
        prefix: "WH",
        reqs: [
          req("Receive against order", "Logistics shall receive goods only against an open purchase order line.", ["AC-3"], "receipt"),
          req("Receiver identity", "Logistics shall record the person who confirmed the receipt.", ["AU-3", "IA-2"], "receipt", "plt-audit-content"),
          req("Discrepancy", "Logistics shall hold a line whose count does not match the order.", ["SI-10"], "receipt"),
          req("Adjust stock", "Logistics shall adjust on-hand quantity only through an attributed transaction.", ["AU-2", "AC-6"], "inventory", "plt-audit-events", "Approved", true),
          req("Cycle count", "Logistics shall require a second person to confirm a cycle count that changes quantity.", ["AC-5"], "inventory"),
          req("Negative stock", "Logistics shall not allow on-hand quantity to go negative.", ["SI-10"], "inventory", undefined, "Draft"),
        ],
      },
      {
        uid: "LOG-SEC-SHIP",
        title: "Shipment and custody",
        prefix: "SHIP",
        reqs: [
          req("Tender", "Logistics shall tender a shipment only to a carrier on the approved list.", ["CM-8"], "tender", "plt-inventory"),
          req("Tracking", "Logistics shall store the carrier tracking id on the shipment.", ["AU-3"], "tender"),
          req("Custody handoff", "Logistics shall record the custodian at each handoff of a controlled item.", ["AU-3"], "custody", "plt-audit-content", "Approved", true),
          req("Seal", "Logistics shall record the seal number when a controlled shipment leaves the dock.", ["SI-7"], "custody", "plt-integrity"),
          req("Missing scan", "Logistics shall alert when a controlled item misses an expected scan.", ["SI-4"], "custody", "plt-detect"),
          req("Return", "Logistics shall receive a return against the original shipment.", ["AU-3"], "receipt"),
        ],
      },
    ],
  },
  {
    dir: "portal",
    uid: "APP-WEB",
    title: "Public portal",
    prefix: "WEB-",
    intro: "Public pages and anonymous requests. No account is required to read published content.",
    sections: [
      {
        uid: "WEB-SEC-PUB",
        title: "Publishing",
        prefix: "PUB",
        reqs: [
          req("Approved source", "Portal shall publish a page only from the approved content source.", ["CM-3", "CM-7"], "publish", "plt-change"),
          req("Reviewer", "Portal shall require a reviewer other than the author before a page is public.", ["AC-5"], "publish"),
          req("Withdraw", "Portal shall withdraw a page and keep the withdrawn copy as a record.", ["AU-9"], "withdraw", "plt-audit-protect"),
          req("Cache", "Portal shall drop a withdrawn page from the public cache.", ["SI-7"], "withdraw"),
          req("Integrity of assets", "Portal shall serve a script only when its digest matches the published manifest.", ["SI-7"], "publish", "plt-integrity", "Approved", true),
          req("Headers", "Portal shall send the enterprise browser-protection headers on every public response.", ["CM-6", "SC-8"], "publish", "plt-tls"),
        ],
      },
      {
        uid: "WEB-SEC-REQ",
        title: "Anonymous requests",
        prefix: "REQ",
        reqs: [
          req("No account required", "Portal shall accept a service request without creating an account.", ["AC-14"], "anonymous"),
          req("Rate limit", "Portal shall slow an address that submits requests faster than the published limit.", ["SC-5", "SI-4"], "abuse", "plt-detect", "Active", true),
          req("Field check", "Portal shall reject a request whose fields do not match the form definition.", ["SI-10"], "anonymous", "plt-input"),
          req("Attachment scan", "Portal shall scan an uploaded file before a staff member can open it.", ["SI-3"], "abuse", "plt-malware"),
          req("Abuse block", "Portal shall let the review role block a source and shall record the block.", ["AC-2", "AU-2"], "abuse", "plt-audit-events"),
          req("Personal data in request", "Portal shall treat a request that contains personal data as a record.", ["PT-2"], "record", "plt-at-rest", "Draft"),
          req("Status without account", "Portal shall show request status with the receipt code, not with an account session.", ["IA-2"], "anonymous"),
        ],
      },
    ],
  },
  {
    dir: "workforce",
    uid: "APP-HR",
    title: "Workforce",
    prefix: "HR-",
    intro: "Positions, time, payroll access, training, and contractors for Northline. Identity still opens and closes the account. This system is the source of the hire, transfer, and leave events.",
    sections: [
      {
        uid: "HR-SEC-POS",
        title: "People",
        prefix: "POS",
        reqs: [
          req("One position", "Workforce shall keep one current position for a person, including the manager and the job code.", ["PS-2", "PL-4"], "position"),
          req("Person identifier", "Workforce shall assign one identifier to a person and shall reuse it if they are rehired.", ["IA-4"], "position", "plt-account"),
          req("Hire event", "Workforce shall emit a hire event that Identity consumes. Workforce shall not create the account itself.", ["AC-2", "IA-4"], "joiner", "plt-account"),
          req("Job suggests, grant decides", "Workforce shall suggest roles from the job code and shall not grant them.", ["AC-6", "AC-2"], "position", "plt-account"),
          req("Manager of record", "Workforce shall name a manager before a person is marked active.", ["PS-2"], "position"),
          req("Rehire", "Workforce shall open a rehire against the existing person identifier, not a second person.", ["IA-4", "AC-2"], "joiner", "plt-account", "Active", true),
        ],
      },
      {
        uid: "HR-SEC-PAY",
        title: "Time and pay",
        prefix: "PAY",
        reqs: [
          req("Shared payroll login", "Workforce shall allow the payroll team to share one login for pay changes.", ["AC-2"], "payroll", "plt-account", "Approved"),
          req("Named payroll access", "Workforce shall grant payroll access only to named accounts.", ["AC-2", "AC-6"], "payroll", "plt-account", "Approved", true, true),
          req("Attest time", "Workforce shall require the worker to attest a time record before the manager can accept it.", ["AU-2"], "time"),
          req("Not your own time", "Workforce shall stop a person from accepting their own time record.", ["AC-5"], "time", "plt-account"),
          req("Pay change audit", "Workforce shall audit who changed a pay rate, the old rate, and the new rate.", ["AU-2", "AU-3"], "payroll", "plt-audit-events"),
          req("Bank change", "Workforce shall require step-up authentication before a direct-deposit account changes.", ["IA-2", "AC-2"], "payroll", "plt-customer-auth", "Active", true),
          req("Garnishment", "Workforce shall limit garnishment detail to the payroll role.", ["AC-6", "PT-2"], "payroll", "plt-purpose"),
          req("Correction", "Workforce shall keep a corrected time record and the record it replaced.", ["AU-9"], "time", "plt-audit-protect", "Draft"),
        ],
      },
      {
        uid: "HR-SEC-LRN",
        title: "Training",
        prefix: "LRN",
        reqs: [
          req("Assigned training", "Workforce shall assign the training the job code requires and shall record completion.", ["AT-2", "AT-4"], "training"),
          req("Role training", "Workforce shall assign extra training when a privileged role is granted.", ["AT-3", "AT-2"], "training", "plt-account"),
          req("Overdue blocks elevation", "Workforce shall refuse a new privileged grant while required training is overdue.", ["AT-2", "AC-6"], "training", "plt-mfa", "Approved", true),
          req("Keep the record", "Workforce shall keep a training completion for the retention period of the employment record.", ["AT-4", "AU-11"], "training", "plt-audit-retain"),
          req("Content owner", "Workforce shall name an owner for each required course.", ["AT-4"], "training", undefined, "Draft"),
        ],
      },
      {
        uid: "HR-SEC-CTR",
        title: "Contractors",
        prefix: "CTR",
        reqs: [
          req("Sponsor", "Workforce shall require a workforce sponsor on every contractor.", ["PS-7"], "contractor"),
          req("End date", "Workforce shall disable contractor eligibility on the end date without a separate request.", ["PS-4", "AC-2.3"], "separation", "plt-disable", "Approved", true),
          req("Agreement", "Workforce shall record the confidentiality agreement before a contractor is eligible.", ["PS-6"], "contractor"),
          req("Badge is not a grant", "Workforce shall not treat a badge as permission to an application role.", ["AC-2", "AC-6"], "contractor", "plt-account"),
          req("Company", "Workforce shall record the vendor company of a contractor and shall not file them as an employee.", ["IA-4", "SA-9"], "contractor", "plt-vendor-feed"),
          req("Checklist", "Workforce shall close accounts, badge, and equipment on one separation checklist.", ["PS-4", "MP-6"], "separation", "plt-disable"),
        ],
      },
    ],
  },
  {
    dir: "procurement",
    uid: "APP-PRC",
    title: "Procurement",
    prefix: "PRC-",
    intro: "Vendors, contracts, purchases, and supplier assurance for Northline. Payment execution stays in Payments. A purchase cites a contract and a registered vendor.",
    sections: [
      {
        uid: "PRC-SEC-VEN",
        title: "Vendors",
        prefix: "VEN",
        reqs: [
          req("Register first", "Procurement shall refuse a purchase order for a vendor that is not active on the register.", ["SA-9"], "vendor"),
          req("One vendor record", "Procurement shall match a new vendor to an existing record before creating a second.", ["IA-4"], "vendor"),
          req("Vendor owner", "Procurement shall require a named owner on an active vendor.", ["AC-2"], "vendor", "plt-account"),
          req("Bank on the vendor", "Procurement shall require step-up authentication when the vendor bank account changes.", ["IA-2", "AC-2"], "vendor", "plt-customer-auth", "Active", true),
          req("Inactivate", "Procurement shall stop new orders when a vendor is inactivated and shall keep the history.", ["SA-9", "AU-9"], "vendor", "plt-audit-protect"),
          req("Conflict", "Procurement shall record a disclosed personal interest before that person can approve the vendor.", ["AC-5"], "conflict", "plt-account"),
        ],
      },
      {
        uid: "PRC-SEC-BUY",
        title: "Buying",
        prefix: "BUY",
        reqs: [
          req("Requester", "Procurement shall record the requester on every purchase.", ["AU-3"], "purchase", "plt-audit-content"),
          req("Second approver", "Procurement shall require an approver other than the requester above the threshold.", ["AC-5", "AC-6"], "purchase", "plt-account", "Approved", true),
          req("Cite the contract", "Procurement shall refuse a purchase that does not cite an active contract or a documented exception.", ["SA-4"], "contract"),
          req("Split orders", "Procurement shall hold a set of orders that together exceed the requester's limit.", ["SI-4", "AC-6"], "purchase", "plt-detect"),
          req("Three-way match", "Procurement shall match the invoice to the order and the receipt before handing it to Payments.", ["AU-3"], "invoice", "plt-audit-content"),
          req("Duplicate invoice", "Procurement shall reject an invoice number already matched for that vendor.", ["SI-10"], "invoice"),
          req("After the fact", "Procurement shall flag an order created after the invoice date.", ["AU-2"], "purchase", undefined, "Draft"),
        ],
      },
      {
        uid: "PRC-SEC-ASR",
        title: "Supplier assurance",
        prefix: "ASR",
        reqs: [
          req("Security clause", "Procurement shall attach the enterprise security clause before a vendor can receive restricted data.", ["SA-4", "SA-4.9"], "supplier", "plt-vendor-feed", "Approved", true),
          req("Subprocessors", "Procurement shall record the subprocessors a vendor names for restricted data.", ["SA-9", "SR-3"], "supplier"),
          req("High-risk review", "Procurement shall require a security review before a high-risk vendor is activated.", ["SA-9", "RA-3"], "supplier", "plt-vendor-feed"),
          req("Vendor incident", "Procurement shall record a vendor's notice of an incident and shall open a security case.", ["IR-6", "SR-8"], "supplier", "plt-incident"),
          req("Remove access", "Procurement shall tell Identity to remove a vendor's access when the contract ends.", ["AC-2.3", "PS-4"], "supplier", "plt-disable"),
          req("Review the rating", "Procurement shall review a high-risk rating at least annually.", ["SA-9", "CA-2"], "supplier", "plt-assess"),
          req("Flow-down", "Procurement shall record whether the vendor flowed the security clause to its subprocessors.", ["SR-3.1", "SA-9"], "supplier", undefined, "Draft"),
        ],
      },
    ],
  },
  {
    dir: "security",
    uid: "APP-SOC",
    title: "Security operations",
    prefix: "SOC-",
    intro: "How Northline assesses controls, takes vulnerabilities, grants exceptions, and keeps evidence. The control text stays in the catalog. A requirement here conforms to that catalog identifier. It does not copy the control.",
    sections: [
      {
        uid: "SOC-SEC-ASM",
        title: "Assessments",
        prefix: "ASM",
        reqs: [
          req("Claim set", "Security shall assess the controls Northline claims and shall not invent a second identifier for a catalog control.", ["CA-2", "PL-2"], "assess", "plt-assess"),
          req("Independent assessor", "Security shall use an assessor who did not implement the control under test.", ["CA-2.2", "AC-5"], "assess", "plt-assess", "Approved", true),
          req("Result", "Security shall record met, not met, or not applicable, and the evidence the result used.", ["CA-2", "AU-3"], "assess", "plt-evidence"),
          req("Finding", "Security shall open a finding when a result is not met, with a due date and an owner.", ["CA-5"], "assess", "plt-poam"),
          req("Inherited", "Security shall name the platform requirement a product inherits instead of reassessing the platform control in every app.", ["CA-2", "PL-8"], "assess", "plt-boundary"),
          req("Continuous", "Security shall record a monitoring result between full assessments for the controls marked continuous.", ["CA-7", "CA-7.1"], "assess", "plt-assess"),
          req("Boundary", "Security shall list every system in the authorization boundary and shall refuse an undeclared production system.", ["PL-8", "CM-8"], "boundary", "plt-boundary", "Active", true),
          req("Plan", "Security shall keep one system security plan that points at this catalog and at the requirements that implement it.", ["PL-2"], "assess"),
        ],
      },
      {
        uid: "SOC-SEC-VUL",
        title: "Vulnerabilities and exceptions",
        prefix: "VUL",
        reqs: [
          req("One queue", "Security shall accept scan findings into one queue and shall keep the scanner's identifier.", ["RA-5"], "vuln-in", "plt-vuln"),
          req("Critical clock", "Security shall set the enterprise patch window as the due date of a critical finding.", ["SI-2", "RA-5"], "vuln-in", "plt-patch-time", "Approved", true),
          req("False positive", "Security shall record why a finding was marked a false positive and who decided.", ["RA-5.2", "AU-3"], "vuln-in", "plt-audit-content"),
          req("Internet first", "Security shall rank an internet-facing finding ahead of an internal finding of the same severity.", ["RA-5.3"], "vuln-in"),
          req("Image scan", "Security shall block a workload image with an open critical finding from the production registry.", ["RA-5", "SI-7"], "vuln-in", "plt-integrity"),
          req("Exception", "Security shall allow an unmet control only through an exception with an owner, a reason, and an expiry.", ["CA-5", "RA-5"], "exception", "plt-exception"),
          req("No silent renewal", "Security shall close an exception on its expiry and shall require a new approval to extend it.", ["CA-5"], "exception", "plt-exception", "Approved", true),
          req("Accept a flaw", "Security shall review an accepted vulnerability before its expiry and shall record the residual risk.", ["RA-5", "CA-5"], "accept", "plt-exception"),
          req("Exception scope", "Security shall name the systems an exception covers and shall not apply it enterprise-wide by default.", ["CA-5", "PL-8"], "exception", "plt-boundary", "Draft"),
        ],
      },
      {
        uid: "SOC-SEC-INC",
        title: "Incidents",
        prefix: "INC",
        reqs: [
          req("Open a case", "Security shall open a case with a severity and an owner when an incident is confirmed.", ["IR-4", "IR-8"], "incident", "plt-incident"),
          req("Contain", "Security shall record the containment action and the time it was taken.", ["IR-4", "AU-3"], "incident", "plt-audit-content"),
          req("Disable the account", "Security shall be able to request that Identity disable an involved account during the case.", ["IR-4", "AC-2"], "incident", "plt-disable", "Approved", true),
          req("Customer notice", "Security shall track a required customer or patient notice to a delivery result.", ["IR-6"], "threat", "plt-threat"),
          req("Lessons", "Security shall record a lesson and whether a requirement changed because of it.", ["IR-4.1"], "incident"),
          req("Roster", "Security shall use the current on-call roster from Messaging for the first notification.", ["IR-6"], "emergency", "plt-ir"),
          req("Hold the log", "Security shall place a hold on the audit records of an open incident so they are not disposed.", ["AU-11"], "hold", "plt-audit-protect"),
          req("Severity review", "Security shall review severity when the set of affected people changes.", ["IR-4", "IR-5"], "incident", "plt-incident", "Active"),
        ],
      },
      {
        uid: "SOC-SEC-EVD",
        title: "Evidence",
        prefix: "EVD",
        reqs: [
          req("Link the ticket", "Security shall link evidence to the control and to the requirement that implements it.", ["AU-3", "CA-2"], "evidence", "plt-evidence"),
          req("Not a loose file", "Security shall store evidence in the evidence store, not in a personal drive.", ["AU-9"], "evidence", "plt-evidence", "Approved", true),
          req("Sample", "Security shall record the population and the sample size an assessor used.", ["CA-2"], "evidence"),
          req("Keep evidence", "Security shall retain evidence for the life of the authorization and the following review.", ["AU-11"], "evidence", "plt-audit-retain"),
          req("Assessor export", "Security shall export an evidence package only to the named assessor role.", ["AU-6", "AC-6"], "evidence", "plt-export-gate"),
          req("Catalog is the rule", "Security shall cite the STIG vulnerability id from the catalog and shall not paste a second copy of the check text.", ["CA-2"], "evidence", "plt-evidence", "Active", true),
          req("Stale evidence", "Security shall flag evidence older than the control's assessment period.", ["CA-7"], "evidence", "plt-assess", "Draft"),
        ],
      },
    ],
  },
  {
    dir: "data",
    uid: "APP-DAT",
    title: "Data platform",
    prefix: "DAT-",
    intro: "Pipelines, the warehouse, and bulk export for Northline. A data set keeps the classification of its source. Analytics is a different purpose from care and from payment.",
    sections: [
      {
        uid: "DAT-SEC-PIP",
        title: "Pipelines",
        prefix: "PIP",
        reqs: [
          req("Workload identity", "Data shall run each pipeline as a workload identity.", ["IA-3", "IA-5"], "pipeline", "plt-pipeline-id"),
          req("No shared secret", "Data shall not store a long-lived password in a pipeline definition.", ["IA-5", "SC-28"], "pipeline", "plt-secret-cfg", "Approved", true),
          req("Lineage", "Data shall record the pipeline and the run that wrote a derived table.", ["AU-3", "CM-8"], "pipeline", "plt-lineage"),
          req("Failed run", "Data shall alert the pipeline owner when a run fails and shall not mark the table fresh.", ["AU-5", "SI-4"], "pipeline", "plt-audit-fail"),
          req("Schema change", "Data shall require a change record before a pipeline writes a new column of restricted data.", ["CM-3"], "pipeline", "plt-change"),
          req("Source classification", "Data shall carry the source classification onto the derived table.", ["AC-16"], "dataset", "plt-dataset"),
        ],
      },
      {
        uid: "DAT-SEC-WH",
        title: "Warehouse",
        prefix: "WH",
        reqs: [
          req("Named role", "Data shall issue a warehouse role to a person or a workload, not a shared login.", ["AC-2", "AC-6"], "warehouse", "plt-account", "Approved", true),
          req("Purpose", "Data shall refuse a role that does not name a purpose.", ["AC-6", "PT-2"], "analytics", "plt-purpose"),
          req("Personal schema", "Data shall keep production tables out of a personal schema.", ["AC-6", "CM-7"], "warehouse", "plt-least-fn"),
          req("Query audit", "Data shall audit the role and the person on a query of restricted data.", ["AU-2", "AU-3"], "warehouse", "plt-query-audit"),
          req("Break-glass query", "Data shall alert when a break-glass role reads a restricted table.", ["AC-6", "AU-6"], "breakglass", "plt-breakglass", "Active", true),
          req("Owner before query", "Data shall not publish a data set to the warehouse catalog without an owner.", ["PT-2", "AC-16"], "dataset", "plt-dataset"),
          req("Join to identity", "Data shall not join a warehouse extract back to a person unless the purpose allows it.", ["PT-2", "SI-12"], "analytics", "plt-purpose"),
        ],
      },
      {
        uid: "DAT-SEC-EXP",
        title: "Export and disposal",
        prefix: "EXP",
        reqs: [
          req("Approve the file", "Data shall hold a bulk export until the recorded approver releases it.", ["AC-3", "AC-6"], "export", "plt-export-gate", "Approved", true),
          req("Encrypt the file", "Data shall encrypt an export of restricted data with an enterprise-managed key.", ["SC-28"], "export", "plt-at-rest"),
          req("Name the recipient", "Data shall record the recipient and the purpose on the export.", ["AU-3", "AC-16"], "export", "plt-audit-content"),
          req("Expire the link", "Data shall expire a download link and shall not leave the file at a stable address.", ["AC-12"], "export", "plt-session"),
          req("De-identify outbound", "Data shall remove direct identifiers before an export leaves the enterprise for analytics.", ["SI-12", "PT-2"], "deident", "plt-copy-dispose"),
          req("Dispose the copy", "Data shall delete an analytics copy when Records disposes the source.", ["SI-12", "MP-6"], "copy-dispose", "plt-copy-dispose"),
          req("Size", "Data shall require a second approver when an export exceeds the configured row count.", ["AC-6"], "export", "plt-export-gate", "Draft"),
        ],
      },
    ],
  },
];

interface Built {
  uid: string;
  key?: string;
}

function req(
  title: string,
  shall: string,
  nist: string[],
  cap: string,
  plt?: string,
  status?: Status,
  stig?: boolean,
  supersedes?: boolean,
): Req {
  return { title, shall, nist, cap, plt, status: status ?? "Active", stig, supersedes };
}

function renderSection(section: Sec, chain: string[], uids: Map<string, string>, stigOf: () => string | undefined): string {
  const nextChain = section.prefix ? [...chain, section.prefix] : chain;
  const parts: string[] = [];
  let serial = 0;
  let previous = "";
  for (const item of section.reqs ?? []) {
    serial += 1;
    const uid = `${joinChain(nextChain)}${String(serial).padStart(3, "0")}`;
    if (item.key) uids.set(item.key, uid);
    const relations: { role: string; value: string }[] = [];
    if (item.cap) relations.push({ role: "Refines", value: uids.get(item.cap) ?? item.cap });
    if (item.plt) relations.push({ role: "Refines", value: uids.get(item.plt) ?? item.plt });
    if (item.supersedes && previous) relations.push({ role: "Refines", value: previous });
    for (const control of item.nist ?? []) relations.push({ role: "ConformsTo", value: control });
    if (item.stig) {
      const rule = stigOf();
      if (rule) relations.push({ role: "ConformsTo", value: rule });
    }
    const lines = ["[REQUIREMENT]", `UID: ${uid}`, `TITLE: ${item.title}`, `STATEMENT: ${item.shall}`];
    if (item.rationale) lines.push(`RATIONALE: ${item.rationale}`);
    if (item.supersedes && previous) lines.push(`COMMENT: Replaces ${previous}. The earlier requirement stays as approved.`);
    lines.push(`STATUS: ${item.status ?? "Active"}`);
    if (relations.length > 0) {
      lines.push("RELATIONS:");
      for (const relation of relations) {
        lines.push("- TYPE: Parent", `  ROLE: ${relation.role}`, `  VALUE: ${relation.value}`);
      }
    }
    parts.push(lines.join("\n"));
    previous = uid;
  }
  for (const child of section.children ?? []) parts.push(renderSection(child, nextChain, uids, stigOf));
  const prefix = section.prefix ? `PREFIX: ${section.prefix}\n` : "";
  return `[[SECTION]]\nUID: ${section.uid}\n${prefix}TITLE: ${section.title}\n\n${parts.join("\n\n")}\n[[/SECTION]]`;
}

function joinChain(parts: string[]): string {
  return parts
    .filter((part) => part.trim().length > 0)
    .map((part) => (part.endsWith("-") ? part : `${part}-`))
    .join("");
}

function document(input: {
  title: string;
  uid: string;
  prefix?: string;
  grammar: string;
  intro: string;
  body: string;
}): string {
  const prefix = input.prefix ? `PREFIX: ${input.prefix}\n` : "";
  return `[DOCUMENT]
TITLE: ${input.title}
UID: ${input.uid}
VERSION: 1.0.0
DATE: 2026-09-30
CLASSIFICATION: Internal
${prefix}ROOT: False

[GRAMMAR]
IMPORT_FROM_FILE: ${input.grammar}

[TEXT]
STATEMENT: ${input.intro}

${input.body}
`;
}

function releases(uids: Map<string, string>): string {
  const cap = (key: string) => {
    const uid = uids.get(key);
    if (!uid) throw new Error(`Missing capability ${key}`);
    return uid;
  };
  const sprints: { uid: string; title: string; items: { uid: string; version: string; channel: string; status: string; date?: string; description: string; caps: string[] }[] }[] = [
    {
      uid: "ENT-SPR-26-1",
      title: "2026 Sprint 1",
      items: [
        drop("REL-26.1.1", "26.1.1", "upkeep", "shipped", "2026-02-13", "Workforce sign-in and account records.", ["workforce", "joiner"]),
        drop("REL-26.1.2", "26.1.2", "upkeep", "shipped", "2026-02-27", "Session control and customer sign-in.", ["session", "customer"]),
        drop("REL-26.1.3", "26.1.3", "upkeep", "shipped", "2026-03-13", "Privileged access and partner federation.", ["privileged", "federation"]),
        drop("REL-26.1.4", "26.1.4", "maintenance", "shipped", "2026-03-27", "Break-glass and non-person identity.", ["breakglass", "npe"]),
        drop("REL-26.1.5", "26.1.5", "security-only", "shipped", "2026-04-03", "Security-only update of privileged access. The 26.1.3 drop stays as shipped.", ["privileged"]),
      ],
    },
    {
      uid: "ENT-SPR-26-2",
      title: "2026 Sprint 2",
      items: [
        drop("REL-26.2.1", "26.2.1", "upkeep", "shipped", "2026-04-24", "Official records and retention.", ["record", "retention"]),
        drop("REL-26.2.2", "26.2.2", "upkeep", "shipped", "2026-05-08", "Legal hold and consent.", ["hold", "consent"]),
        drop("REL-26.2.3", "26.2.3", "upkeep", "shipped", "2026-05-22", "Subject access and de-identification.", ["access", "deident"]),
        drop("REL-26.2.4", "26.2.4", "upkeep", "shipped", "2026-06-05", "Payment initiation and approval.", ["initiate", "approve"]),
        drop("REL-26.2.5", "26.2.5", "maintenance", "shipped", "2026-06-19", "Screening, reconciliation, refunds, and settlement.", ["screen", "reconcile", "refund", "settle"]),
      ],
    },
    {
      uid: "ENT-SPR-26-3",
      title: "2026 Sprint 3",
      items: [
        drop("REL-26.3.1", "26.3.1", "upkeep", "shipped", "2026-07-17", "Patient registration and scheduling.", ["register", "schedule"]),
        drop("REL-26.3.2", "26.3.2", "upkeep", "shipped", "2026-07-31", "Chart access and prescribing.", ["chart", "prescribe"]),
        drop("REL-26.3.3", "26.3.3", "upkeep", "planned", undefined, "Results release and encounter billing.", ["results", "billing"]),
        drop("REL-26.3.4", "26.3.4", "upkeep", "planned", undefined, "Workforce and patient messaging.", ["work-msg", "patient-msg"]),
        drop("REL-26.3.5", "26.3.5", "upkeep", "planned", undefined, "Notices and emergency notification.", ["notice", "emergency"]),
      ],
    },
    {
      uid: "ENT-SPR-26-4",
      title: "2026 Sprint 4",
      items: [
        drop("REL-26.4.1", "26.4.1", "upkeep", "planned", undefined, "Device enrollment and patch compliance.", ["enroll", "patch"]),
        drop("REL-26.4.2", "26.4.2", "upkeep", "planned", undefined, "Removable media and lost devices.", ["media", "lost"]),
        drop("REL-26.4.3", "26.4.3", "upkeep", "planned", undefined, "Warehouse receipt and inventory.", ["receipt", "inventory"]),
        drop("REL-26.4.4", "26.4.4", "upkeep", "planned", undefined, "Shipment tender and chain of custody.", ["tender", "custody"]),
        drop("REL-26.4.5", "26.4.5", "upkeep", "planned", undefined, "Public publishing, anonymous requests, withdrawal, and abuse handling.", ["publish", "anonymous", "withdraw", "abuse"]),
        drop("REL-26.4.6", "26.4.6", "security-only", "planned", undefined, "Security-only maintenance planned for device enrollment. No new capability.", ["enroll"]),
      ],
    },
    {
      uid: "ENT-SPR-26-5",
      title: "2026 Sprint 5",
      items: [
        drop("REL-26.5.1", "26.5.1", "upkeep", "shipped", "2026-09-04", "Positions of record and the separation checklist.", ["position", "separation"]),
        drop("REL-26.5.2", "26.5.2", "upkeep", "shipped", "2026-09-18", "Training assignments and contractor access.", ["training", "contractor"]),
        drop("REL-26.5.3", "26.5.3", "upkeep", "shipped", "2026-09-25", "Vendor register and purchase approval.", ["vendor", "purchase"]),
        drop("REL-26.5.4", "26.5.4", "upkeep", "planned", undefined, "Invoice match and supplier assurance.", ["invoice", "supplier"]),
        drop("REL-26.5.5", "26.5.5", "upkeep", "planned", undefined, "Time records and payroll access.", ["time", "payroll"]),
        drop("REL-26.5.6", "26.5.6", "maintenance", "planned", undefined, "Contract obligations and conflict checks.", ["contract", "conflict"]),
      ],
    },
    {
      uid: "ENT-SPR-26-6",
      title: "2026 Sprint 6",
      items: [
        drop("REL-26.6.1", "26.6.1", "upkeep", "planned", undefined, "Control assessment and the authorization boundary.", ["assess", "boundary"]),
        drop("REL-26.6.2", "26.6.2", "upkeep", "planned", undefined, "Vulnerability intake, exceptions, and accepted flaws.", ["vuln-in", "exception", "accept"]),
        drop("REL-26.6.3", "26.6.3", "upkeep", "planned", undefined, "Incident records and threat notices.", ["incident", "threat"]),
        drop("REL-26.6.4", "26.6.4", "upkeep", "planned", undefined, "Evidence packages for assessment.", ["evidence"]),
        drop("REL-26.6.5", "26.6.5", "upkeep", "planned", undefined, "Pipelines, the warehouse, and the dataset catalog.", ["pipeline", "warehouse", "dataset"]),
        drop("REL-26.6.6", "26.6.6", "upkeep", "planned", undefined, "Bulk export, analytics purpose, and disposal of copies.", ["export", "analytics", "copy-dispose"]),
        drop("REL-26.6.7", "26.6.7", "security-only", "planned", undefined, "Security-only update for vulnerability intake. The 26.6.2 drop stays as planned scope, not a rewrite.", ["vuln-in"]),
      ],
    },
  ];
  function drop(uid: string, version: string, channel: string, status: string, date: string | undefined, description: string, keys: string[]) {
    return { uid, version, channel, status, date, description, caps: keys.map(cap) };
  }
  const body = sprints
    .map((sprint) => {
      const releases = sprint.items
        .map((item) => {
          const date = item.date ? `DATE: ${item.date}\n` : "";
          const relations = item.caps
            .map((value) => `- TYPE: Child\n  ROLE: Delivers\n  VALUE: ${value}`)
            .join("\n");
          return `[RELEASE]\nUID: ${item.uid}\nTITLE: Release ${item.version}\nVERSION: ${item.version}\nCHANNEL: ${item.channel}\nSTATUS: ${item.status}\n${date}DESCRIPTION: ${item.description}\nRELATIONS:\n${relations}`;
        })
        .join("\n\n");
      return `[[SECTION]]\nUID: ${sprint.uid}\nTITLE: ${sprint.title}\n\n${releases}\n[[/SECTION]]`;
    })
    .join("\n\n");
  return document({
    title: "Northline releases",
    uid: "APP-REL",
    grammar: "../grammar/release.sgra",
    intro: "One release train for Northline. A sprint is a section. A shipped release stays as written. A later change is a new release. Delivers points at a capability.",
    body,
  });
}

async function stigPool(): Promise<() => string | undefined> {
  const text = await readFile(join(root, "catalog", "asd-stig-v6r4.sdoc"), "utf8");
  const parsed = parse(text);
  if (!parsed.document) throw new Error(parsed.errors.map((issue) => issue.message).join("; "));
  const high = flatten(parsed.document.nodes)
    .filter((row) => row.node.tag === "REQUIREMENT" && fieldOf(row.node, "SEVERITY") === "High")
    .map((row) => nodeUid(row.node))
    .filter((uid) => uid.length > 0);
  let index = 0;
  return () => {
    const uid = high[index % high.length];
    index += 1;
    return uid;
  };
}

async function main(): Promise<void> {
  const stigOf = await stigPool();
  const uids = new Map<string, string>();
  const capBody = caps.map((section) => renderSection(section, ["ENT-"], uids, stigOf)).join("\n\n");
  const platformBody = platform.map((section) => renderSection(section, ["PLT-"], uids, stigOf)).join("\n\n");
  const files = new Map<string, string>();
  files.set(
    "apps/capabilities.sdoc",
    document({
      title: "Northline capabilities",
      uid: "APP-CAP",
      prefix: "ENT-",
      grammar: "../grammar/org.sgra",
      intro: "Enterprise capabilities for Northline, a fictional company: identity, records, payments, the Harbor clinic, messaging, endpoints, logistics, the public portal, workforce, procurement, security operations, and the data platform. Applications refine these. NIST and STIG identifiers stay in the catalog.",
      body: capBody,
    }),
  );
  files.set(
    "apps/platform/SYS.sdoc",
    document({
      title: "Northline platform",
      uid: "APP-PLT",
      prefix: "PLT-",
      grammar: "../../grammar/org.sgra",
      intro: "Shared platform obligations. Each requirement refines a capability and conforms to NIST SP 800-53. Some also conform to an ASD STIG rule.",
      body: platformBody,
    }),
  );
  for (const app of apps) {
    const body = app.sections.map((section) => renderSection(section, [app.prefix], uids, stigOf)).join("\n\n");
    files.set(
      `apps/${app.dir}/SYS.sdoc`,
      document({
        title: app.title,
        uid: app.uid,
        prefix: app.prefix,
        grammar: "../../grammar/org.sgra",
        intro: app.intro,
        body,
      }),
    );
  }
  files.set("apps/releases.sdoc", releases(uids));
  for (const [rel, text] of files) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text.endsWith("\n") ? text : `${text}\n`);
  }
  await check(files);
  const counts = [...files.entries()].map(([rel, text]) => {
    const parsed = parse(text);
    const nodes = parsed.document ? flatten(parsed.document.nodes) : [];
    const reqs = nodes.filter((row) => row.node.tag === "REQUIREMENT" || row.node.tag === "RELEASE").length;
    return `${rel} ${reqs}`;
  });
  console.log(counts.join("\n"));
  console.log("keys", uids.size);
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, out);
    else if (entry.name.endsWith(".sdoc") || entry.name.endsWith(".sgra")) out.push(abs);
  }
}

async function check(generated: Map<string, string>): Promise<void> {
  const paths: string[] = [];
  await walk(root, paths);
  const texts = new Map<string, string>();
  for (const abs of paths) {
    const rel = relative(root, abs).split(sep).join("/");
    texts.set(rel, await readFile(abs, "utf8"));
  }
  const uids = new Map<string, string[]>();
  for (const [rel, text] of texts) {
    if (!rel.endsWith(".sdoc")) continue;
    const parsed = parse(text);
    if (!parsed.document || parsed.errors.some((issue) => issue.severity === "error")) {
      throw new Error(`${rel} parse ${JSON.stringify(parsed.errors.slice(0, 4))}`);
    }
    const found = [parsed.document.uid, ...flatten(parsed.document.nodes).map((row) => nodeUid(row.node))].filter(
      (uid): uid is string => Boolean(uid),
    );
    for (const uid of found) {
      const list = uids.get(uid) ?? [];
      list.push(rel);
      uids.set(uid, list);
    }
  }
  const dupes = [...uids.entries()].filter(([, files]) => files.length > 1);
  if (dupes.length > 0) {
    throw new Error(`Duplicate UIDs ${dupes.slice(0, 8).map(([uid, files]) => `${uid} (${files.join(", ")})`).join("; ")}`);
  }
  const problems: string[] = [];
  for (const rel of generated.keys()) {
    const text = texts.get(rel)!;
    const siblings: string[] = [];
    for (const [other, otherText] of texts) {
      if (other === rel || !other.endsWith(".sdoc")) continue;
      const parsed = parse(otherText);
      if (!parsed.document) continue;
      if (parsed.document.uid) siblings.push(parsed.document.uid);
      for (const row of flatten(parsed.document.nodes)) {
        const uid = nodeUid(row.node);
        if (uid) siblings.push(uid);
      }
    }
    const result = validate(text, {
      mode: "write",
      indexComplete: true,
      file: rel,
      siblingUids: siblings,
      readText: (path) => texts.get(path),
    });
    if (!result.ok) {
      problems.push(`${rel}\n${result.errors.map((issue) => `  ${issue.code ?? ""} ${issue.message}`).join("\n")}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.slice(0, 6).join("\n"));
}

await main();
