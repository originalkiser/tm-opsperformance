# Management audits: prepared implementation

Local branch: `codex/management-audits`, based on released main `d8f4c65ecb57c38600db41f05964d407129e1149`. No production/development database changes, push, merge, endpoint deployment, preview or application deployment were performed.

## Implemented behavior

- Two separate templates: Monthly Site Assessment (`monthly_site_assessment`, monthly) and Quarterly Safety Audit (`quarterly_safety_audit`, quarterly).
- Existing checklist tables, private evidence bucket, account roles/site assignments, authenticated transport, versions/working copies and edit audit log are reused. There are no new tables, roles, buckets, environments or reporting features.
- Authenticated Manager Checklists has a separate Management Audits group and a separate submission review. Existing Daily/Weekly cards retain their order. Audit occurrence loading is independent of the existing Monday-based review range. Saved audit work is identified separately in the unfinished-work list.
- Existing active Admin/Store/Area Manager permissions apply, including creator/Admin privacy. New audit starts require an eligible site (`exclude_from_reporting IS NOT TRUE`); the excluded location cannot start these audits.
- One occurrence per site per calendar month/quarter, using the first day of that period. The existing unique constraint enforces uniqueness. Site timezone and question definitions are snapshotted as before.
- Initial drafts use the existing resumable-draft workflow. Submitted audits can be corrected until midnight beginning the next assigned month/quarter, in the snapshotted site timezone. Stored deadlines never override the authoritative rule. A late first submission does not reopen an expired correction period.
- General comments are optional. The four approved conditional follow-ups now trigger on Failed and are required when active. The monthly Hours of Operations item requires the source-requested photo/screenshot. The PDF choices are preserved without added N/A choices or mandatory failure explanations. Each audit requires the existing final handwritten signature, labelled Auditor Signature, and an auditor name.
- Corrections preserve the first submission timestamp, original occurrence, attribution, previous answers/evidence/signatures and version history. Fresh correction signatures and PT409 conflict handling are retained.

## Source verification

`pdf-question-inventory.json` preserves original wording, instructions, sections/printed numbering, options, source pages and source-file SHA-256 values. Its `source_condition: Passed` records what the PDFs actually print; migration definitions intentionally use the owner's separately approved Failed condition.

| PDF | Listed questions | Additional follow-ups | General comments included in listed total | Final auditor signatures |
| --- | ---: | ---: | ---: | ---: |
| Carwash Monthly Site Assessment.pdf, 16 pages | 75 | 3 | 5 | 1 |
| Quarterly Safety Audit.pdf, 9 pages | 42 | 1 | 1 | 1 |

Monthly sections: Site Administration 14; Site Standards 29 (Exterior 9, Interior 5, Vacuum Area 6, Other 8, overall comment 1); Tunnel and Equipment 17; Safety 7; Customer Journey 8. The Site Standards comment's printed number 5 is preserved. Monthly includes 69 Passed/Failed questions, one Yes/No question, nine instruction blocks, and the photo requirement in Site Standards / Other Q1. Quarterly includes 41 Passed/Failed questions and eleven instruction blocks.

Approved trigger changes: monthly Customer Journey Q2, Q3 and Q6 (PDF pages 13-14), quarterly Safety Q3 (page 2). Question/follow-up wording remains unchanged. Contact and MaintainX instructions are text only; no new integrations were added.

## Server-enforced QR exclusion

`checklist_private.qr_template_allowed(text)` explicitly allows only opening/midday/closing/weekly/weekly_pm. This list is not editable through the template UI.

- Guest context filters both templates and submissions before returning them.
- Guest starts for either audit are rejected before insertion.
- `actor_allowed` denies audit access by known ID for read, history, download, begin-edit, save/submit and upload authorization/finalization.
- The final Storage INSERT guard also rejects audit uploads carrying a guest intent, including a stale intent.
- A QR request remains a guest request even when the browser also has an account JWT. Caller-controlled actor, snapshot, template and path fields cannot override this.
- Existing server-wrapper and helper ACLs/RLS remain intact. New private helpers have no browser/service-role execute grants; existing security-definer functions call them internally.
- No existing QR grant, token hash, generation or activation state is modified by the migration. The Edge endpoint source/protocol is unchanged and needs no separate endpoint deployment for this feature.

Daily/Weekly Compliance SQL and client allowlists are unchanged. New audit drafts, submissions and corrections do not enter their results or exports.

## Migration and future release sequence

Single prepared migration: `app/supabase/migrations/20261112222936_management_audits.sql`, generated with Supabase CLI `migration new`. It extends only the existing template key/cadence constraints, adds three private authorization/calendar helpers, replaces five existing helpers/dispatcher functions, and inserts two templates. Everything runs in one transaction. No existing records are backfilled or rewritten.

Separate authorization is required before any hosted work. A future release should verify production drift and recovery, apply this migration once after PR61's occurrence-deadline migration, verify permissions/deadlines/QR denial and original-record/grant preservation, then release the frontend through the normal pipeline. Existing Daily/Weekly clients remain compatible during backend-first installation.

Recovery is frontend-first and non-destructive. Keep the new server QR restrictions, audit definitions/cadences, versions, evidence and helper functions after any frontend revert. Replaying the old PR61 dispatcher/actor helper would remove the new audit restrictions and could expose audit records to store QR holders. Do not drop audit definitions or narrow cadence/key constraints once audit records exist. Any database recovery needs separate review/authorization.

## Local validation

- 8 source-inventory checks passed (`scripts/tests/management-audit-inventory.test.mjs`).
- 112 focused application checks passed: new audit UI/validation/period tests plus existing checklist, QR, correction, evidence/discard, PM and compliance regressions.
- 14 new isolated SQL/security groups passed, including all 20 fictional eligible sites, excluded/inactive/deleted/unassigned denial, authenticated legacy RPCs, one occurrence per period, draft continuation, optional comments, Failed follow-ups, required photo/signature, timezone/DST/leap/year deadlines, expired corrections, PT409, preserved versions/evidence/attribution, unchanged Compliance, and anonymous/private-helper denial.
- The real Edge handler was exercised against the real migrated local SQL: valid same-site QR requests for both audits, even with an account JWT, returned 403; multipart uploads never reached Storage. A separate final-INSERT test rejected synthetic stale guest intents with no object or attachment registration.
- 18 existing QR/checklist SQL regression groups passed against the new migration. A preservation test compared the original five definitions, existing records/evidence/audit history, 20 fictional QR grants and existing function ACLs before/after migration.
- Both default GitHub Pages and root Cloudflare production-base builds passed. Only the pre-existing large-bundle warning remains.

SQL checks use the existing isolated PGlite runtime and fictional fixtures. They do not certify live hosted Storage ordering, deployed schema, browser camera behavior or a physical device. No hosted acceptance or production verification is claimed for this implementation.

Reproduce from the repository root after installing application dependencies:

```sh
node --test scripts/tests/management-audit-inventory.test.mjs
node --test app/tests/managementAudits.test.js app/tests/checklists.test.js app/tests/checklistsUi.test.js app/tests/checklistCorrectionsUi.test.js app/tests/weeklyPm.test.js app/tests/checklistCompliance.test.js app/tests/checklistComplianceUi.test.js app/tests/checklistAccessIntegration.test.js app/tests/checklistGuestAccess.test.js app/tests/checklistGuestEndpoint.test.js app/tests/checklistGuestAdminUi.test.js app/tests/checklistDiscard.test.js
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test scripts/tests/management-audit-sql.test.mjs scripts/tests/checklist-qr-sql.test.mjs
npm --prefix app run build
npm --prefix app run build -- --base=/
```
