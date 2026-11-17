# PR #69 — read-only production preflight

Result: **PASS for draft review**, not release authorization. Checked November 16, 2026, 10:13–10:18 p.m. EST (November 17, 03:13–03:18 UTC) through the existing authenticated Supabase Edge browser session. All database queries ran inside explicit read-only transactions ending in rollback. No account, permission, assignment, configuration, evidence, template or submission writes were performed.

## Accounts and assignments

| Check | Result |
| --- | --- |
| Admin profiles | 8 total; all 8 active |
| Store profiles | 24 total; 22 active, 2 inactive/deleted |
| Area Manager profiles | 0, including inactive/deleted |
| Other unsupported profile roles | 0 |
| Assignment rows | All 20 preserved: 14 owned by Admins, 6 by Store accounts |
| Orphaned assignments / retired-role owners | 0 / 0 |
| Current role constraint | Exact match for the reviewed SQL baseline |
| Role column | Non-null text, default remains Store |

The full-row assignment fingerprint and full-profile fingerprint matched before/after the preflight. No rows were reassigned, deleted, disabled or converted. The manager_locations table must remain: its current rows belong to the two supported roles.

## Permissions and compatibility

Public/Storage policy definitions, table grants and relevant public/checklist/resource function bodies had identical before/after fingerprints. RLS remains enabled on user_profiles, manager_locations, locations, daily_logs, budget_daily_entries, budget_targets, ownership_log_entries, checklist_submissions, checklist_attachments and resource_documents. No RLS, privilege, JWT, authentication-role or assigned-site changes were made.

Six existing database helpers still contain legacy Area Manager branches: checklist_private.compliance_summary, public.dashboard_mtd_performance, public.can_maintain_employee_roster, checklist_private.access_action, public.dashboard_membership_snapshots and checklist_private.assigned. One existing policy references manager_locations. These definitions and dependencies remain intact to preserve Admin/Store permissions. The guarded role-constraint artifact prevents assigning the retired role after its separately authorized installation; existing historical SQL is not rewritten.

Production has five deployed functions. The two affected deployed endpoints are admin-users and submit-downtime-jotform. Downloaded admin-users source matches current main byte-for-byte. The downtime handler's live authorization section was inspected read-only: Admin access is unconditional, Store access requires the record's location, and dry-run access currently permits Admin/legacy Area Manager. The PR removes only the unused role branch, preserving Admin/Store behavior. No deployed source was edited and no Deploy action was used. The browser blocked a second automatic source download, so download permissions were left unchanged. Instead, the complete downtime source content was compared against main through 21 read-only code-editor windows: every captured window matched, with zero uncovered non-whitespace source characters. This is a complete source-content comparison, not a downloaded ZIP byte checksum. Reconfirm the reviewed deployment artifact before any eventual endpoint deployment.

The legacy invite-user source exists in the repository but is **not deployed** and has no frontend consumer. Its cleanup does not require creating a new production endpoint. Any eventual release should update only the two existing affected endpoints; preserve their existing gateway configuration and leave checklist-access, discard-checklist-draft and manage-resource-files unchanged.

Checklist integrity remains active; Opening is version 2, Weekly PM remains version 1, and the current evidence count was 581 throughout this check. No checklist template, historical record, photo, signature or enforcement setting was changed. Budget calculation files and checklist definition/validation files are outside this PR's changes.

## Draft and remaining release gates

PR: https://github.com/originalkiser/tm-opsperformance/pull/69. Base remains production main `58e5bf1a3e3b94b9c909f97b4b29b642f05f50f5`. Branch commits use `[CF-Pages-Skip]` to prevent a preview deployment; the GitHub Pages workflow runs only on main. No merge or deployment is authorized.

The existing 86 focused application/endpoint checks, 2 isolated SQL checks, build and fictional-only browser verification remain the validation baseline. They were not repeated for documentation and a legacy error-message wording correction. Live Store write tests and impersonation tests were intentionally not attempted during this read-only preflight.

Before release: obtain explicit authorization; refresh the zero-retired-account/constraint/20-row dependency check; independently verify the complete affected endpoint artifacts and unchanged Admin/Store behavior; review/install the guarded SQL exactly once; deploy the two existing endpoint changes and the frontend under a controlled release. Preserve all assignments and RLS. The preview continues to use the real Admin identity and is an accidental-write safeguard, not a reduced-permission security session.

Private raw receipts and downloaded source: `/Users/christopherwilliams/.codex/tmp/admin-manager-view-preflight/`. No credentials, raw account rows or downloaded production source are included in Git.
