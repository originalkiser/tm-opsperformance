# Weekly checklist deadline policy — local implementation

Branch `codex/weekly-checklist-deadlines`, based on current main `3a4e5d4`. No production reads/writes, migration installation, account changes, push, merge or deployment were performed for this implementation. The original checkout and earlier worktrees are preserved.

## Behavior

Only `weekly` and `weekly_pm` change, starting with each location's first full Monday–Sunday reporting week after the verified production deployment completion timestamp. The week remains identified by its original Monday. The private policy is installed inactive and activated once after both frontend hosts are verified. The release marker must be the actual verified deployment completion timestamp, not the later time an operator happens to click activation. It cannot precede backend installation, lie in the future, be reset or be deleted through the normal activation path. App clients and service_role have no table privileges or activation API.

A site-local Tuesday 00:00 exclusive boundary represents Monday 11:59 p.m. inclusive. Calendar days are added before timezone conversion, including DST. Earlier reporting weeks keep their exact previous behavior; no submissions, snapshots or checklist templates are backfilled or rewritten. Daily and Audit deadlines continue using the existing period-end helper unchanged.

Initial weekly drafts can be started, saved, photographed and submitted after the deadline. First `submitted_at`, original `period_date`, immutable snapshot timezone and the frozen release marker determine timeliness on the server. Corrections do not change first submission time. A late initial submission therefore remains Completed Late permanently and earns no on-time credit.

Submitted weekly corrections, their draft working copies and in-flight correction evidence uploads all close at the same Tuesday 00:00 boundary. Required fresh signatures, evidence ownership/immutability, photo hashing, counts, rate/intent limits and normal authenticated review remain in force. Late initial drafts remain editable after the deadline; the UI's deadline refresh does not lock them or overwrite unsaved answers.

Monday cards explicitly show both previous and current reporting weeks. At the cutover, an earlier legacy week is labeled as original rules; QR can resume its existing draft but cannot create a previously forbidden historical start. The previous week remains available afterward for permitted late completion, including a checklist not started before its deadline. For QR access, only new-policy past weekly starts gain this eligibility; historical weeks, Daily Checklists, Audit exclusion and location/grant checks retain their original restrictions. Saved older drafts retain their immutable IDs and reporting period. The QR older-week selector offers only server-approved new-policy reporting periods, including never-started late work. Default cards show the current and immediately previous week, and older saved work remains in unfinished-work lists. Authenticated users retain their existing historical date selector.

Weekly cards, forms and unfinished-work lists show the server due date and status. Overdue is separate from draft/missing status; Completed Late is separate from Submitted on time. The existing compliance table, filters, counts and CSV gain these distinctions without a dashboard redesign.

For new-policy weeks the server returns the binary site-week score: 100 only for two on-time required submissions, otherwise zero. Missing, overdue and late counts remain separately visible. Earlier weekly scores and Daily scoring are unchanged. The first-submit timestamp is evaluated at the server's completed validation/save instant, not a client clock or request's claimed timestamp.

## API and compatibility

Existing authenticated and QR workflows still share the same dispatcher, reply, deadline and evidence guards. Replacements retain original function identities, ACLs and guards; no legacy publisher or account protections are changed. A new authenticated invoker RPC provides status-only weekly card metadata after the existing assigned-location check. Its private implementation uses a fixed search path and grants no data-table access.

New compliance clients pass `p_weekly_contract: 1` to the three-argument overload of `get_checklist_compliance`. The old two-argument call remains usable for unchanged periods, but refuses a response containing Completed Late and requests an app refresh. This prevents cached old clients from treating two submitted records, one late, as 100% on-time. A cached old client's Daily report can also request weekly lead-in rows: if those contain a late record, it will require refresh rather than show a misleading report. The new frontend retains normal Daily functionality and can report both cadences. There is no raw-table fallback and no public SECURITY DEFINER reporting wrapper.

Timing/status metadata is computed; it is not stored by changing existing status columns, snapshots or prior audit rows. Existing `status='submitted'` semantics continue to serve operational review. The on-time classification is the additional authoritative timing field.

## Prepared release — not authorized to execute

1. Verify current main, reviewed function fingerprints and required schema using `docs/sql/weekly-deadline-preflight-READ-ONLY.sql`; confirm backups and unchanged template/evidence/account/capability fingerprints. Verify all participating site timezones. Stop on drift.
2. Separately authorize/install `20261118182305_weekly_submission_deadlines.sql` once. It creates one private inactive policy row and the reviewed functions; no existing data or grants change. Verify policy inactive, private RLS/ACLs, old periods and normal access. Run production security advisors only under the later authorized release workflow.
3. Separately authorize the application PR merge/deployment through the existing main pipeline. No Edge Function deployment is required. Verify GitHub Pages and Cloudflare both serve the reviewed commit, including the named three-argument reporting call and QR carryover behavior.
4. Under separate activation authorization, use `weekly-deadline-activation-REVIEW-ONLY.sql` with the verified later production deployment completion timestamp in its ephemeral session setting. Review the returned first week for each site. Deployment near Sunday/Monday can produce different first weeks across timezones; this is intentional local-calendar behavior.
5. Verify Sunday/Monday/Tuesday boundaries and the first eligible reporting week read-only in production. Do not create fake production submissions. A real completion must remain a real operational entry. Account/capability grants are outside this release.

Before activation, a client rollback is safe while keeping the additive backend. After activation, retain the release marker, new deadline/classification functions and the legacy-client refresh guard; roll forward the frontend if needed. Do not reset the marker, rewrite snapshots, change first submission times or reinterpret late records as on time. Full backend removal after activation needs a separately reviewed data-preserving recovery plan; it is not a routine migration reversal.

## Focused validation

* 70 app checks: existing checklist, transport, Audit and compliance tests, plus late/overdue filters and export, server-score handling, due labels and timer protection for unsaved late drafts.
* 8 new isolated SQL tests: inactive/one-time release; site-local cutover; spring/fall DST; Monday 23:59:59.999 versus Tuesday 00:00; on-time/late scoring; QR start/resume and never-started older weeks; late status permanence; correction signatures and upload finalization expiry; authenticated review; historical/account/evidence preservation; legacy-client refresh denial.
* 44 related SQL/security regression checks: photo integrity/staging, Management Audits, compliance and Super Admin. The new inactive migration is injected into completed integrity fixtures; predecessor staging fixtures intentionally remain at their older schema until their own migration test.
* Separate headless local browser checks cover Admin and QR current/prior-week cards, explicit original-week creation, due dates, forms, 390px dark/mobile layout and no horizontal overflow. Non-local requests are blocked and all identities/data are fictional.
* Production build and diff whitespace check. Existing duplicate-title/bundle-size warnings remain; no broad full-suite rerun or full-suite-green claim is made.

Test invocation examples (use the existing external Node/PGlite/Playwright installations):

```
PGLITE_MODULE=/path/to/pglite/dist/index.js node --test scripts/tests/weekly-deadlines-sql.test.mjs
CHECKLIST_WEEKLY_DEADLINE_MIGRATION=1 PGLITE_MODULE=/path/to/pglite/dist/index.js node --test scripts/tests/checklist-photo-integrity-sql.test.mjs scripts/tests/checklist-photo-staging-sql.test.mjs scripts/tests/management-audit-sql.test.mjs scripts/tests/checklist-compliance-sql.test.mjs scripts/tests/super-admin-template-sql.test.mjs
```

Run Vite from `app/` on loopback port 5189 for `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/tests/weekly-deadlines-browser.mjs` (invoke the script from repository root). No hosted acceptance, real camera/device capture or production advisor run is claimed by these local tests.
