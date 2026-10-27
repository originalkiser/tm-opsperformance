# Hosted roster validation — authorization and remaining gate

Confirmed development project: tm-ops-dev / bmfvcnsuduttebxbjvwx.
Read-only inspection still shows 3 employees, 6 locations and 12 Daily Logs.
Its employee policy is tmdev_employees_write, calling an Admin-only helper; it has
no PR #38 helper. Do not run the production-policy precondition against it or
silently replace policies shared by existing consumers.

Proposed employee-only adapter for review: preserve the existing read policy and
all records; replace only tmdev_employees_write with the EXACT helper, column grants
and insert/update policy bodies from PR #38. No location/profile/assignment policy,
Daily Log, auth schema or shared helper changes. Then apply this PR's name trigger
and Admin review function. This changes existing development employee access and
was explicitly approved and executed under the prior shared-dependency stop condition.
Admin existing add/status payloads remain supported; deletion/custom-ID/location
changes intentionally stop working. Record metadata/ACL snapshots and stop on drift.

Hosted tests require real Supabase Auth sessions for synthetic Admin/store/manager
accounts and two isolated synthetic test locations. No credentials should be pasted
into chat. Administrator can sign in through the app/browser or provide an approved
local test credential setup. Connector supplies public keys, not an Admin Auth key;
SQL role impersonation or fabricated JWTs are not evidence of real Auth compatibility.
Do not create users by directly editing auth.users or change Auth configuration.

The employee-only adapter and name/review migration were applied to development
with explicit administrator approval. Original rows, unrelated policy/helper
fingerprints were preserved. SQL-role tests passed with all data probes rolled back.
Anonymous HTTP resolved both RPC signatures and returned HTTP 401 / SQLSTATE 42501.
**Real signed-in Admin and store Auth/PostgREST tests passed on 2026-10-25.**
See authenticated-browser-results.md and the local-only browser test fixture.
The administrator privately signed in to the existing synthetic accounts. No Auth
users/passwords/configuration or credentials were created/read/exported. All six
owned test records were removed only after exact ownership and fingerprint checks;
the original three employees and twelve logs and unrelated policies remain intact.
The preview launcher now sets its working directory to appRoot for Tailwind content
resolution; dark/light desktop rendering passed. The API guard is verified with
actual signed-in HTTP, including parallel inserts and crafted cross-site writes.
No production query/change, merge or deployment is authorized by these results.
