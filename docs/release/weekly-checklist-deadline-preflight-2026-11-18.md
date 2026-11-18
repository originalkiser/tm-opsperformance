# Weekly Checklist Deadlines — release preflight

Recommendation: GO for separately authorized staged backend installation. Draft PR #72 contains implementation commit `dae52d71f731b10790f4ac3b825aed88778c00c6`, based on main `3a4e5d415bc4738465522c278d966987c7c5c74f`. GitHub reported mergeable. This report is an additive release artifact. No production migration, activation, account mutation, merge or deployment was performed.

## Read-only production findings — November 18, 2026

Existing authenticated dashboard/SQL workflow only; no new login or CLI authentication. All nine owning function source fingerprints match the expected main definitions. Required schema checks found zero mismatches across 15 columns. New policy table, six private helpers and both public overloads are absent, so no installation/collision was found.

| Function | Source MD5 |
| --- | --- |
| private access_action | 1f9be628ac2542cd137ca82dba3121b2 |
| private compliance_summary | 8fadbb138a24238cee294dd2eea8995b |
| private deadline | acb0bb8f0fd6cb36dc79ea1ebe2ebe07 |
| private guard_evidence_insert | 758348f5d886cf916e9c51331e5c4654 |
| private period_end | 18752524a1901993327b2bcce9ac5037 |
| private reply | 1afbae4d4b6e9df2323bff891c28b57d |
| private validate_answers | 336af82547829609f7e96de41dacdf9b |
| public get_checklist_compliance(date,date) | 0f6223fb7631a520b39ef3ad817e09d3 |
| public save_checklist | 44bc4049794b8623e67a2dbccfbebc8e |

Existing function ACLs and fixed search paths match the baseline. Template, submission and attachment tables have RLS; authenticated direct table/column writes are denied. Read-only authenticated role-context reporting succeeds for an active Admin (20 sites) and Store (one assigned site). Store direct template update remains denied. Existing Super Admin capability count is two; no grants change. Focused ACL/RLS/source checks were used rather than repeating broad advisor scans or completed suites. Production permissions for new objects must still be verified after installation.

Seven published templates exist. Closing v2, Opening v3, Weekly Administrative v2 and Weekly PM v2 are newer legitimate publications than the repository seed baseline. Their publisher capability and exact immutable version archives were verified. Both weekly templates retain weekly cadence and every original question ID. Their conservative required-photo budgets are five and nine, within existing evidence limits; individual requirements are at most two and three. The migration does not overwrite templates or the existing answer/photo validator.

Point-in-time inventory: 251 submissions, 20 drafts, 773 attachments, 211 history entries, one working copy, 20 active QR grants and five QR-visible templates. Snapshot aggregate MD5: `a08530642ff8ad108ad01aec0297eb00`. These are a live baseline, not a claim that normal operational activity stops. Photo-integrity enforcement is enabled; zero missing Storage objects and zero unverified operational photos were found. No records, snapshots, evidence or audit trails were changed by this preflight. Recapture baselines immediately before installation and compare existing rows, allowing legitimate concurrent activity.

All 20 reporting sites have valid timezone names: Chicago 16, New York two, Denver one, Phoenix one. If both frontend hosts completed deployment on November 18, the first affected week would be November 23–29, due Monday November 30 at 11:59 p.m. local. Actual cutover must be calculated from the verified later host deployment completion timestamp; it is not fixed by this report.

## Policy and preservation verification

Both weekly keys use local Tuesday 00:00 as the exclusive boundary representing Monday 11:59 p.m. Initial submissions remain possible afterward. The server classifies lateness from original period, first submitted timestamp, snapshot timezone and immutable activation marker. Corrections cannot change the first timestamp. New-policy compliance is 100 only when both checklists were on time; otherwise zero. Old-client reports refuse late results rather than awarding false credit.

Daily, Management Audit and earlier weekly behavior use their existing paths. The original period-end and answer/photo validation functions remain untouched. No data backfill or template/snapshot/evidence rewrite occurs. Existing QR checks and server dispatcher protections remain, with narrowly scoped new-policy weekly carryover. Corrections close at the same Monday deadline. Already completed focused validation: 70 app checks, eight new SQL checks, 44 related SQL/security checks, local Admin/QR browser flows and production build passed. These were not repeated during release preparation; no broad-suite-green claim is made.

## Recovery and exact release gates

Latest available managed physical database backup observed: November 18, 2026, 10:55:58 UTC. PITR is not enabled. Supabase explicitly excludes Storage objects from database backups. The existing November 15 encrypted evidence archive is fully readable, encrypted and matches its previously verified SHA-256; it is an older supplementary archive, not a complete backup of current attachments. No restore/decryption rehearsal or new backup was performed. Reconfirm the latest recovery point before actual installation; a database restore would lose intervening legitimate work and requires separate authorization.

1. Obtain separate staged-backend authorization. Recheck main/function drift, current templates, permissions, timezone inventory, data fingerprints and latest backup. Stop on unexpected drift.
2. Apply `app/supabase/migrations/20261118182305_weekly_submission_deadlines.sql` exactly once using the established authorized workflow. Its transaction installs an inactive private policy and reviewed functions. Verify inactive marker, RLS/ACLs, unchanged existing records and operational access. No Edge Function deployment is required.
3. Obtain separate merge/frontend deployment authorization. Use the normal main pipeline; verify both GitHub Pages and Cloudflare serve the reviewed merge commit and the three-argument reporting contract. Record the later successful deployment completion timestamp.
4. Obtain separate policy activation authorization. Review `docs/sql/weekly-deadline-activation-REVIEW-ONLY.sql`, supply that verified deployment timestamp through its ephemeral session setting, and activate once. Verify each site's returned first full reporting week and Monday-local due boundary. No fake production submissions.
5. Perform read-only production acceptance for Admin/Store/QR metadata, weekly classification and historical/Daily/Audit compatibility. Do not modify accounts or templates.

If migration execution fails, its transaction must roll back; inspect for partial objects before any retry. Before activation, leave the additive backend inactive and revert the frontend through a normal reviewed release if needed. After activation, preserve the immutable marker, deadline/classification functions and legacy-client refresh guard; roll forward the frontend. Do not reset the marker or reinterpret late records. A full backend backout needs a separately reviewed data-preserving migration. Managed database restoration is a separately authorized last resort and does not restore Storage bytes.

No implementation blocker was found. Remaining gates are installation verification, both-host frontend acceptance and separately authorized activation.
