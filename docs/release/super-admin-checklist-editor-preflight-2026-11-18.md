# Super Admin Checklist Editor release preparation — 2026-11-18

Recommendation: **GO for staged installation approval**, with the verification gates below. This is not approval to execute. Draft PR: https://github.com/originalkiser/tm-opsperformance/pull/71. Implementation is `3ba149e`, based on current main `af7f85d`. Subsequent release-preparation changes contain documentation and an isolated regression test only.

No production migration, account grant, record change, merge or deployment was performed. Existing authenticated Supabase dashboard access was used. Connector SQL/advisor permission was unavailable; no new login, CLI authentication or infrastructure was introduced.

## Read-only production observations

Seven templates match the isolated pre-install fixture exactly (definition fingerprints, versions, cadence and question counts):

| Template | Version | Cadence | Questions | Definition MD5 |
|---|---:|---|---:|---|
| closing | 1 | daily | 19 | 6fc69c4362636b4e222802ee4f71a11c |
| midday | 1 | daily | 5 | 6d7d71e1207d7d1e0af501b3924d1ff9 |
| monthly_site_assessment | 1 | monthly | 78 | 4e06fdc65938a5f87975856b4590396f |
| opening | 2 | daily | 31 | 6996a303225200f2f17af31e244f8838 |
| quarterly_safety_audit | 1 | quarterly | 43 | a877e9109cb37af3d93677834e63ea57 |
| weekly | 1 | weekly | 16 | e0ca52f7ec7fa72996e31b4280369ed6 |
| weekly_pm | 1 | weekly | 80 | 9e16b65add6742ab24a045082955509e |

Installed `access_action`, `assigned`, `evidence_ids`, `period_end`, `qr_template_allowed`, `validate_answers`, `configure_checklist_pilot` and `save_checklist` source fingerprints match the fixture. Private helpers deny anon/authenticated execution and use fixed search paths. Public save/configure currently allow authenticated execution, deny anon, and use fixed paths. The proposed migration disables immediate publishing; ordinary Admins can currently use the existing publisher until installation.

The new private schema, editor/capability/account-guard functions and validator-backup name are absent: no installation/name collision detected. Existing client template SELECT is allowed, UPDATE is denied; profile UPDATE remains allowed subject to existing RLS/trigger checks. The existing privileged-profile trigger is installed. Auth has its account-creation trigger and no account-update synchronization trigger. Profile-policy fingerprints were recorded read-only; the migration does not replace those policies.

There are 8 active Admin profiles and 24 Store profiles (22 active), with no null active flags and no other role rows. Twenty manager-location assignments remain. Observed checklist aggregates: 245 submissions (225 submitted, 20 drafts), 205 history versions, one working copy, 389 photos and 374 signatures. Submission-snapshot aggregate MD5: `99b448a0d628e391276fa12c8c5f88f4`. Counts are point-in-time observations, not a freeze on normal usage.

Operational photo enforcement is enabled and the registered endpoint is `sha256-v1`. Read-only checks found zero missing evidence objects and zero operational photos lacking a verified-or-legacy fingerprint. No answers, evidence paths, account identifiers or credentials are included here.

The deployed `admin-users` source was inspected in the authenticated Code view: it retains `auth.getUser()`, the current Admin/active caller checks and existing create/reset/email/delete behavior. It does not yet contain the proposed protected-target authorization. Gateway “Verify JWT with legacy secret” is OFF; preserve that setting and the explicit caller validation. Deploying the guarded endpoint before any grants is mandatory.

The consolidated read-only metadata SQL is provided in `docs/sql/super-admin-release-metadata-READ-ONLY.sql`. Bounded metadata queries supplied the observations above. The complete consolidated query, fresh backup availability, all column/constraint details, and live role-specific acceptance must be rechecked at the installation gate; they are not claimed as completed end-to-end production migration testing. Production writes were intentionally not used to test security.

## Security advisor baseline

The existing dashboard Security Advisor linter was rerun: **0 errors, 41 warnings, 9 informational suggestions**. Warning rows were reviewed: seven mutable search-path functions; seven permissive-policy warnings for downtime/DVT tables; six publicly callable SECURITY DEFINER functions; twenty signed-in callable SECURITY DEFINER functions; and disabled leaked-password protection. These are installed baseline findings, not a clean security certificate. Relevant rows include `protect_profile_privileged_columns`, `configure_checklist_pilot`, `save_checklist`, evidence/discard RPCs and role/location helpers.

The migration does not remove unrelated policies or broadly revoke operational RPCs. The old publisher becomes an invoker wrapper with enforced denial; new privileged implementations remain private and fixed-path, with RLS and revoked direct table access. Rerun advisors after installation and investigate any new finding before grants. Existing callable-function warnings require reviewing their internal authorization, not indiscriminately revoking required operational APIs. Unrelated inherited warnings remain follow-up work.

## Validation and limits

158 focused app tests and 30 isolated SQL/security tests pass; browser editor workflow/mobile/dark checks and production build pass. The full suite has the same 47 failing names as unchanged main, with zero added failures; see `super-admin-inherited-test-failures.md`. Existing duplicate-title and bundle-size build warnings remain.

An additional release test passes after warming the old save/validator execution paths before applying the migration in disposable PostgreSQL. A newly published two-photo requirement still rejects a one-photo submission. No application source changed during preparation.

Isolated tests cover ordinary Admin/Store/anon denial, direct-table and private-function bypasses, legacy immediate publisher denial, empty initial capability table, protected-profile mutations, account-target authorization and nonprotected account allowance. Existing operational authorization, historical boolean photos, signatures, conditional follow-ups, N/A, cadence/deadlines, five QR checklists/two authenticated audits, immutable snapshots, evidence integrity and compliance calculations are covered by the focused regression suites. Existing installed dependencies match those fixtures. This supports compatibility; live post-install behavior cannot be proven before installation. Real password/email/delete actions were not attempted on production users.

