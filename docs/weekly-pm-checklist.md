# Weekly Preventive Maintenance checklist — development review

Status: application release prepared and tested. The approved migration was manually installed and verified on production on 2026-11-09; all 11 read-only verification checks passed. No live test submission or new access grant was created. MonitorQA remains official.

## Scope and source

Feature branch: `codex/weekly-pm-checklist`, isolated worktree `/Users/christopherwilliams/Developer/tm-ops-weekly-pm`, based on current main `6714d8138ded6332d7a8fe3b663df66a5d983dfd` (PR #53). GitHub Pages workflow for that main commit reported success during preparation. This is not proof of production database migration installation; verify the companywide migration prerequisite separately before release.

The user confirmed the corrected local `Weekly PM Checklist.pdf` as authoritative despite its filename lacking `(2)`. Its SHA-256 is `4a7947456582d25b6b3fab441001e9b2fa48b74f8aa6880b3df2f4223ab491c2`. The PDF and private operational documents are excluded from the feature. All 20 actual pages were visually reviewed; printed footer pages skip 5 and 16. Stale cover/section counts are not used. All implemented question/instruction strings were compared against whitespace-normalized extraction of this corrected PDF with no mismatches.

| Section | Main items | Conditional items | Critical labels including conditional |
| --- | ---: | ---: | ---: |
| Carwash Controls | 5 | 0 | 0 |
| Conveyer and Track, including Trench/Pit | 14 | 0 | 5 |
| Prep Station | 6 | 0 | 0 |
| Tunnel Equipment | 26 | 13 | 25 |
| Air Compressor | 5 | 3 | 3 |
| Vacuums | 5 | 2 | 2 |
| Booster Pump Mesh Filter | 1 | 0 | 1 |
| Total | 62 | 18 | 36 |

Seven main sections plus the nested Trench/Pit section are represented as eight section labels. Trench/Pit retains question number 14. Tunnel Equipment retains 1–24, 26–27 with no invented Question 25. Each conditional follow-up retains its own source number 1 and is labeled with its parent question and triggering answer.

Prep Station Q6 remains exactly `Check pump levels! If the level is low add`, as explicitly authorized. Future wording changes use the existing Admin editor and affect only new drafts. Lockout/tagout, tunnel clearance, ghost wash/employee vehicle tests, and AM notification instructions remain verbatim.

Response inventory: 44 Yes/No, 3 Passed/Failed, 16 Completed/Not Completed (including the conditional Air Compressor refill task), and 17 conditional written responses. The 18 branches are Tunnel 2/7/10 on Yes; Tunnel 16/17/18/19/20/21/22/23/24/26 on No; Air 1/5 on No and Air 4 on Yes; Vacuums 3/5 on No. No N/A choices or mandatory photos are introduced. Existing Admin evidence configuration remains available; no new optional-upload interface is added.

## Behavior and access

The fifth database template has key `weekly_pm` and appears after Weekly Manager Administrative. Template definitions for the other four checklists are unchanged. Existing drafts and submissions retain immutable template snapshots; no record backfill or rewrite occurs.

Active Store users use their existing assigned location. Active legacy area managers retain assigned-location access. Active Admins retain existing companywide review/configuration behavior. There is no GM-only grant, new role, access UI, or location expansion. The PDF's GM-only title does not override the user's explicit authorization of Store access. Existing ownership boundaries remain: another manager cannot edit or view a colleague's draft; Admin can review but cannot edit another owner's answers.

The existing Monday date identifies each calendar week; it is not a deadline. The unique `(location_id, template_key, period_date)` constraint prevents duplicate occurrences. Availability does not create records, missing/overdue obligations, reminders, penalties or scores.

All failed inspections and incomplete tasks require the existing explanation field. Yes indicates failure for defect-detection questions; No indicates failure for proper-function checks. Documented critical failures are submittable. Conditional follow-ups display and validate only for their original triggering answer. Hidden responses are retained in drafts, ignored while inactive, and appear again if reactivated; they do not block submission. Written answers are limited to 4,000 characters. Save Draft remains available with incomplete answers, evidence or name.

The existing signature pad is reused in three places: Tunnel Q27, Booster Pump Q1, and final Auditor Signature. Typed manager full name and authenticated actor identity are retained. Three pads track unsaved drawings independently. A final signature cannot satisfy either item signature, and an item signature cannot satisfy the final signature. Evidence remains private and append-only, with existing owner/Admin access and submitted-record protections. Discard Draft uses the unchanged freeze/Storage cleanup/finalize workflow for all signatures.

## Migration artifact — already installed and verified

`app/supabase/migrations/20261109193454_weekly_pm_checklist.sql`

- Expands the existing template-key check constraint to allow `weekly_pm`, then inserts exactly one template.
- Changes the existing attachment check constraint to permit non-null `item_id` for signatures. Existing final signatures retain `item_id=NULL`; photos still require an item ID.
- Replaces the existing save RPC to validate conditional/text answers and item signatures from the saved template snapshot. Final signature checks explicitly require a null item ID.
- Replaces the existing attachment RPC to accept item signatures only where the snapshot marks `signature_required=true`.
- Retains function signatures, owners, security-definer boundaries, empty search paths and existing ACLs. No new tables, functions, roles, policies, buckets, services or application dependencies.

The actual safety boundary is the RPC plus existing denied direct client writes. The attachment table does not independently verify snapshot item membership; the existing RPC performs that check. Existing RLS, Storage guards, discard functions and authorization helpers are not broadened or replaced by this migration.

## Validation

- Application suite: **461 passed**, including 11 new PM inventory/rules/UI scenarios; existing tests remain enabled.
- SQL/authorization suites: **61 passed** across checklist, November, monthly-budget and Resource Center suites. Fictional in-memory PGlite only; no hosted database was contacted. Seven new SQL scenarios exercise PM inventory, each of the 18 branches, three signature scopes, assigned-location access, Admin review, inactive/deleted/anonymous denial, draft save/discard, unique occurrence, immutable submissions and Admin snapshot editing.
- Both production builds (`npm --prefix app run build` and `npm --prefix app run build -- --base=/`): passed. Existing Admin duplicate-title and bundle-size warnings remain.
- `git diff --check`: passed. The feature contains no PDF, credential, private export, dependency or lockfile changes.
- A 390px browser check passed: no horizontal overflow, correct conditional visibility and validation, draft save/recovery, all three actual canvas signatures, final submission and read-only signature controls. The fixture used fictional data, a substituted client and blocked external network access. Screenshots were visually inspected. Real tablet camera/stylus and live Storage/API integration are separate release smoke checks; local synthetic tests do not certify those devices/services.

Reproduce SQL tests using `PGLITE_MODULE` pointed to an external `@electric-sql/pglite/dist/index.js`, then `node --test scripts/tests/checklist-sql.test.mjs scripts/tests/november-sql.test.mjs scripts/tests/monthly-budget-sql.test.mjs scripts/tests/resource-sql.test.mjs`. No PGlite package is added to the application.

## Application release and recovery

The migration was manually installed once on production project `qbdvixxooofdlfurcpqy` and verified at 2026-11-09 19:58:20 UTC. **Do not reapply it as part of application deployment.** The migration file is retained here as the reviewed source artifact; the established GitHub workflow builds/deploys the frontend and does not run SQL.

All 11 committed-state database checks passed: exact PM seed/RPCs, preservation of existing four template rows and checklist/evidence/audit before-images, unchanged unrelated policies/functions/constraints, closed direct writes, private Storage, assigned-location authorization and unique calendar-week occurrence. Production verification created no PM record. The database is manually managed without a migration-registry table; no automatic migration history is claimed.

Release the frontend through a focused PR after final application/SQL tests, both builds and staged-diff checks. Verify the merge commit on both existing hosts. Automated production smoke checks must not start, save, upload evidence or submit a real checklist. Use read-only production inspection and the fictional, network-isolated form fixture for write-path interaction. Real tablet/live signature persistence needs an explicitly authorized test occurrence.

If PM must be withdrawn, retain all data, signatures, expanded constraints and conditional/signature-aware RPCs. A separately reviewed targeted availability patch must stop PM starts/saves and hide only PM from the template/start list while preserving submission/evidence review. Keep the new review-capable frontend if PM records exist; the old form cannot faithfully display PM written answers. A frontend revert is safe only when no PM records exist and PM availability has first been disabled. Never drop the PM template, delete evidence, restore the original signature constraint over item signatures, or use a whole-database restore as routine feature rollback.

Migration SHA-256: `a995727f57d1c63435e50442ecb90c220babe4bf175b089b609a4fe4e5ac1383`.

No development blocker remains. Production database prerequisites and migration verification passed. Application release is authorized separately; live/device acceptance remains a separate smoke check.

## Files created or modified

Created:

- `app/src/utils/weeklyPmTemplate.js` — reviewed PM inventory and source metadata.
- `app/supabase/migrations/20261109193454_weekly_pm_checklist.sql` — fifth template and scoped signature/conditional validation support.
- `app/tests/weeklyPm.test.js` — PM inventory, rules and weekly identity tests.
- `docs/weekly-pm-checklist.md` — this development/release review.

Modified:

- `app/src/components/ChecklistForm.jsx` — source numbering, conditional inputs and three separately scoped signatures.
- `app/src/components/ChecklistSignature.jsx` — optional accessible label distinguishing signature locations.
- `app/src/pages/ManagerChecklists.jsx` — PM placed fifth.
- `app/src/utils/checklistRules.js` — active-branch, text and signature validation.
- `app/tests/checklistsUi.test.js` — PM mobile form, recovery, signature scope and read-only review coverage; existing harness receives the new rule helper.
- `scripts/tests/checklist-sql.test.mjs` — seven additional PM database/authorization scenarios using existing fictional fixtures.

Only these 10 reviewed files belong in the release. Source PDF, private documents, production before-images/preflight reports, dependencies, fixture bundles, screenshots and logs are excluded from the public release.
