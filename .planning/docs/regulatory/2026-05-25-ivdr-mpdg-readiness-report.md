# VarLens — IVDR / MPDG / ISO 13485 Regulatory Readiness Report

> **Status:** Draft v1.0 — assessment of the VarLens codebase against EU IVDR (2017/746), MDR-relevant cross-references, German MPDG, and the harmonised standards stack (IEC 62304, ISO 14971, IEC 62366-1, ISO 13485, MDCG 2019-16, ISO 81001-1, IEC 82304-1).
>
> **Author role:** Acting as QM Manager / Regulatory Affairs lead with experience in IVDR transition, ISO 13485, and MPDG, drawing on a codebase audit produced by three parallel reviewer agents and corpus-grounded references from MDR-MCP.
>
> **Repository state at audit:** branch `web/03-web-app-openapi`, `package.json` version `0.61.0`, head `2ef6bd0a feat(web): add Fastify app and OpenAPI routes`.
>
> **Scope of the assessment:** the offline Electron desktop app (`src/main/`, `src/preload/`, `src/renderer/`) **and** the in-development Postgres-backed web/server variant in `src/web/`. Both are evaluated, because the moment a server-hosted variant exists the regulatory profile changes materially.
>
> **Important caveat:** this is a developer-side technical/process readiness report. It is **not** a notified-body conformity assessment, **not** a legal opinion, and **not** a substitute for a contracted regulatory affairs consultant. It is intended to drive the engineering and QMS preparation work that must be done before any of the realistic compliance paths can be selected.

---

## 0. Executive Summary

VarLens is, today, **research-grade software with a clear "Research Use Only" disclaimer in the UI** (`src/renderer/src/config/disclaimerConfig.json`, lines 1–34). It is **architecturally well-built** (strict Electron sandbox/contextIsolation, typed IPC contract, encrypted SQLite with Argon2id-derived keys, no telemetry, no PHI egress, signed Windows builds, fully declared Electron fuse baseline, secrets scan in CI). For a developer-led project the security and engineering hygiene is unusually strong.

However, against the IVDR / MPDG conformity bar, the **process and documentation layer is materially absent**:

- No formal **intended purpose** statement, **labelling**, or **instructions for use** (only an in-app RUO splash).
- No declared **software safety class** (IEC 62304: A / B / C).
- No **risk management file** (ISO 14971), no **hazard analysis**, no **risk-control traceability**.
- No **usability engineering file** (IEC 62366-1), no formative/summative evaluations.
- No **clinical / performance evaluation** (IVDR Annex XIII): no scientific validity, analytical performance, or clinical performance evidence package.
- No **QMS** documentation aligned to ISO 13485 (no SOPs, no design history file, no change-control procedure, no CAPA, no supplier control of the third-party APIs and the SQLCipher fork).
- **PHI / clinical identifiers leak into the main-process log file** (`~/.config/varlens/logs/main.log`) — this is the single highest-impact technical gap if VarLens is ever used on real cases (confirmed in `.planning/code-review/CODEBASE-AUDIT-2026-05-25.md`).
- The new Postgres-backed **web variant** (`src/web/server.ts`) introduces server-side processing of patient-adjacent data and shifts the regulatory profile from "local tool that never sees a network" to "potentially multi-tenant clinical software" — depending on deployment.

The Codex / TL;DR for the project owner is in §11 (Action Plan). The summary verdict:

| Question | Answer |
| --- | --- |
| Is VarLens **today** legally compliant for clinical use as an IVD? | **No.** Not because of code quality, but because none of the IVDR/MPDG **process artefacts** exist. |
| Is the current RUO labelling sufficient if VarLens is **only** used for research, on the developer's machine? | **Yes**, subject to §3 caveats and the GDPR/BDSG points in §6. |
| If a clinical lab wants to use VarLens to **inform diagnosis**, what is the realistic path? | The **IVDR Article 5(5) "in-house IVD" exemption**, *or* the lab continues to use external CE-marked tools and treats VarLens output as an "investigational/research input" reviewed by a qualified person — see §3.2 and §3.3. |
| What does it take to **CE-mark and place VarLens on the market**? | Full IVDR conformity assessment as an IVD-MDSW, very likely **Class B or C under Rule 3** (genetic disorders / inherited conditions) — see §2.3. That is a 12–24 month, multi-FTE program. |
| Is the current architecture **a good foundation** for any of these paths? | **Yes.** The hard things (encryption, IPC isolation, signed builds, secrets scan, audit-log IPC stubs, no PHI egress) are already in place. The missing layer is **documentation and process**, not code. |

---

## 1. What VarLens Is, From a Regulatory Lens

### 1.1 Product description (as the regulator will read it)

From `AGENTS.md` and the audit:

> VarLens is an Electron desktop application that imports annotated genetic variant data (JSON / VCF), stores it in a local encrypted SQLite database, and provides filtering, cohort analysis, **ACMG classification support**, **HPO phenotype matching**, **variant ranking by HPO similarity**, and **export** (CSV / JSON / PDF) for clinical geneticists and researchers.

This is the description that drives every regulatory decision below. The product owner should formalise this into a written **Intended Purpose** statement (§4.1), because the words chosen there decide qualification, classification, and scope.

### 1.2 Functional features that matter to the regulator

Confirmed in the codebase:

| Feature | Implementation | Regulatory relevance |
| --- | --- | --- |
| Variant import (JSON, VCF VEP/SnpEff) | `src/main/import/`, `vcf/VcfStrategy.ts` | Input handling — analytical performance scope |
| Encrypted SQLite case database | `better-sqlite3-multiple-ciphers`, key handling in `DatabaseService.ts:63-79`, Argon2id-derived | Data-at-rest cybersecurity (MDCG 2019-16) |
| ACMG classification UI | `src/renderer/src/utils/acmg/acmg-calculator.ts:19-80` | Clinical decision support |
| HPO similarity scoring stored per variant | `database-schema.ts:39`, `variant_transcripts.hpo_sim_score` (`:69`) | Ranking that "drives clinical management" (MDCG 2019-11 IVD MDSW criteria) |
| Multi-sample VCF → one case per selected sample | `VcfStrategy.ts:74-75` | Data segregation — patient-data integrity |
| External APIs: VEP, gnomAD, SpliceAI, UniProt, InterPro, HPO, PanelApp, AlphaFold | `src/main/services/api/*` | Reliance on third-party data — supplier control under ISO 13485 7.4 |
| Web/Fastify backend (Postgres-only) | `src/web/server.ts` | Server-side processing of clinical-adjacent data — changes risk profile |
| Audit-log IPC domain | `src/shared/ipc/domains/audit-log.ts` | Traceability / electronic-records hooks |

### 1.3 What VarLens **does not** do (and that matters)

- **It does not ingest raw IVD-instrument output.** It ingests pre-annotated VCF / JSON. This is regulatory significant — see §2.2 on MDCG 2019-11 IVD-data sourcing.
- **It does not auto-generate an ACMG classification.** The calculator at `acmg-calculator.ts:61-80` tallies user-entered evidence codes; it is decision *support*, not autonomous classification.
- **It does not push data to a cloud.** Every external call is metadata-only (variant coordinates, gene symbols, HPO terms). No PHI egress.
- **It does not perform diagnosis.** It supports a qualified user who performs the diagnosis.

These four "does not"s are load-bearing for an Article 5(5) (in-house) defence or a "research / decision-support tool" intended-purpose argument. If the product later auto-generates classifications, ranks variants for clinical action without human review, or sends data to a managed cloud service, the regulatory burden **escalates immediately**.

---

## 2. Software Qualification & Classification

### 2.1 Is VarLens "software"? Is it a "medical device"?

Per MDCG 2019-11 rev.1 (Article 2, p. 9):

> *"In order to be qualified as MDSW, the product must first fulfil the definition of software according to this guidance and the definition of a medical device according to Article 2(1) of Regulation (EU) 2017/745 - MDR. To be qualified as an in vitro diagnostic MDSW (IVD MDSW), the product must additionally fulfil the definition of an in vitro diagnostic medical device according to Article 2(2) of Regulation (EU) 2017/746 - IVDR."*
> — MDCG 2019-11 rev.1, citation block in MDR-MCP `psg_dcdc301ee7780b66b1311866541c453cea645ac2c0ed830070c695edc926eb6b`.

