# Admin / Manager View — local implementation

Branch: `codex/admin-store-view`, isolated worktree `/Users/christopherwilliams/Developer/tm-ops-admin-store-view`, based on current main `58e5bf1a3e3b94b9c909f97b4b29b642f05f50f5`. Branch push, a draft PR and read-only production preflight are now authorized. Migration installation, merge, deployment and production data writes remain unauthorized.

## Behavior

Only an active, authenticated Admin sees the Admin View / Manager View switch. Manager View uses the existing Store components and role-dependent rendering; it does not modify the actual AuthContext profile, token, database role, user ID, assigned locations, RLS or audit identity. The preview exposes the Admin's authorized location selector and makes the selected location available to the reused Store interface. A persistent Read-only label and Admin View button remain visible.

The view preference and preview location are saved per user in sessionStorage. They survive navigation and refresh in that browser tab, are validated against current authorized locations, and are separate from existing Admin Site Entry preferences. Returning to Admin View restores normal Admin rendering. Store accounts do not receive a switch or read-only restrictions. Protected Admin routes reject preview navigation and retired roles.

Read-only Store forms retain their components and layout with disabled controls. Ordinary navigation, the preview location selector, evidence reads and reporting reads remain available. Checklist template previews are unsaved local objects: opening one does not call save_checklist or create a draft. Existing checklist evidence and history can be read, while correction, save, discard, signature and upload operations are unavailable. Required photo controls remain visible but disabled for preview drafts. Budget and Ownership calculations, imported values, checklist definitions, historical submissions and photo integrity code are unchanged.

A deny-by-default request guard blocks preview table mutations, unapproved RPCs, Storage uploads, account edits, checklist write actions and outbound submission actions before the network request. Known read RPCs, protected evidence downloads and normal auth refresh/sign-out remain allowed. Resource uploads hold a write lease for the complete resumable transfer. Mode/site changes wait for in-flight writes and respect existing unsaved-work guards. Read-only policy is applied synchronously when the mode changes, so queued autosaves cannot become new writes after entry into preview. Displayed profile/location objects are memoized to avoid repeated read effects.

## Area Manager dependency check and retirement

Production was inspected read-only using the established authenticated Edge Supabase Dashboard. At `2026-11-17T02:45:32Z` (November 16, 9:45 p.m. EST), there were zero Area Manager profiles, including zero active profiles. The manager_locations table contains 20 rows: 14 owned by Admin accounts and 6 by Store accounts, all with active owners. Those rows and the table must be retained; no account is silently reassigned or deleted.

The local application removes Area Manager navigation/access checks, account role options and its assignment editor. Admin-only routes remain Admin-only, while Store access and authorized-site behavior remain intact. The three affected Edge handlers no longer grant Area Manager privileges; Admin account actions and assigned Store downtime submission rights are preserved.

`docs/sql/retire-area-manager-REVIEW-ONLY.sql` is an unapplied, separately reviewable release artifact. It locks account changes, refuses installation if any retired-role profile exists (even inactive/deleted), verifies the original role constraint, and restricts that constraint to Admin and Store. It does not touch RLS, assignments, historical records or old migration files. It must be rechecked and explicitly authorized before installation. Legacy SQL policy/function branches in historical migrations are retained; with no retired profiles and the new constraint they cannot grant that retired role to an account.

## Validation

- 86 focused application checks passed: view authorization/persistence, real identity preservation, no preview draft creation, disabled controls, direct-route denial, mutation blocking, allowed reads, normal-write behavior, existing checklist/QR/upload behavior, location recovery, Resource Center and two-role Edge permissions.
- 2 isolated PostgreSQL checks passed: Admin/Store and existing assignments remain intact; inactive/deleted Area Manager profiles abort retirement instead of being reassigned.
- Production build passed. Existing duplicate-title and bundle-size warnings remain unrelated; no dependency or calculation changes were introduced.
- A fictional-only local browser fixture exercised the real AuthProvider, view switch, shared disabled-form boundary and Opening form: actual role stayed Admin while displayed role became Store, write probe returned 403 with zero network writes, site B persisted after refresh, and Admin View restored editable normal controls. The local HTTP server was stopped afterward; no development or production preview was published.

## Limits and release gates

This is a presentation preview and accidental-write safeguard, not impersonation or a reduced-permission security session. Requests still carry the Admin's real identity. Per-user Store ownership checks, RLS denials and server-returned capabilities cannot be reproduced exactly without a real Store account. Client-side Store filters are applied where Admin responses are broader (resources, checklist compliance and selected-site checklist reads); existing Store company-wide performance reporting is retained.

Initial preview write forms are disabled as groups, so some controls embedded in those forms (including form-local date/view controls) are also disabled; page navigation and the authorized preview site selector remain usable. No backend read-only authorization boundary is claimed. Explicit release approval, refreshed dependency verification, review of the guarded SQL, and deployment of the affected functions/frontend are required before production use.
