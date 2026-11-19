# Super Admin Budget Tracker Labels

Fixed editor under Manager Checklists → Manage checklist configuration, beside the existing Super Admin checklist editor. Reuses its capability gate and the existing active-Admin capability check on the server. No accounts are granted access by this migration. The verified production roster must still contain only the approved two accounts before installation.

The allowlist contains 21 entry fields: Yesterday/MTD counts, Detailed-site wash overrides, the three daily revenue inputs and reported MTD revenue, Current Total Members, reviews and rating. Each has an editable label (1–100 characters) and optional helper text (0–400). Cash reconciliation, calculated outputs, validation messages, field identities and numeric settings remain outside the allowlist. Existing original wording is seeded verbatim. Restore returns to that fixed original wording, not an arbitrary prior configuration.

Plain React text only. No HTML interpretation or arbitrary database/key selection. Separate private label/audit tables use RLS and no client/service-role table access. Public wrappers are SECURITY INVOKER; private implementations have fixed search paths. Active Admin/Store accounts read only effective wording for forms; only capability holders can use the editor or read its history. Every changed save/restore stores the actor UUID privately, actor-name snapshot, timestamp, revision and previous/new label/helper. No-op restores create no fake audit event. Expected revisions reject concurrent stale saves. Existing profile and capability rows are locked/rechecked during writes.

Site Entry and Admin correction forms use the same catalog/hook and revenue component. Only labels/helper text change; original numeric keys, input types, validation, calculator, required/optional rules and calculation/reporting utilities are preserved. Readers refresh on mount, window focus and saves in the same app. Failed reads show original wording with a visible warning and do not block existing numeric entry. Editor errors preserve unsaved text.

## Release sequence

1. Run `docs/sql/budget-labels-preflight-READ-ONLY.sql`. Require exactly two active Admin capability holders, matching the previously verified roster fingerprint, matching authorization-helper source, and no object collisions. Stop on drift. Reconfirm the current managed database recovery point; the migration does not touch Storage/evidence bytes.
2. Apply `app/supabase/migrations/20261119134744_budget_tracker_labels.sql` once. It is transactional and additive; no existing table/function definition, account grant or operational record is updated. New wording starts at defaults with empty history. Check `budget-labels-verification-READ-ONLY.sql`, installed-source hashes and focused authorization denials. Do not change real wording during acceptance.
3. Compare pre/post operational fingerprints, allowing separately verified legitimate concurrent entries. Run the Supabase security advisor for newly installed objects. Confirm ordinary Admin/Store read effective labels but cannot read editor/history or write; both approved active capability holders can read editor and perform an identical-wording no-op check. No capability assignments or new logins.
4. Merge the reviewed PR using a normal merge commit. Existing GitHub Pages/Cloudflare pipelines deploy it. No Edge Function deployment or manual Cloudflare action.
5. Verify both builds and released assets. Use headless/background tools where authorized access exists. Live editor acceptance is limited to reading current/default/preview/history; never publish artificial production wording. Confirm original default labels remain on operational forms and the editor is unavailable to ordinary Admin/Store accounts.

## Recovery

If the migration fails, its transaction must roll back; inspect before retrying. If frontend recovery is needed, revert it through the normal reviewed pipeline while retaining additive backend/audit data. Do not delete the new history or remove account safeguards. Restoring unwanted wording uses the Super Admin restore function and creates a new audit event; do not rewrite prior history. Full database restoration is a separately authorized last resort, affects unrelated concurrent data, and does not restore Storage objects.

## Access limitation during preparation

The Supabase connector denied the read-only production query. Cached CLI v2.79 cannot connect through its linked database route on the current network; cached CLI v3.1 reports no access token. No new authentication was attempted. Production preflight/installation cannot be claimed until an authorized existing connection is available. The user's no-desktop-control rule remains in force; authenticated browser use requires their specific permission.

## Completed local validation

- 39 focused app/unit/render checks passed: fixed catalog/parser/RPC payload, original field metadata, numeric form invariance, completion/scoring, wash overrides, credit-card calculator and existing styling checks. The existing render harness was supplied the new read-only wording hook and real wording utility; its original numeric/style assertions remain intact.
- Five isolated PostgreSQL security tests passed: no grants/default parity and existing-function/data preservation; ordinary Admin/Store and direct API/table bypass denial; both fictional capability holders' save/restore with exact audit actor/time/text; invalid keys/length/control characters and stale revision denial; immediate revocation, RLS, ACLs and public invoker search paths.
- Actual-component headless browser checks passed for capability-gated access, 21 fixed fields, preview/save/restore/history/conflicts, matching Site Entry/Admin correction wording, retained numeric values and calculator behavior, and desktop/mobile Light/Dark layouts with no horizontal overflow. All non-local requests were blocked; fixtures are fictional.
- Production build passed with inherited duplicate-title/bundle-size warnings. No broad suite, production preflight, migration installation or live acceptance is claimed.