VarLens is software. Whether it is a **medical device** turns entirely on its **intended purpose** (Article 2(1) MDR, Article 2(2) IVDR — definition reiterated in MDCG 2019-11 rev.1, p. 5):

> *"'Intended purpose' means the use for which a device is intended according to the data supplied by the manufacturer on the label, in the instructions for use or in promotional or sales materials or statements or as specified by the manufacturer in the performance evaluation."*

This is why §4.1 (the written Intended Purpose statement) is the most important *regulatory* deliverable in this entire report. The wording the product owner chooses **decides** whether VarLens is MDSW.

### 2.2 IVD or MDR?

Per MDCG 2019-11 rev.1, p. 15:

> *"If the information provided is based on data obtained solely from in vitro diagnostic medical devices, then the software is an in vitro diagnostic medical device and is therefore an IVD MDSW."*

VarLens processes **annotated variant data** (VCF / JSON) that almost always originates from NGS sequencers and the bioinformatics pipelines that consume them — both are in-vitro-diagnostic data sources. If VarLens is intended to inform *clinical* decisions, **IVDR is the applicable regulation** (not MDR).

### 2.3 IVDR risk class — Rule 3

IVDR classification rules are summarised in MDCG 2019-11 rev.1 §5 (p. 20: *"Classification and implementing rules per IVDR 2017/746"*). The decisive rule for genetic variant interpretation is **Rule 3** of IVDR Annex VIII, which classifies devices "intended for use in… the management of patients suffering from a life-threatening disease or condition, or where the result will have a major impact on patient management decisions" and explicitly covers **"detection of genetic disorders"** as Class C.

Realistic outcome for VarLens, assuming an intended purpose in the clinical-diagnostic-support space:

| Use scenario | Probable IVDR class | Reasoning |
| --- | --- | --- |
| Used in a clinical lab to **inform** diagnosis of a Mendelian genetic disorder | **Class C** | Rule 3 — genetic disorders, output influences management of life-altering inherited disease |
| Used **only** as a research/exploration tool, classifications never used in clinical decisions | Not an IVD | Outside IVDR scope provided labelling, traceability, and actual usage match — see MDCG 2020-1 RUO discussion |
| Used as a **companion-diagnostic** tool (e.g. variant interpretation for therapy selection) | **Class C+** | Rule 3, companion diagnostic |

The "Rule 11" comparison table referenced in MDR-MCP `psg_563aba8614f658ba0aadec558c6abba64e76073df55c876c2cc1e2ba81f53ed3` (MDCG 2019-11 rev.1 §5.1.1, p. 34) — IMDRF risk categorisation grid — also points to **Class IIb / III equivalent** for software that *drives or treats/diagnoses* in a *serious / critical* condition. Heritable disease management = serious. Variant ranking + ACMG = drives clinical management. The conservative regulatory assumption is therefore **IVDR Class C**.

### 2.4 Software safety class under IEC 62304

IEC 62304:2006+Amd1:2015 (citation: `psg_b34841878a8376dc0cf007aea59642bf7f8e9dc1b818849d6772d73262beadd8`, `psg_5db3410cce6d1abae9216ced4ba58a2f5499e5ea989336a23f497a17921f2092`, `psg_70cadd1e12e3bb4db43381909e9d0165b4e46999b1979f85f4109cf4d0287bdc`) requires the manufacturer to assign an A / B / C class based on hazard severity:

| Class | Definition (paraphrased) | VarLens fit |
| --- | --- | --- |
| A | No injury or damage to health possible | Plausible *only* under a strict RUO intended purpose with a qualified user in the loop |
| B | Non-serious injury possible | Realistic class if used for clinical decision support with human-in-the-loop |
| C | Death or serious injury possible | Realistic class if used in companion-diagnostic / therapy-selection contexts |

For the **in-house / clinical decision-support** scenario, the working assumption should be **Class B**, with documented justification of why the human-in-the-loop ACMG calculator (`acmg-calculator.ts:61-80` — user enters evidence codes; the app does not classify autonomously) and the qualified-user requirement prevent escalation to Class C. If a future feature auto-classifies a variant as Pathogenic without explicit user-confirmation of every ACMG code, **the product moves to Class C**.

---

## 3. The Three Compliance Paths

There are three realistic regulatory trajectories. Each one's documentation and engineering burden is described in §4–§10.

### 3.1 Path A — Stay RUO (Research Use Only), forever

**What it means:** VarLens is labelled, distributed, and *actually used* only for research. No clinical decisions are made from its output. The current `disclaimerConfig.json` text is the entry-level form of this — it needs strengthening (§4.1, §5.4).

**Burden:** Lowest. No CE mark, no notified-body involvement, no IVDR Annex XIII performance evaluation.

**Constraints:**

- **GDPR / BDSG / DSGVO still apply** the moment a real patient's variants are loaded — research use does not exempt you from data-protection law (§6).
- The **labelling has to match real usage**. If a clinical lab in Germany ingests RUO output into a diagnostic report without independent CE-marked verification, the lab is using the tool **as an in-house IVD without the Article 5(5) framework**, which would be a violation by the *lab*, not by VarLens — but it would be a deeply uncomfortable position for the developer.
- The current splash text ("This tool is intended for research purposes only…", `disclaimerConfig.json:8`) is good but should be reinforced with a click-through acknowledgement, persistent footer marking, and an explicit statement in every exported PDF/CSV (§4.1).

**Recommended if:** VarLens stays an internal/personal research tool, a teaching tool, or is published as open-source for the research community only.

### 3.2 Path B — Article 5(5) IVDR "in-house IVD" within a health institution

This is the most realistic path for **continued use in a German university hospital or NDD/rare-disease research consortium**.

Per MDCG 2025-6 (interplay of MDR/IVDR/AI Act), Article 5, p. 26:

> *"MDR/IVDR in-house developed medical devices and in vitro diagnostic medical devices manufactured and used only within health institutions established in the Union are not subject to third-party conformity assessment, provided that the conditions of Article 5(5) are met."*
> — MDR-MCP `psg_a294b626537b192d351360509be8a22a5532936936bbadca3027da15d57267d9`.

Per MDCG 2021-5 rev.1, Article 5, p. 8 (`psg_828dc34001e46afd8ac8cd6994912b880d50f332a2639060c5cbdbd5b58a2763`):

> *"Article 5(5)(c) IVDR contains a reference to standard EN ISO 15189 […] which has a different role. It defines a condition which needs to be met by health institutions when making use of exceptions, i.e. 'the laboratory of the health institution is compliant with standard EN ISO 15189 or where applicable national provisions, including national provisions regarding accreditation'."*

**Conditions of Article 5(5) IVDR (paraphrased; verify against the IVDR text — note that the MDR-MCP corpus listed "IVDR 2017/746 and IVD Guidance" as a known *missing source* so the regulatory file must be built against the official Eur-Lex text):**

a. Devices are not transferred to another legal entity.
b. Manufacture and use are under a QMS appropriate to the activity.
c. The laboratory is compliant with **EN ISO 15189** (or, in Germany, equivalent national accreditation provisions).
d. The institution justifies in its documentation that the target patient group's specific needs cannot be met (or cannot be met at the appropriate performance level) by an equivalent device available on the market.
e. The institution provides information on use of such devices to its competent authority upon request, including the justification of manufacture, modification and use.
f. The institution draws up a declaration covering: name and address of manufacturing health institution, details necessary to identify the device, declaration that the device meets the GSPRs of Annex I IVDR, and any deviation must be reasoned.
g. For Class C and D devices, the institution **draws up documentation** that makes it possible to understand the design, manufacture, intended purpose, **scientific validity, analytical performance** and (where relevant) **clinical performance** of the device.
h. The institution **takes all necessary corrective action** in light of experience.
i. PMS-equivalent monitoring under MDCG 2025-10 Article 5, p. 4 (`psg_c8d419650acacf0d8bd2518001b0522a25b9bb789b19c404fa5abb42ce7c15b5`):

> *"This guidance does not cover the requirements for health institution exemption under Article 5(5) MDR/IVDR (in-house devices), though it is expected that health institutions review experience gained from the use of in-house devices and take all necessary corrective actions."*

**Burden:** Significant but proportionate. The developer team needs to produce a Class-C-grade technical file (§4–§10) but no notified body sign-off. The health institution's QM organisation owns the QMS overhead.

**Recommended if:** VarLens is intended to be used in a single hospital / consortium of hospitals in clinical workflows. This is the path most academic-lab-developed software in Germany takes (e.g. Charité, MHH, U. Heidelberg).

