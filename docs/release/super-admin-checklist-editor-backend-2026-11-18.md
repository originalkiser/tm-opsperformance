# Staged backend installation — 2026-11-18

**PASS: authorized backend installation and non-destructive verification.** PR #71 remains draft/unmerged. No frontend deployment, capability grants, checklist publication, account changes or unrelated production changes were performed.

## Installed artifacts

| Artifact | Installed source | SHA-256 |
|---|---|---|
| Migration | `20261118145030_super_admin_checklist_editor.sql`, implementation `3ba149e` | `67ab6c1905c4563c0b46737e64f89fd64c35609602dfce9be049cfeff9ab6d9f` |
| Existing `admin-users` entrypoint | PR #71 implementation `3ba149e` | `eedcb17745d99391489c9e510387ac0a1def7459d7a053224251e5b4681c380d` |

The migration was executed exactly once in the existing authenticated production SQL Editor, as its approved transaction, with successful completion. Eleven installed function bodies were compared to the approved migration and all matched. The guarded endpoint was deployed afterward through the existing authenticated function Code view, which reported successful update; after reloading, persisted entrypoint text matched the approved source. These source versions identify the installed endpoint; a platform numeric deployment version was not exposed by the inspected dashboard views.

The old deployed entrypoint and shared key resolver matched unchanged main before replacement. The resolver remains unchanged (SHA-256 `cfeb0cd477a949b23e97f55690cbfa93fa786a643f40914e3c30849a2df6bca4`). Existing project-key resolution/environment names, public endpoint slug and gateway legacy-JWT setting OFF were retained. Explicit `auth.getUser()` and caller-JWT authorization remain in the installed source. No secrets were changed or exported. No CLI authentication or infrastructure was introduced; the connector still denied SQL access, so the established dashboard workflow was used.

## Recovery and drift gates

* Latest available managed physical database recovery point: **2026-11-18 10:55:58 UTC**. It was visible with the existing restore action; no restore was initiated.
* The existing restricted company OneDrive evidence archive was fully readable locally, reported encrypted, and had SHA-256 `89541e8a430288aaaccac9fb5c5bc5e8f4e486c023e2453f933d46eadd1f00f8` (394,880,000 bytes). This confirms existing archive accessibility, not a refresh covering every upload after its November 15 creation. No new decrypt/restore exercise was performed. Its previously verified restore history remains documented in the photo-integrity release record. Database recovery does not replace this evidence backup.
* Current main remained `af7f85d`; seven template definitions/versions/cadences/QR flags, affected function bodies/grants, profile policies/triggers, required column types and private bucket settings matched the approved baseline. The migration/private schema was absent before installation. No unexpected drift was found.
* The evidence bucket remains private, 10 MiB per object, accepting JPEG/PNG/WebP. Existing upload limits and operational evidence endpoint were not changed.

## Production verification

| Check | Result |
|---|---|
| Capability grants | **0**, deliberately empty; no accounts received Super Admin capability |
| Version baseline | 7 rows, all matching current published definitions/name/cadence/version |
| New template drafts/revisions | 0 / 0; no real template was edited or published |
| Private tables | All four have RLS; authenticated and service_role lack direct data access |
| Private/public function boundaries | Six private functions present; expected execution allowlist, definer/invoker settings and fixed search paths all match |
| Protected profile trigger | Enabled BEFORE UPDATE/DELETE on existing profiles |
| Ordinary Admin editor access | All seven actions (`read`, `save`, `preview`, `publish`, `restore`, `version`, `revisions`) rejected with insufficient privilege |
| Legacy immediate publisher | Rejected for ordinary Admin; immediate publisher remains retired |
| Capability-table bypass | Direct authenticated read denied; template table/column writing remains denied |
| Ordinary Admin operational reads | Seven templates and all 32 profiles visible; existing nonprotected-account authorization RPC returns true |
| Store operational reads | Seven templates, own profile only, existing save RPC executable; account management and publish denied |
| Compliance reads | Admin: 20 locations / 103 result summaries; sampled Store: 1 location / 8 summaries for November 16–18 |
| QR/evidence | Five operational templates allowed; both audits excluded; integrity enforcement active at `sha256-v1` |
| Evidence reconciliation | Zero missing Storage objects and zero operational photos without verified-or-legacy fingerprints |
| Endpoint HTTP | Unauthenticated account-action request: 401 Unauthorized; OPTIONS: 200 with existing CORS behavior |
| Frontend availability | Both production hosts return HTTP 200; existing Cloudflare frontend reaches login |