## Exact gated installation and deployment sequence

1. Obtain separate installation/endpoint/client authorization. Confirm PR head and current main; if main changes, rebase/review and rerun affected checks. Use project `qbdvixxooofdlfurcpqy` exclusively through the existing authenticated dashboard workflow. Check a successful recoverable backup and capture current endpoint source/configuration. Stop if recovery is unavailable or dependencies drift.
2. Rerun both reviewed read-only SQL files. Check required relations/columns/constraints, existing function definitions, private Storage configuration and QR allowlist. Capture current per-record snapshot fingerprints privately so normal new submissions can be distinguished from rewrites. Do not save identifiers to repository artifacts. Stop on unexplained differences.
3. In the authorized SQL Editor install **only** `app/supabase/migrations/20261118145030_super_admin_checklist_editor.sql`, once, as one transaction. Confirm COMMIT success. Do not combine it with the grant script. Verify `configuration_private.super_admins` count is **0**, seven baseline template-version rows exist, original template definitions/versions and existing submission/working-copy snapshots are unchanged, direct client writes are denied and ordinary Admin editor/legacy publishing calls fail.
4. Deploy only updated existing `app/supabase/functions/admin-users/index.ts` and its existing shared dependencies via the established authenticated function workflow. Preserve gateway JWT OFF and explicit `auth.getUser()`. Do not deploy other functions, rotate keys or introduce a new auth workflow. Verify the deployed source includes caller-JWT `authorize_admin_user_action` and fails closed if unavailable. Validate nonprotected-account authorization without sending real credential mutations.
5. Rerun security advisors. Compare baseline findings and investigate new ones. Perform authorized Admin/Store/QR read-only smoke checks, including normal user lists, location scope and existing draft reopening. Count table must still be zero. Stop on a failed gate.
6. Only after separate merge/deployment authorization, merge reviewed PR #71 through the existing main pipeline. GitHub Pages and Cloudflare production builds follow main; never manually deploy Cloudflare. Verify both builds and client version. With zero grants nobody can edit templates. Do not publish photo-count templates before this compatible client/backend sequence is complete.
7. **Separate account-grant authorization:** pause/drain account-management operations and verify the guarded endpoint is live before proceeding. Freshly verify the same three approved existing active Admin Auth/profile pairs using exact confirmed login identities. Stop on ambiguity. Use only the reviewed `docs/sql/super-admin-grants-PARAMETERIZED-REVIEW-ONLY.sql`, supplying its ephemeral three-pair verification manifest privately in the same SQL session. Its atomic checks require an empty capability table and uniquely verified existing accounts. Do not log the manifest or put it in a PR. Confirm exactly three capability rows and no role, profile or assignment changes, then resume account management.
8. Verify all approved accounts gain editor capability and another Admin/Store cannot call any writing path or alter protected accounts. Verify other-account management authorization remains allowed. Credential mutations require controlled authorized acceptance, not resets of real coworkers. Exercise saved draft/preview/conflict/history without publishing business content. A real template publication requires reviewed business wording. Recheck original snapshots/evidence and ordinary operational access. Continue read-only observation of compliance results.

## Recovery and rollback

* **Migration error before COMMIT:** issue ROLLBACK if needed; stop. Confirm new objects are absent and existing function fingerprints/snapshots unchanged before retrying. Do not continue to endpoint/client/grants on a partial or uncertain result.
* **Installed backend but endpoint/client gate fails:** grant nobody. Keep the new backend restrictions; the old client can continue operational work while template editing stays unavailable. Correct and redeploy the guarded endpoint/client through the same reviewed workflow. Do not restore the old immediate publisher as a workaround.
* **Disable editor:** after explicit recovery authorization, execute `docs/sql/super-admin-editor-disable-REVIEW-ONLY.sql`. It atomically revokes authenticated execution on public and private editor entry points and retains all capability/account guards, history and operational tables. Verify both calls deny access and ordinary checklist saving still works. To re-enable after correction, grant EXECUTE on those same two exact signatures to authenticated in a reviewed transaction; never grant private-table access.
* **Client rollback:** revert the feature client through a reviewed main PR and the existing deployment pipeline, or roll forward a fix. Keep the database guards and guarded account endpoint. Older clients cannot edit templates, which is the intended safe degraded state. After photo-count templates are published, prefer disabling the editor/rolling forward: older clients do not explain new count requirements properly.
* **Bad published wording/template:** restore the reviewed prior immutable version into a draft, preview, and publish a new higher version. Existing in-progress/submitted snapshots remain untouched; never decrement versions or overwrite history.
* **After any account grants:** never redeploy the old unguarded account endpoint. Editor disable does not remove protections. Capability revocation or replacement is a separate trusted-operator authorization, with the same private identity verification. Pause/drain account management for such changes.
* **Database disaster recovery:** a point-in-time/backup restore is a separately authorized incident action because it can discard unrelated production writes. Do not drop the private schema, version history, validator wrapper or protection triggers as routine rollback. Retaining additive security objects plus safe-disable is the prepared non-destructive database rollback; full removal needs its own reviewed migration and grant-state assessment.

Next authorization: staged production migration and guarded endpoint installation, followed by separately approved merge/client deployment. Account grants remain a later independent authorization. No implementation blocker was found in the inspected dependencies; fresh backup/schema gates and live post-install acceptance remain mandatory release conditions.