### 3.3 Path C — Full IVDR CE-marking, place on the EU market

Full conformity assessment as a Class B or Class C IVD MDSW. Notified-body involvement, full ISO 13485 QMS, full performance evaluation under IVDR Annex XIII.

**Burden:** Very high. 12–24 months full-time-equivalent commitment from a multi-disciplinary team (RA, QM, engineering, clinical affairs). Multiple six-figure spend (notified body fees, performance studies, QMS infrastructure).

**Recommended if:** VarLens becomes a commercial product distributed by a legal entity beyond a single institution. The product owner must be prepared to be the **legal manufacturer**, with all the liabilities that entails (IVDR Article 10, MPDG §§ 27–32 — incident reporting, product liability under Produkthaftungsgesetz).

For a single-developer academic project, **Path C is not realistic without institutional / corporate backing**. The remainder of this report treats Path B as the working assumption and Path C as the aspirational stretch goal.

---

## 4. Documentation Deliverables Required (Path B baseline)

The artefacts below are the **minimum documentation set** for IVDR Article 5(5) compliance, with cross-references to the standards and guidance that demand each item. None of these are large files individually; the work is in writing them well, keeping them under change-control, and traceably linking them.

### 4.1 Intended Purpose, Indications, Contraindications

A short (1–3 page) document anchored as the source-of-truth that everything downstream (risk file, performance evaluation, IFU, labelling) cites.

Must state:

- Intended user (e.g. "Board-certified clinical geneticist working in a CLIA/ISO 15189-accredited laboratory").
- Intended use environment (offline desktop / institutional server).
- Intended patient population and clinical context.
- Specific decisions the software supports (variant filtering, evidence aggregation, ACMG-evidence book-keeping, HPO-based ranking) **and** specifically excludes (autonomous variant pathogenicity classification, clinical diagnosis without qualified user review).
- Inputs accepted (VCF format & annotation conventions, JSON schema, supported reference assemblies).
- Outputs produced and their interpretation status.
- **Contraindications and warnings**, including: not for use without independent CE-marked variant calling / annotation pipeline upstream, not for use without qualified user, not for use on samples from patients without informed consent for genetic analysis.

Deliverable: `.planning/specs/intended-purpose.md` plus a published version of the same text in `docs/` (the VitePress site, user-facing).

### 4.2 Software Safety Classification record (IEC 62304 §4.3)

Single page declaring **Class B** (working assumption), with the documented justification referring to:

- Risk file evidence that no single software failure causes serious injury without intervening human review.
- Architecture-level evidence: e.g. the ACMG calculator does not autoclassify, the renderer-side controls require explicit user confirmation, exports are user-initiated.

Deliverable: `.planning/specs/software-safety-class.md`.

### 4.3 Risk Management File (ISO 14971:2019, ISO/TR 24971:2020)

Per IEC 62304 §7 (citation `psg_70cadd1e12e3bb4db43381909e9d0165b4e46999b1979f85f4109cf4d0287bdc`):

> *"Rather than trying to define an appropriate RISK MANAGEMENT PROCESS in this software engineering standard, it is required that the MANUFACTURER apply a RISK MANAGEMENT PROCESS that is compliant with ISO 14971 […]."*

And `psg_dcbb6a2d15d4eca12a69a5426ce0eb4013966c8d1c464dc1ae1c5a1e3fa785c5`:

> *"Software RISK MANAGEMENT is a part of overall MEDICAL DEVICE RISK MANAGEMENT and cannot be adequately addressed in isolation. […] The software RISK MANAGEMENT PROCESS in this standard is intended to provide manufacturers with a framework for management of these RISKS."*

Required contents of the Risk Management File:

1. **Risk management plan** (ISO 14971 §4.4) covering scope, lifecycle phases, criteria for risk acceptability, roles.
2. **Hazard identification** (ISO 14971 §5) — domain hazards specific to variant interpretation, e.g. *"Variant misclassified due to incorrect HGVS notation parsing"*, *"Wrong reference assembly used (GRCh37 vs GRCh38) causes incorrect interpretation"*, *"PHI leaks into log files"*, *"Annotation cache returns stale frequency data leading to misleading classification"*.
3. **Risk analysis** — probability × severity per hazard.
4. **Risk controls** — software requirements that mitigate each hazard, traceable to code (e.g. assembly mismatch detection → `src/main/import/...`; URL allow-list → `src/main/utils/url-validation.ts`; encryption-key guard → `src/main/database/sqlcipher-key-guard.ts`; key-must-be-first-pragma invariant → `db-worker.ts:75-76`).
5. **Residual risk evaluation**.
6. **Risk-management review** at every release.

Deliverable: `.planning/risk/risk-management-plan.md`, `.planning/risk/hazard-log.csv`, `.planning/risk/risk-control-traceability.md`.

The hazard log should be **machine-readable** (CSV / JSON) so that the audit-log IPC domain (`src/shared/ipc/domains/audit-log.ts`) can reference hazard IDs in change history. This is the kind of traceability that makes IVDR audits painless.

### 4.4 Software Development Plan (IEC 62304 §5.1)

The lifecycle process description. Must describe:

