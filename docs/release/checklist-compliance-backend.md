# Checklist compliance backend: review-only release plan

## Scope and contract

This change adds `get_checklist_compliance(p_start date, p_end date)` only. It is read-only, returns one JSON scalar (avoiding PostgREST's row cap), and does not change existing raw checklist/evidence policies, template requirements, pilot history, enrollment, or operational data. Nothing has been applied remotely.

The result contains `generated_at`, `range_start`, `range_end`, `locations` and `submissions`. Locations contain exactly `id`, `site_code`, `name`, `market`, `timezone`, `local_today`. Summaries contain exactly `location_id`, `template_key`, `period_date`, `status`, `is_pilot`. No answers, submitter identities, signatures, attachments, timestamps tied to actors, or submission IDs are returned.

Active, nondeleted profiles with a supported role are required. Admins see all eligible sites; Store users see their assigned site; area managers see assigned sites from `manager_locations`. Sites with zero submissions remain in `locations`. Unsupported, inactive, deleted and missing profiles are rejected, and anonymous execute access is revoked. The public invoker wrapper calls a private security-definer helper with explicit authorization and an empty search path. The helper also validates every call, including direct invocation.

The inclusive date range is 1–92 days. Daily submissions are selected from start through end. Weekly/weekly PM summaries use Monday keys from the Monday containing start through end. Only the five known checklist keys are returned; weekly dates must actually be Mondays. Neither daily nor weekly results include periods later than each site's `local_today`. Invalid/missing time zones on scoped sites fail the entire report explicitly, with no browser fallback. The UI should distinguish future periods from missing submissions and retain `is_pilot` provenance.

## Release gates requiring confirmation

- `HANDOFF.md` says the schema is incomplete and `locations.exclude_from_reporting` and `locations.timezone` were created manually. Verify actual production types, nullability, time-zone values, and `name`, `market`, `site_code` before authorizing application. No production inspection or migration application is included here.
- There is no `locations.is_active` in the repository base schema. This implementation maps “active reporting locations” to `exclude_from_reporting IS NOT TRUE`, matching existing JavaScript `!exclude_from_reporting` behavior, including legacy NULL values. Confirm this mapping is operationally correct before release. Do not invent a separate active flag or infer eligibility from past submissions.
- Verify the companywide-access and weekly-PM migrations are already applied. Apply the new migration only with separate release authorization, before releasing a client that calls it.
- Confirm the report is descriptive: daily 100% requires all three daily submissions; weekly 100% requires both weekly submissions. No authoritative obligation-start dates are available. Historical missing rows are not proof of a historical requirement, and this release must not claim a retroactive policy change. Keep that notice visible in the report.
- Review production query plans/volume under authorized read-only inspection; the existing `(period_date, location_id)` submission index supports bounded range selection. The scalar response is intentionally not a paginated raw-row API.

## Local verification

Use an external pinned PGlite install, not app dependencies:

```sh
npm install --prefix /tmp/tm-checklist-tools --no-audit --no-fund @electric-sql/pglite@0.5.15
PGLITE_MODULE=/tmp/tm-checklist-tools/node_modules/@electric-sql/pglite/dist/index.js \
  node --test scripts/tests/checklist-compliance-sql.test.mjs
```

The fictional in-memory fixture runs the actual pilot, companywide and weekly-PM migrations, followed by the new RPC migration. Four test groups cover role scope and zero-submission sites, denied profiles/anonymous access, narrow field allowlists, real raw-answer/evidence isolation, all five templates, drafts and pilot provenance, Monday lead-in, bounds/future suppression, scoped timezone errors, idempotence, unchanged existing policies/data and execution in a read-only transaction. PGlite is not a production PostgREST or Storage integration test; deployment smoke checks remain necessary.

Rollback is application-first: hide/revert the report client. The additive read-only function can remain unused without affecting checklist entry or evidence. Any later function removal/revocation is a separate reviewed database change; do not delete checklist data or revert existing RLS to roll back this report.