Role checks used transaction-local request context and `SET LOCAL ROLE authenticated` in read-only transactions. No user tokens were created, account records modified or credential operations performed. Expected denials were caught and checked as insufficient-privilege outcomes; unexpected access/errors would have stopped the checks.

Before/after full-row aggregate fingerprints matched for **all existing submissions, attachments, working copies, submission history, profiles and location assignments**:

| Existing records | Before and after MD5 |
|---|---|
| Submissions | `f88efa30fda8b4037582293cd1b6a00d` |
| Attachments | `6486305bd1e24343e123dbe0537b87ac` |
| Working copies | `03b858d3d3d3822fc2a7cf3d1769a20b` |
| Submission history | `7a69d0f3e50f63ab00215e7cb7065008` |
| Assignments | `168ef6759b0c062b3fcd65c303202ddf` |
| Profiles | `b619916fa68d213858021361d1938bf0` |

Preserved inventory: 245 submissions, including 20 drafts; 205 history versions; one working copy; 389 photos; 374 signatures; 20 manager-location assignments. The seven published definitions are unchanged, with Opening v2 and all others v1. No `photo_min_count` template was published. Existing legacy validator body was retained exactly under its backup name; save, access, QR, period/deadline and compliance functions retain their prior bodies. The new count validator layers over the retained validator and existing snapshot/effective-evidence semantics. The installed combined template fingerprint is `71d3c3449642e92a149104a4cb7b40f0`.

## Security advisors

Post-install Security Advisor was rerun: **0 errors, 40 warnings, 13 informational findings**. Baseline was 0 / 41 / 9. The retired publisher no longer contributes a public SECURITY DEFINER warning. Four added informational RLS-with-no-policy notices correspond to the intentionally private, deny-direct-access configuration tables; granting client policies would defeat their intended protection. Existing unrelated warnings remain unchanged in scope; no unrelated fixes were applied.

## Verification boundaries

Protected-target rejection was covered in the approved isolated security tests; installed guard bodies/permissions and the profile trigger match that reviewed source. Because production capability storage is empty, no real account is currently a protected Super Admin target. No temporary grant was introduced merely to test that branch. Nonprotected account authorization was exercised read-only; live password/email/delete/create actions were intentionally not attempted.

Backend compatibility with unchanged main is supported by unchanged published snapshots/definitions, operational functions, role-scoped reads and the preserved endpoint request/response interface. No compatible frontend is required for existing boolean-photo templates; count-based template publication remains blocked without grants. The old immediate-publish UI will now receive a server denial, as intentionally required. There was no active TM Ops app session for an authenticated UI walkthrough, so this report does not claim one or a live write/save test. No new app login was introduced.

Local implementation validation remains 158 focused app tests, 30 isolated SQL/security tests, the additional warmed-validator regression, browser workflows and build passing. The inherited 47 full-suite failures remain documented separately. No implementation source changed during installation.

## Remaining release steps

1. Separately authorize reviewed PR merge/frontend deployment through the existing main pipeline; never manually deploy Cloudflare. Complete authenticated operational/UI acceptance without changing real account credentials.
2. Separately authorize initial grants to the three previously approved existing Admin accounts. Pause/drain account management, reverify identities privately, confirm guarded endpoint source/configuration and empty table, then use only the parameterized grant script. Stop on ambiguity. No identifiers or manifest belong in repository artifacts.
3. Verify approved access, ordinary Admin denial and protected-account checks under the separately authorized acceptance scope. Review business wording before any real template publication.

The reviewed safe-disable/recovery procedures in `super-admin-checklist-editor-preflight-2026-11-18.md` remain applicable. Retain the installed account guards and guarded endpoint during any rollback. No rollback was required.
