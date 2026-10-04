# Templates

Copy a file into the document root, then open it. These are starting points, not the live tree.

| Template | What it is |
|---|---|
| [grammar/org.sgra](grammar/org.sgra) | Shared grammar for requirement documents. `TEXT`, `SECTION`, and `REQUIREMENT`, including `Refines`, `Satisfies`, `Uses`, and `ConformsTo`. |
| [grammar/release.sgra](grammar/release.sgra) | Grammar for the release train. A sprint is a `SECTION`. A drop is a `RELEASE` with `CHANNEL` and `STATUS`. `Child` role `Delivers` points at a capability. |
| [releases/product.sdoc](releases/product.sdoc) | One release document. Imports `../grammar/release.sgra`. Copy both, and keep that relative path. |
| [stig/asd-v6r4.sdoc](stig/asd-v6r4.sdoc) | DISA Application Security and Development STIG, Version 6 Release 4 (1 October 2025). 286 rules. The UID is the vulnerability id (`V-222387`). Point a product requirement at a rule with `Parent` role `ConformsTo`. |
| [nist/sp-800-53-rev5.sdoc](nist/sp-800-53-rev5.sdoc) | NIST SP 800-53 Revision 5.2.0 (11 May 2026). 20 families, 324 controls, and 872 enhancements. UID `AC-2.1` is enhancement AC-2(1). `BASELINE` is the lowest SP 800-53B selection. Link a product requirement with `Parent` role `ConformsTo`. |

The STIG file is the public rule list. Check and fix text stays in the official benchmark. The NIST file is the control statement, not the guidance or the assessment procedures.