- Deliverables per phase.
- Development model (incremental — fits the repo's actual practice).
- Standards applied (IEC 62304, ISO 14971, IEC 62366-1, MDCG 2019-16, ISO 81001-1, IEC 82304-1).
- Coding standards (already present: `eslint.config.mjs`, `AGENTS.md` "Code Style").
- Configuration management (already present: Git + `package-lock.json` + Dependabot).
- Verification and validation strategy (Vitest + Playwright; gaps in §10.2).

Deliverable: `.planning/specs/software-development-plan.md`.

This document should reference, not duplicate, AGENTS.md / CLAUDE.md, which already encode much of this process.

### 4.5 Software Requirements Specification (IEC 62304 §5.2)

Numbered, atomic, testable requirements (REQ-SYS-001, REQ-IMP-001, REQ-FLT-001, …) with traceability to:

- Intended Purpose statements
- Risk controls (hazard IDs from §4.3)
- Test cases (Vitest / Playwright file paths)

The repo currently has requirements **in narrative form** in `.planning/specs/`. The QM-grade upgrade is to assign IDs and maintain a traceability matrix (§10.1).

### 4.6 Architecture / Detailed Design (IEC 62304 §5.3 / §5.4)

The good news: the architecture is already excellent and documented in `AGENTS.md`. What is missing is the **formal architecture document** that consolidates:

- Process separation (main, preload, renderer, workers).
- IPC contract (`src/shared/ipc/domains/`).
- Data flow diagrams for: import (JSON / VCF → DB), query (renderer → IPC → DB), export (DB → worker → file), external-API calls (cache-first, allow-listed hosts).
- Trust boundaries (where user-supplied data crosses a security boundary).
- SOUP inventory (§4.7).

Deliverable: `.planning/specs/architecture.md` + diagrams in `.planning/diagrams/` (PlantUML / Mermaid).

### 4.7 SOUP / Third-Party Software Inventory (IEC 62304 §5.3.3, §8.1.2)

"Software of Unknown Provenance" — every third-party dependency that ships in the product must be inventoried with:

- Name, version, supplier, licence, source URL.
- Functional purpose in the product.
- Verification of suitability.
- Known anomalies / open CVEs.
- Risk-control evidence if the SOUP is used in a hazard-control path.

The most consequential SOUPs for VarLens are:

| SOUP | Why it matters |
| --- | --- |
| Electron 40 | Sandboxing, security model, fuse baseline |
| `better-sqlite3-multiple-ciphers` (SQLCipher-fork) | Encryption-at-rest of all clinical data |
| `@node-rs/argon2` | Key derivation |
| Fastify + `@fastify/secure-session` | Web-mode session security |
| `pdbe-molstar` (referenced in `AGENTS.md` security defaults) | Renderer-side runtime; loaded via Vite per the documented rule |
| Vue 3, Vuetify 4, Pinia | Renderer framework |
| `electron-builder` 26.4.0, `electron-updater` | Packaging and update signing |
| All external API clients (Ensembl, gnomAD, SpliceAI, UniProt, InterPro, HPO, PanelApp, AlphaFold) | Data sources whose changes can impact analytical performance |

`package-lock.json` already provides the version lock; what is missing is the **suitability justification** and **CVE-monitoring SOP** for each. SBOM generation (e.g. CycloneDX) should be added to the build pipeline — see §10.3.

Deliverable: `.planning/specs/soup-inventory.md` + auto-generated SBOM artefact uploaded to each release.

### 4.8 Verification & Validation Plan (IEC 62304 §5.5–§5.7 / §9)

The repo's test inventory is already strong:

- 436 test files (per the QM audit), Vitest (`tests/main`, `tests/renderer`, `tests/shared`, `tests/preload`) + Playwright Electron (`tests/e2e/`).
- Startup smoke (`tests/e2e/startup-smoke.e2e.ts`) and packaged smoke (`tests/e2e/packaged-smoke.e2e.ts`) gate releases on perf milestones and fuse/signing integrity.
- ACMG: `src/shared/utils/acmg.ts` + `tests/shared/utils/acmg.test.ts` + `tests/e2e/acmg-classification.e2e.ts`.
- VCF parsing: GIAB trio fixture in `tests/test-data/vcf/`.
- Preload contract: `tests/shared/types/preload-contract.test.ts` (lines 245–254, 425–436) — best-in-class IPC surface lockdown.
- Perf comparisons under `.planning/artifacts/perf/phase1/` for renderer, and `.planning/artifacts/perf/wgs-import/` for import.

What is missing for IVDR / IEC 62304 conformity:

- **Reference / benchmark validation** — there is no validated dataset with *expected* ACMG classifications or HPO rankings; tests verify mechanical behaviour, not domain correctness. For a Class B/C IVD this is mandatory (§5.1).
- **Coverage gate enforced in PR pipeline.** Coverage thresholds in `vitest.config.ts:85-150` are only enforced on `npm run test:coverage` (main-branch CI), not on PRs. For an IVD this is a documented quality gate.
- **Formal V&V records** — every test run that supports release acceptance must be archived with version, environment, hash of code under test, outputs. Currently only ephemeral CI artefacts.

Deliverable: `.planning/specs/verification-validation-plan.md`, structured release V&V records under `.planning/artifacts/releases/<version>/`.

### 4.9 Usability Engineering File (IEC 62366-1:2015 + Amd1:2020)

Referenced via IEC TR 62366-2:2016 (`psg_89c27ac12c23046f67018ae93c1b805269285fee19e680ef167fdd99b65d55f4`, `psg_145c56ac2c1b138342993e9451386c6c5b20497c220ba730a4d2aa1726fec61e`, `psgp_33346364c93237176a64d8213bd6eb68e1952f433c4cc4033778df7499ccae57`):

> *"FORMATIVE EVALUATIONS are completed prior to the SUMMATIVE EVALUATION and should be initiated early in the MEDICAL DEVICE research and development cycle. […] At an early stage of USER INTERFACE design, FORMATIVE EVALUATION serves to identify design strengths and opportunities for improvement. At the latter stage of USER INTERFACE design, FORMATIVE EVALUATION enables the MANUFACTURER to determine whether the MEDICAL DEVICE meets SAFETY, USABILITY, USER and business needs and ultimately supports successful SUMMATIVE EVALUATION."*

Required artefacts:

1. **Use specification** — described users, their training, the use environment, primary operating functions.
2. **User interface specification** — already partially in `.planning/docs/UI-PATTERNS.md` and `AGENTS.md` "UI / Vuetify Rules".
3. **Known use errors** — e.g. ambiguous "surface-variant" colour issue documented in `AGENTS.md` is precisely the kind of use-error class that IEC 62366 wants documented; the AGENTS.md note ("white-on-white, invisible") could become a hazard-and-use-error entry.
4. **Use-error risk analysis** — feeds back into ISO 14971.
5. **User-interface evaluation plan** — formative (during development) + summative (validation against the use specification).
6. **Evaluation reports** — at least one summative round before any "clinical decision support" claim is published.

Deliverable: `.planning/usability/use-specification.md`, `.planning/usability/use-error-log.md`, `.planning/usability/summative-report-<date>.md`.

### 4.10 Cybersecurity Documentation (MDCG 2019-16 rev.1, ISO 81001-1:2021, IEC 81001-5-1:2021)

MDCG 2019-16 rev.1 (the cybersecurity guidance, `psg_ac596747f6ccffdd215e3f5cb915ce836a03579503fcaa85349fa510be89200b`) is the de-facto Eu-level cybersecurity expectation for medical-device manufacturers. ISO 81001-1:2021 §5.3.4.4 (`psgp_27c78f62e8eb2f27d6657d5421263e9a8ad1838ffaae3f1eff28a454f481134c`):

> *"Security management is a shared responsibility requiring ongoing monitoring as new threat and vulnerabilities evolve. […] For manufacturers and developers, establishing cybersecurity for a medical device, health software, or health IT system is not merely adding functional security requirements to a system. It requires appropriate security management during the entire product life cycle."*

VarLens **already implements many of the technical controls** that MDCG 2019-16 expects (see §5 below). The gap is the **documentation and process layer**:

- **Threat model** (STRIDE / DREAD / equivalent) covering desktop and web variants.
- **Security risk management** integrated with ISO 14971 risk file.
- **Vulnerability disclosure policy** (currently absent; no SECURITY.md visible).
- **Coordinated vulnerability response SOP** (who triages, how fast, how patched, how communicated).
- **Security update plan**: how patches are distributed (electron-updater is already wired), how end-of-life is announced.
- **Penetration testing** before any web-mode production deployment.
- **CVE-monitoring** of the SOUP inventory.
- **Secure development practices** documentation referencing the existing controls (sandbox, contextIsolation, allow-listed shell.openExternal, URL allow-list, fuse baseline, secrets scan via gitleaks).

Also explicit in MDCG 2019-16 Annex I (`psg_8e65ba17f685d18cedd326886b27647822357a55fcd7832e5bddefe168887a6a`):

> *"Annex I of the Medical Devices Regulations explicitly sets out the requirement for manufacturers of in vitro diagnostic medical device and medical device to fulfil minimum requirements concerning hardware, IT networks characteristics and IT security measures, including protection against unauthorised access. All these requirements are necessary in order to run the software as intended (see sections 17.4, 18.8 and 23.4b in MDR and 16.4 and 20.4.1(c) in the IVDR)."*

Deliverable: `.planning/security/threat-model.md`, `SECURITY.md` (repo root, public), `.planning/security/cve-response-sop.md`.

### 4.11 Instructions for Use (IFU) / Labelling (IVDR Annex I §20)

Even under Article 5(5), users must be informed about intended purpose, contraindications, performance characteristics, warnings, and the institution's contact for incidents. The user-facing equivalent of the §4.1 Intended Purpose document, plus:

- Version number (must match the binary's version, which already matches the git tag per `release.yml`).
- UDI not legally required for in-house devices under Article 5(5) IVDR, but a self-issued device identifier (institution-internal) is good practice — see §4.13.
- Limitations of use ("does not perform variant calling", "does not validate annotation source quality", "results subject to qualified-user review").
- Cybersecurity-relevant user instructions: setting strong encryption passphrase, keeping the OS updated, network-isolation guidance.

Deliverable: `docs/regulatory/ifu.md` (in the VitePress site) plus a packaged PDF shipped with the installer.

### 4.12 Performance Evaluation File (IVDR Annex XIII) — at least scientific validity & analytical performance

MDCG 2020-1 §3.3, p. 9 (`psgp_b73e47f34653e364176f0006ddb0cfedec8437532b3f272ac2347933bbb9dcfd`) sets out the IVDR vocabulary:

> *"VALID CLINICAL ASSOCIATION (MDR) / SCIENTIFIC VALIDITY (IVDR) […] An assessment and analysis of data to establish or verify the SCIENTIFIC VALIDITY, the ANALYTICAL and, where applicable, the [CLINICAL PERFORMANCE]…"*

And `psg_023d05775fd67f3792774a9117b47226a55d64db06bec57cd4a55da0acdf28d2`:

> *"The requirements for CLINICAL EVALUATION and PERFORMANCE EVALUATION are outlined in Article 61 of the MDR (including Annex XIV) and Article 56 of the IVDR (including Annex XIII), respectively."*

Even for Article 5(5) Class C devices, IVDR Article 5(5)(g) requires documentation that allows the design, intended purpose, scientific validity, analytical performance, and (where relevant) clinical performance to be understood.

For VarLens this means:

1. **Scientific validity** — published evidence that the underlying biomedical concepts the software supports (ACMG/AMP 2015 criteria, HPO phenotype-similarity scoring, gnomAD population frequencies, ClinVar review, SpliceAI splice predictions) are valid for the intended population. Reference the source publications (Richards et al. 2015 for ACMG, Köhler et al. for HPO, etc.).
2. **Analytical performance** — that the software computes what it claims:
   - Correct parsing of every supported VCF/INFO/CSQ flavour against the GIAB trio fixture and additional reference datasets.
   - Round-trip correctness (import → DB → export equals input).
   - HGVS-notation parsing correctness against a curated benchmark.
   - HPO-similarity ranking correctness against a benchmark cohort.
3. **Clinical performance** — where applicable, evidence from real-world or simulated case series that the tool's outputs are consistent with expert clinical-geneticist consensus.

Deliverable: `.planning/specs/performance-evaluation-plan.md`, `.planning/artifacts/performance/<version>/`.

This is the single most labour-intensive deliverable. For Path B, it can be scoped to "in-house validation in the using institution"; for Path C it requires significantly more.

### 4.13 Identification & Traceability

For Path B (in-house) — internal device identifier (e.g. `VARLENS-INH-2026-001`), tied to the version & build hash. For Path C — UDI assignment per MDCG 2018-5 (`psg_6872c7de73de15b07fecc3e34542b9f714143f54037759accab3ae54fdf9707e`):

> *"In accordance with Annex VI, Part C of the Medical Device Regulation (EU) 2017/745 (MDR) and the In-Vitro Diagnostic Medical Device Regulation (EU) 2017/746 (IVDR), only software which is commercially available on its own as well as software which constitutes a device in itself shall be subject to UDI requirements."*

The good news: `release.yml` already enforces that `package.json` version matches the git tag, and signed Windows/macOS installers carry the version in their metadata. Adding an in-binary UDI-PI string (build hash + version) to the IPC `system:` domain would close the traceability loop.

### 4.14 Post-Market Surveillance equivalent

MDCG 2025-10 Article 5, p. 4 (`psg_c8d419650acacf0d8bd2518001b0522a25b9bb789b19c404fa5abb42ce7c15b5`) confirms that even in-house devices "review experience gained from the use of in-house devices and take all necessary corrective actions". For Path C, the full PMS plan + PSUR is required (MDCG 2022-21 Article 86, `psg_56167f6ff8a55372d288e4c17dffca4037113183704902b709c973deb00702e7`):

> *"In accordance with Article 86(1) MDR, the PSUR should summarize the results and conclusions of the analysis of the post-market surveillance data gathered as a result of the PMS Plan…"*

Practical Path-B equivalent for VarLens: a user-feedback channel (issue tracker), a vulnerability disclosure mailbox, and quarterly review of: bug reports, classification-discrepancy reports from users, CVE notifications from SOUP suppliers.

---

## 5. Codebase Findings — What Is Already In Place

(Evidence from the three parallel audit agents, with file/line citations.)

### 5.1 Process isolation and IPC contract — Best-in-class

- BrowserWindow at `src/main/index.ts:61-76` enforces `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. No exceptions in the codebase.
- All 28 IPC domains are typed in `src/shared/ipc/domains/`. Preload binding mirrors the domain shape. Handlers go through `wrapHandler` returning `IpcResult<T | SerializableError>`.
- `tests/shared/types/preload-contract.test.ts:245-254, 425-436` locks the surface against drift. **This single test is one of the strongest IVDR-relevant artefacts in the repo** — it is a verifiable, automated check that the safety-critical trust boundary cannot regress without breaking CI.

**Regulatory value:** directly satisfies IVDR Annex I §17/§16.4 (software safety, security architecture) and IEC 62304 §5.3 (software architectural design).

### 5.2 Encryption-at-rest

- `better-sqlite3-multiple-ciphers` (SQLCipher-fork) used for all SQLite databases.
- Key passed via `PRAGMA key='...'` with quote-escaping (`worker-db.ts:42`).
- Key validation guard (`src/main/database/sqlcipher-key-guard.ts:3-9`) rejects hex-literal injection.
- KEY-IS-FIRST-PRAGMA invariant documented and enforced (`db-worker.ts:75-76`).
- Argon2id-derived passphrases (web mode); plaintext passphrases refused at boot (`src/web/server.ts:52`).
- No encryption keys logged anywhere (grep returns no `MainLogger`/`logService` calls for `encryptionKey`).

**Regulatory value:** satisfies MDCG 2019-16 cybersecurity Annex I expectations for protection against unauthorised access, and IVDR Annex I §16.4 / 20.4.1(c).

### 5.3 No PHI Egress; External Calls Are Metadata-Only

All eight external API clients send only variant coordinates, gene symbols, HPO IDs, or protein/PDB accessions. Patient data never leaves the device. All clients use HTTPS. Caching is local SQLite-backed (`ApiCache`, 30-day TTL). HTTPS only; no TLS pinning (acceptable for the threat model, given the trusted CA store and the non-PHI nature of the traffic).

**Regulatory value:** materially de-risks GDPR exposure (no automated international transfer of personal data) and meets MDCG 2019-16's expectations for data-in-transit controls.

### 5.4 RUO Disclaimer in the UI

`src/renderer/src/config/disclaimerConfig.json` (lines 1–34) is shown on first run / boot:

- Line 8: "intended for research purposes only and has not been validated for clinical diagnostic use. Results must not be used for medical decision-making."
- Line 23: "Pathogenicity classifications are informational only."
- Line 28: "Interpretation of genomic variant data requires appropriate training in genetics and genomics. This tool is designed for use by qualified researchers."

**Regulatory value:** anchors Path A; supports Path B as long as the in-house labelling is upgraded. The text needs strengthening (§4.1) but the mechanism is correct.

### 5.5 Hardened Electron Build

`scripts/configure-fuses.mjs` baseline (`strictlyRequireAllFuses: true`):

- RunAsNode = false
- EnableCookieEncryption = true
- EnableNodeOptionsEnvironmentVariable = false
- EnableNodeCliInspectArguments = false
- EnableEmbeddedAsarIntegrityValidation = true
- OnlyLoadAppFromAsar = true

Plus signed Windows builds via SSL.com eSigner; macOS resetAdHocDarwinSignature for ad-hoc local sign; Electron-builder afterPack invokes the fuse hook.

**Regulatory value:** key cybersecurity control for IVDR Annex I §16.4 and MDCG 2019-16. The "strictlyRequireAllFuses" rule is rare-and-correct — it forces Electron upgrades to consciously declare new fuses.

### 5.6 Release Integrity

`release.yml` refuses to publish unless `build.yml` is green on the exact tagged SHA. Conventional Commits enforced (AGENTS.md). Dependabot tracks SOUP versions. Gitleaks scans secrets on every CI run.

**Regulatory value:** satisfies the configuration-management requirements of IEC 62304 §8 and ISO 13485 §4.2.4 (control of documents) / §7.3.6 (design and development verification).

### 5.7 Audit-Log IPC Domain (stub, but the seam exists)

`src/shared/ipc/domains/audit-log.ts:1-9` exposes `getByEntity(entityKey)` and `query(params)`. This is the right place for IVDR/MPDG audit-trail features once tied to a tamper-evident store (§7.3).

### 5.8 What Is Quietly Excellent (and the regulator will notice)

- Conventional Commits + signed tags + reproducible per-tag CI is exactly what an ISO 13485 audit wants to see for "control of changes" (§7.3.7).
- `make agent-check` enforces an LLM-sustainable code size budget — this is a *novel* form of complexity gate but maps cleanly to the "manageability" requirement implicit in IEC 62304 §5.1.
- `.nvmrc` + `package-lock.json` + native-module dual-rebuild discipline is excellent build-environment control.
- The fact that the `.planning/` directory exists *at all* and contains audit reports (`CODEBASE-AUDIT-2026-05-25.md`, etc.) — even without formal numbering — is far above the baseline for academic genomics tooling.

---

## 6. Codebase Findings — Gaps That Block Regulatory Readiness

### 6.1 HIGH — PHI in Main-Process Log File

From the data-privacy audit and `.planning/code-review/CODEBASE-AUDIT-2026-05-25.md`:

- `MainLogger.ts` writes plain text to `~/.config/varlens/logs/main.log` (Linux), `~/Library/Logs/varlens/main.log` (macOS), `%APPDATA%\varlens\logs\main.log` (Windows).
- `sanitizeLogMessage` is applied **only on the renderer's `LogService`** before storing in the Pinia `logStore`; the main-process logger has no equivalent.
- HGVS strings, file paths containing sample IDs, and per-case identifiers can therefore reach disk **in clear text** in a location outside the encrypted SQLite database.
- Rotation overwrites the previous `.old.log` after 5 MB.

**Regulatory impact:** breaks the encryption-at-rest claim for clinical data. Direct GDPR/BDSG exposure (Art. 5(1)(f) — integrity and confidentiality). Direct MDCG 2019-16 violation if VarLens is ever positioned as IVDR.

**Fix priority:** must be addressed before any clinical pilot — see §11 Action P0.

### 6.2 HIGH — No Runtime Validation at IPC Boundary for Import

Per the QM audit and the May 25 audit:

- `import:start` accepts `filePath: string` without a Zod (or similar) schema-validation step.
- `BedFilter.fromFile` reads from a user-provided path without an allow-list / sandbox check.

**Regulatory impact:** breaks the "trust boundary" model the rest of the IPC contract carefully constructs. Class-B/C risk because malformed input could lead to silent misinterpretation of variants.

### 6.3 MEDIUM — No Formal Software Safety Class

No declaration in source, README, or `.planning/` of IEC 62304 A / B / C. (§4.2 deliverable closes this.)

### 6.4 MEDIUM — No Requirements Numbering / Traceability Matrix

Requirements are narrative in `.planning/specs/` and `AGENTS.md`. No REQ-IDs, no traceability matrix between requirement → code → test → risk control. The repo has *the information*; the QMS gap is the formal *links*.

### 6.5 MEDIUM — No Risk Management File

No FMEA, no ISO 14971-style hazard log, no risk-control traceability. Risks live in code-review prose and PR descriptions only. (§4.3)

### 6.6 MEDIUM — Coverage Gate Not Enforced in PR Pipeline

`vitest.config.ts:85-150` declares thresholds but they only run on the main-branch coverage job, not on PRs. The QM audit flagged this; the May 25 audit corroborates. For IVDR this is a documented quality-control gate that must run on every change.

### 6.7 MEDIUM — No SBOM Generation

`package-lock.json` is present, Dependabot is configured, gitleaks scans secrets — but no CycloneDX/SPDX SBOM is produced as a release artefact. MDCG 2019-16 expects this, and EU CRA (Cyber Resilience Act) increasingly expects this even for non-MDR/IVDR software.

### 6.8 MEDIUM — No Usability Engineering File

No use-error log, no formative evaluations, no summative evaluation. UI consistency rules in `.planning/docs/UI-PATTERNS.md` are valuable but informal. (§4.9)

### 6.9 MEDIUM — Tag ↔ package.json Version Verification Gap

May 25 audit finding: there is no explicit step in `release.yml` that verifies the tag matches the package.json version. This is the *last* drift point that can silently produce a release whose declared version disagrees with the binary.

### 6.10 MEDIUM — `src/web/server.ts` Without Threat Model

Web/Fastify mode introduces a server-side processing surface (multi-tenant authentication, OpenAPI surface, session secrets, Postgres-backed shared store). The Phase 16/16.1/16.2 perf work is documented; the **threat model is not**. This is the single area where the project is *expanding* its regulatory exposure faster than its documentation.

### 6.11 LOW — No SECURITY.md / Vulnerability Disclosure Policy

Repo has gitleaks scanning + Dependabot + signed releases — but no public disclosure policy. For Path B in a hospital setting, hospitals will ask for this.

### 6.12 LOW — Changelog & Docs Stale

May 25 audit finding: CHANGELOG.md is 7 releases stale; the docs site changelog 37 releases stale. Not strictly regulatory, but ISO 13485 §7.3.8 (design and development transfer) expects user-facing release information to be current.

### 6.13 LOW — No SOUP Inventory File

The information exists in `package-lock.json` but the regulatory artefact (suitability justification, CVE monitoring SOP per dependency) does not.

### 6.14 LOW — No Reference Validation Dataset for ACMG / HPO

Tests are mechanical-correctness only. For analytical-performance evidence (§4.12) a benchmark with expected ACMG categorisations is required.

---

## 7. The Web/Server Variant — Special Treatment

`src/web/server.ts` and the `web/03-web-app-openapi` branch deserve their own section because they materially change the regulatory surface.

### 7.1 What it is

A Fastify app, Postgres-only, with:

- `@fastify/secure-session` sessions, Argon2id-hashed admin password (plaintext refused).
- OpenAPI route registration.
- Page gate (`page-gate.ts`).
- Event stream, healthz, login.
- Pino JSON logging.
- Built separately via `vite.web.config.ts` with Electron modules stubbed out.

### 7.2 Why it changes things

In the desktop product, data is on the user's machine, encryption keys never leave the user's device, and there is no shared surface. In the web product:

- The Postgres database is **shared infrastructure**. Multi-tenancy implications.
- Authentication is **server-controlled**.
- The deployment environment is something the *operator* (not the user) controls.
- The threat model expands to include classic web threats (CSRF, session fixation, SQL injection via OpenAPI input, supply-chain attacks on Fastify plugins, etc.).
- If hosted by a third party (cloud), the data-controller / data-processor relationships under GDPR become explicit; a Data Processing Agreement (Auftragsverarbeitungsvertrag, AVV in Germany) is required between the institution and the operator.
- The "in-house IVD" Article 5(5) defence requires *manufacture and use within a single legal entity*. A SaaS deployment crossing institutional boundaries breaks this.

### 7.3 What is required before any clinical pilot of the web variant

1. **Threat model** for the web surface (§4.10 / §6.10).
2. **Penetration test** by an independent party. (Cost: realistic ~€10–30k for a competent test.)
3. **Data Processing Agreement (DPA / AVV)** templates if hosted by anyone other than the using institution itself.
4. **Audit logging that is regulator-grade**: not just `pino` JSON to stdout, but tamper-evident, append-only, exportable per IVDR Annex I §16/§20 expectations. The audit-log IPC domain (`src/shared/ipc/domains/audit-log.ts`) is the right starting point — extend it server-side with hash-chained records or write-only Postgres tables.
5. **Decision on hosting model:**
   - **Self-hosted by the institution** = Path B is preserved.
   - **Hosted by VarLens-the-project as SaaS** = full Path C territory + IVDR Article 5(5) **does not apply**.
6. **Separate Intended Purpose** statement for the web variant. The desktop and web products may need to be treated as **distinct devices** in the regulatory file.

---

## 8. Quality Management System (ISO 13485-aligned) — What's Missing

The repository is a one-developer project. ISO 13485 is designed for organisations. Path B (in-house) can be satisfied by **the using institution's QMS** with VarLens-specific procedures bolted on. Path C requires the VarLens organisation to have its own QMS.

Minimum SOPs required for either path, with notes on what exists already:

| ISO 13485 clause | SOP / Procedure | Current state |
| --- | --- | --- |
| 4.1 — QMS scope | "QMS Scope: Software-only IVD MDSW for genetic variant interpretation" | Missing — `.planning/specs/qms-scope.md` |
| 4.2.4 — Control of documents | Doc-control procedure | Partly: Git history + `.planning/` numbering convention but no formal SOP |
| 4.2.5 — Control of records | Records retention policy | Missing |
| 5 — Management responsibility | Management review cadence | Missing (single developer; institutional sponsor required) |
| 6 — Resource management | Competence / training records | Missing |
| 7.1 — Planning of product realization | Software Development Plan | Partly: AGENTS.md / CLAUDE.md cover much of it but not formalised |
| 7.2 — Customer-related processes | Intended Purpose statement | **Critical missing — §4.1** |
| 7.3 — Design and development | Design History File | The `.planning/` directory is the embryo of a DHF; needs formalisation |
| 7.3.7 — Control of changes | Change-control procedure | Conventional Commits + PR template exists; needs explicit SOP that links design changes back to risk-file impact assessment |
| 7.4 — Purchasing (SOUP control) | SOUP / supplier control SOP | Missing — §4.7 |
| 7.5 — Production and service | Release procedure | `release.yml` + `release-runbook.md` are excellent foundation |
| 7.6 — Control of monitoring and measuring equipment | CI pipeline = monitoring infra | Build-pipeline rationale + integrity documented; minor formalisation needed |
| 8.2.1 — Customer feedback | Issue tracker / user feedback channel | Public GitHub issues; needs a stated feedback-handling SOP |
| 8.3 — Control of nonconforming product | Bug-handling SOP | Implicit; needs explicit linkage to risk-file impact assessment |
| 8.4 — Analysis of data | Quarterly review | Missing |
| 8.5 — CAPA | Corrective/preventive action SOP | Missing (regression-test culture exists informally) |

For **Path B** in a German university hospital, much of this can be inherited from the hospital's ISO 15189 / DAkkS-accredited laboratory QMS, with a **VarLens-specific annex** describing the device. That is the pragmatic recommendation.

---

## 9. GDPR / BDSG / National Considerations

Even if VarLens is not (yet) an IVD, the data it processes is **genetic data**, which is a special category of personal data under GDPR Art. 9 and is subject to particular protection under BDSG §22 in Germany.

Minimum readiness:

1. **Lawful basis** for processing must be documented at the institution that uses VarLens — typically informed consent (Art. 9(2)(a)) or scientific-research basis (Art. 9(2)(j) + national derogations under BDSG §27).
2. **Records of processing activities (Art. 30)** must include VarLens as a processing tool.
3. **Data Protection Impact Assessment (DPIA, Art. 35)** is virtually mandatory because genetic-data processing is on the German supervisory authorities' list of operations requiring a DPIA.
4. **Storage limitation (Art. 5(1)(e))** — clarify in IFU that databases should be deleted/anonymised after the legal retention period.
5. **Right to erasure (Art. 17)** — VarLens must support deletion of a case and its derived data; the delete worker (`src/main/workers/delete-worker.ts`) covers this, but the IFU should document it.
6. **Encryption-at-rest** — already implemented; the PHI-in-log issue (§6.1) is the open exposure.
7. **Logging of access** — the audit-log IPC domain (§5.7) is the right foundation; needs to actually persist with timestamps + user identity, especially for the web variant.

---

## 10. Engineering Changes Required

Concrete code/infra deltas, ordered by regulatory leverage.

### 10.1 P0 — Sanitise Main-Process Logs Before Disk Write

`src/main/services/MainLogger.ts` should apply the same `sanitizeLogMessage` already used in `src/renderer/src/services/LogService.ts` *before* the electron-log transport. Allowlist what may be logged; redact HGVS strings, file paths, identifiers by default. Add a test that asserts a known PHI-bearing log line never lands on disk in clear text.

### 10.2 P0 — Add Zod Validation to All Import / File-Path IPC Inputs

`import:start`, BED filter loading, every channel that receives a path or external string. Reject malformed input loudly. This is both a security fix and a regulatory artefact (a documented input-validation control).

### 10.3 P1 — SBOM in the Release Pipeline

Add `cyclonedx-npm` (or equivalent) to `build.yml`, upload `cyclonedx.json` as a release asset. This is a 1-day task and unlocks both CRA-readiness and supplier-control under IEC 62304 §8.

### 10.4 P1 — Tag ↔ package.json Version Verification

Single shell step in `release.yml` that fails if `jq -r .version package.json` ≠ tag without `v` prefix. The May 25 audit specifically called this out.

### 10.5 P1 — Promote the Audit-Log Domain to a Real, Append-Only Store

Today the IPC domain exists; the store does not. Implement:

- Append-only SQLite table (or PostgreSQL table with `INSERT`-only RLS) with hash-chained records (each row carries the SHA-256 of the previous row's payload).
- Events: case import, case delete, ACMG classification change, filter-preset save, export.
- Export-to-file for regulator-grade audit trail (CSV/JSON, hash-chain verifiable).
- Renderer-side viewer.

### 10.6 P1 — Add SECURITY.md and a Vulnerability Disclosure Mailbox

GitHub's built-in private-vulnerability-reporting can be enabled in 5 minutes. SECURITY.md content per the OpenSSF / GitHub template.

### 10.7 P2 — Requirements Numbering + Traceability Matrix

Adopt REQ-* prefixes in `.planning/specs/`. Build a `traceability.md` (or CSV) linking REQ-* → code files → test files → hazard IDs. Can be partly auto-generated from `// @req REQ-FLT-007` annotations in tests + a small script under `scripts/`.

### 10.8 P2 — Coverage Gate on PRs

Run `vitest run --coverage` on PRs, not just main. Already-declared thresholds in `vitest.config.ts:85-150` apply. Aligns with the explicit AGENTS.md rule "Do not lower coverage / lint / typecheck thresholds to make a failing suite pass."

### 10.9 P2 — Reference Validation Datasets for ACMG / HPO

Curate a small benchmark of variants with known ACMG classifications (ClinVar 2-star+ entries are a starting point) and HPO-cohort similarity expectations; add an analytical-performance test that fails if drift exceeds a defined tolerance.

### 10.10 P2 — Threat Model and Pentest for the Web Variant

Before any web-variant production deployment. Block the deployment in CI/runbook until completed.

### 10.11 P2 — TLS-Pinning Decision for External APIs

Current external-API calls use HTTPS with the OS CA store — defensible for a desktop research tool. For Path B / Path C with a published intended purpose, consider TLS-pinning for the small fixed set of API endpoints, or at minimum a **certificate-transparency monitoring** entry in the security plan.

### 10.12 P3 — In-Binary UDI-PI String

Surface the build hash + version through a `system:identity` IPC handler so the renderer can display it in the disclaimer / about box. Helps incident triage and aligns with MDCG 2018-5 software-UDI-PI intent even if a formal UDI is not required.

### 10.13 P3 — Click-Through RUO Acknowledgement

Strengthen `disclaimerConfig.json` to a versioned, persisted-per-user acknowledgement that must be re-confirmed on every major version bump.

---

## 11. Prioritised Action Plan

The realistic order, given a small-team / single-maintainer reality.

### Phase 0 — Immediate (weeks)

These must be done before any further clinical-context use, regardless of compliance path.

1. **§10.1** — sanitize main-process logs (P0).
2. **§10.2** — Zod validation at IPC import boundary (P0).
3. **§4.1** — write the Intended Purpose statement (1 page). This forces the question "what *is* this tool?" to be answered explicitly.
4. **§10.6** — SECURITY.md + private vulnerability reporting enabled.
5. **§10.4** — tag ↔ version verification.

### Phase 1 — Foundation (1–2 months)

Equips the project to make the Path B vs. Path C decision with eyes open.

6. **§4.2** — software safety class declaration.
7. **§4.3** — initial risk management file + hazard log (start with 20 hazards; iterate).
8. **§4.7** — SOUP inventory.
9. **§4.10** — desktop threat model.
10. **§4.9** — use-specification + use-error log (re-use UI-PATTERNS.md content).
11. **§10.3** — SBOM in CI.
12. **§10.7** — requirements numbering kickoff.

### Phase 2 — Path B readiness (3–6 months)

Assuming the decision is in-house (Article 5(5)) for a hospital/consortium.

13. **§4.4** — formal Software Development Plan.
14. **§4.5** — complete requirements + traceability matrix.
15. **§4.6** — architecture document with diagrams.
16. **§4.8** — V&V plan + structured release records.
17. **§4.11** — IFU / labelling document, shipped with the installer.
18. **§4.12** — performance evaluation plan; scope per institution.
19. **§4.13** — internal device identifier and IFU version pinning.
20. **§10.5** — promote audit-log to hash-chained store.
21. **§10.9** — reference validation datasets.
22. **Institutional sign-off** — using institution's QM organisation signs the Article 5(5) declaration; competent authority informed if required.

### Phase 3 — Optional Path C stretch (12–24 months from a stable Phase 2)

Only if a commercial future or multi-institution distribution is genuinely on the table.

23. **§4.10** — pen-test for web variant; closed audit findings.
24. **Full ISO 13485 QMS** under a legal manufacturer entity.
25. **Performance studies under IVDR Article 58** if scope requires it.
26. **Notified Body engagement** for Class B / Class C IVDR conformity assessment.
27. **UDI registration** in EUDAMED.
28. **PMS plan + PSUR cadence** (MDCG 2022-21).

---

## 12. References

### EU regulations

- **Regulation (EU) 2017/745 — MDR** (mostly referenced via cross-cuts; MDR-MCP `psg_47488273618f9cef4e181c8fe3c6c9bab52213dcd359ea4826738226fefbec31`, `psg_39d25eb7cd322262672638739d59351115f7b078d0ec5c5e71614f712a9749ef`).
- **Regulation (EU) 2017/746 — IVDR**. Note: the MDR-MCP corpus marks this as a known *missing source* (`corpus_status.missing_sources` includes "IVDR 2017/746 and IVD Guidance"). The official text on Eur-Lex is the authoritative source for §3.2 conditions and Annex XIII performance-evaluation requirements.

### MDCG guidance (high-authority)

- **MDCG 2019-11 rev.1** — *Software Qualification and Classification* (MDR-MCP doc `mdcg_2019-11_rev1_software_qualification_classification`).
- **MDCG 2018-5** — *UDI Assignment to Medical Device Software*.
- **MDCG 2020-1** — *Clinical Evaluation of Medical Device Software*.
- **MDCG 2019-16 rev.1** — *Cybersecurity for medical devices*.
- **MDCG 2021-5 rev.1** — *Standardisation* (Article 5(5) IVDR / EN ISO 15189 linkage).
- **MDCG 2022-21** — *PSUR guidance*.
- **MDCG 2023-3 rev.2** — *Vigilance terms and concepts*.
- **MDCG 2025-4** — *MDSW apps on online platforms*.
- **MDCG 2025-6** — *MDR/IVDR/AI Act interplay* (Article 5(5) in-house framing).
- **MDCG 2025-10** — *Post-Market Surveillance*.

### German national law

- **Medizinprodukterecht-Durchführungsgesetz (MPDG)** — the German implementing law replacing the old MPG; MDR-MCP doc `mpdg_medizinprodukterecht_durchfuehrungsgesetz` (`psg_75d6e0fcf9713b3b5fd7778ddab1851dccb6c34cc017fb4c1d3c4779bd3d3b76`).
- **§§ MPDG 27–32** — incident reporting and vigilance.
- **BDSG §22, §27** — special categories of personal data; research-purpose derogations.

### Standards (informative summaries via MDR-MCP)

- **IEC 62304:2006 + Amd 1:2015** — *Medical device software — software lifecycle processes*.
- **ISO 14971:2019** — *Medical devices — risk management*.
- **ISO/TR 24971:2020** — *Guidance on the application of ISO 14971*.
- **IEC 62366-1:2015 + Amd 1:2020** — *Usability engineering* (corpus listed as missing source — verify via the published standard).
- **IEC TR 62366-2:2016** — *Guidance on usability engineering*.
- **IEC 82304-1:2016** — *Health software — product safety*.
- **ISO 81001-1:2021** — *Health software and health IT — principles and concepts*.
- **IEC 81001-5-1:2021** — *Health software — security activities in the lifecycle* (corpus missing — verify via the published standard).
- **EN ISO 15189** — *Medical laboratories — requirements for quality and competence* (Article 5(5)(c) IVDR linkage for in-house IVD labs).
- **ISO 13485:2016** — *QMS for medical devices*.

### MDR-MCP passage citations used in this report (selected)

- `psg_dcdc301ee7780b66b1311866541c453cea645ac2c0ed830070c695edc926eb6b` — MDCG 2019-11 rev.1, Art. 2, p. 9 (MDSW + IVD MDSW qualification).
- `psg_7a730e27f35288b5739595c1185394ed084615a3d357723dadae0f4501e04648` — MDCG 2019-11 rev.1, p. 15 (IVD-data sourcing).
- `psg_a294b626537b192d351360509be8a22a5532936936bbadca3027da15d57267d9` — MDCG 2025-6, Art. 5, p. 26 (in-house exemption).
- `psg_828dc34001e46afd8ac8cd6994912b880d50f332a2639060c5cbdbd5b58a2763` — MDCG 2021-5 rev.1, Art. 5, p. 8 (EN ISO 15189 condition).
- `psg_c8d419650acacf0d8bd2518001b0522a25b9bb789b19c404fa5abb42ce7c15b5` — MDCG 2025-10, Art. 5, p. 4 (in-house corrective action expectations).
- `psg_dcbb6a2d15d4eca12a69a5426ce0eb4013966c8d1c464dc1ae1c5a1e3fa785c5` — IEC 62304, p. 59 (risk management normative reference).
- `psg_70cadd1e12e3bb4db43381909e9d0165b4e46999b1979f85f4109cf4d0287bdc` — IEC 62304, Clause 7, p. 47 (ISO 14971 process).
- `psg_8e65ba17f685d18cedd326886b27647822357a55fcd7832e5bddefe168887a6a` — MDCG 2019-16, Annex I, p. 8 (cybersecurity GSPR linkage).
- `psgp_27c78f62e8eb2f27d6657d5421263e9a8ad1838ffaae3f1eff28a454f481134c` — ISO 81001-1:2021, §5.3.4.4, p. 40 (security management is lifecycle, not bolt-on).
- `psgp_b73e47f34653e364176f0006ddb0cfedec8437532b3f272ac2347933bbb9dcfd` — MDCG 2020-1, §3.3, p. 9 (performance-evaluation vocabulary).
- `psg_023d05775fd67f3792774a9117b47226a55d64db06bec57cd4a55da0acdf28d2` — MDCG 2020-1, Art. 61, p. 11 (performance/clinical evaluation framework).
- `psg_56167f6ff8a55372d288e4c17dffca4037113183704902b709c973deb00702e7` — MDCG 2022-21, Art. 86, p. 8 (PSUR structure).
- `psg_6872c7de73de15b07fecc3e34542b9f714143f54037759accab3ae54fdf9707e` — MDCG 2018-5, Annex VI, p. 2 (UDI for software).
- `psgp_c6a2375141f8d20a31421e45c0fc263766a950b8e38516a1fbcb32b5004d578b` — Regulation (EU) 2017/745, §6.5.1, p. 121 (UDI assignment for software).

### Internal repository artefacts referenced

- `AGENTS.md` (canonical agent contract).
- `CLAUDE.md` (Claude-specific notes on top of AGENTS.md).
- `.planning/code-review/CODEBASE-AUDIT-2026-05-25.md`.
- `.planning/code-review/CODEBASE-REVIEW-2026-05-06.md`.
- `.planning/artifacts/audit-2026-05-25/` (specialist reports).
- `.planning/docs/UI-PATTERNS.md`.
- `.planning/docs/release-runbook.md`.
- `src/main/index.ts:61-76, 88-101`.
- `src/preload/index.ts:18-29`.
- `src/main/utils/url-validation.ts:25-44`.
- `src/main/database/sqlcipher-key-guard.ts:3-9`.
- `src/main/workers/worker-db.ts:42`, `db-worker.ts:75-76`.
- `src/main/services/MainLogger.ts`.
- `src/renderer/src/services/LogService.ts`.
- `src/renderer/src/config/disclaimerConfig.json:1-34`.
- `src/renderer/src/utils/acmg/acmg-calculator.ts:19-80`.
- `src/shared/ipc/domains/audit-log.ts:1-9`.
- `src/shared/types/database-schema.ts:39, 69, 109-114`.
- `src/web/server.ts:1-100`.
- `scripts/configure-fuses.mjs:14-26`.
- `.github/workflows/build.yml`, `.github/workflows/release.yml`.
- `tests/shared/types/preload-contract.test.ts:245-254, 425-436`.
- `vitest.config.ts:85-150`.

---

## 13. Closing Notes for the Project Owner

1. **The hardest engineering is already done.** Encryption, isolation, signed releases, typed IPC, fuse-hardening, no PHI egress — these are not trivial, and they are correct. Continuing to invest in process and documentation now buys disproportionately large regulatory value.
2. **The single most important next step is §4.1 (Intended Purpose).** Without it, every other artefact is unanchored. With it, every other artefact has a target.
3. **Path B (Article 5(5) in-house IVD) is the realistic path for a clinical-research-hospital context.** Treat Path C as a deliberate, much-later business decision, not as an engineering goal.
4. **The web variant is the one place the project is presently *expanding* its regulatory exposure faster than its documentation.** Either fold it into the same regulatory file as the desktop (with its own intended-purpose annex and threat model), or pause its production deployment until §7.3 items 1–5 are closed.
5. **A regulatory affairs consultant is worth a few hours of engagement** before locking in the intended-purpose wording. The wording is *the* lever that decides cost, timeline, and feasibility.
6. **None of this changes the day-to-day engineering work.** Continue the existing GSD planning conventions, continue commits via Conventional Commits, continue `make ci`. Add the documents under `.planning/regulatory/` (this file is at `.planning/docs/regulatory/`) and let them grow alongside the code. The skill discipline already in the repo is exactly what an IVDR audit wants to see.

---

*End of report.*
