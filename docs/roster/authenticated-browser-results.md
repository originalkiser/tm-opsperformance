# Real Supabase Auth/PostgREST validation — 2026-10-25

Project: tm-ops-dev (`bmfvcnsuduttebxbjvwx`), local preview only. Production untouched.
Administrator privately signed in to the existing synthetic Admin; no password,
JWT, service key or credentials were read, exported or committed by the agent.
`auth.getUser()` verified the actual session against Supabase Auth. Operations used
the standard signed-in supabase-js client and actual HTTP/PostgREST, not SQL role
impersonation. Existing production tab/account were not used or changed.

## Admin results — passed

- Existing authorized locations displayed; Fictional PR16 A roster loaded.
- Add Employee returned real default UUID/table data.
- Deactivate removed only the synthetic row from Active; Inactive displayed it.
- Attempt to add its trimmed/case-varied name while inactive was rejected 23505.
- Rename confirmation includes the original-name historical-sales warning.
- Cancel left original name unchanged; confirm changed display name with same UUID.
- Activate returned the retained record to Active.
- Multi-select review showed original IDs/names/status, required one retained record
  and explicit same-person confirmation; action remained disabled until confirmed.
- Cancel review was write-free. Confirm completed atomically: primary remained
  active, other owned synthetic row became inactive, both records retained.
- Native All/Active/Inactive filters worked; original fixture rows were not edited.
- Separate HTTP fixture created an employee at Fictional PR16 B as Admin; helper
  permitted that location; permanent authenticated client deletion failed 42501.
- Browser refresh retained the real session and reloaded the server roster.
- Dark/light Employees layouts verified after correcting the dev-only launcher's
  process directory. Tailwind scans app content correctly; no runtime styling or
  KPI change was required. No full mobile-viewport pass is claimed yet.

## Store results — passed

Administrator privately signed in to existing synthetic pr16-gm; auth.getUser()
verified it with the real Auth service and the profile role was checked as store.

- Employees showed only Fictional PR16 A; Admin selection/review controls absent.
- Tab keyboard navigation reached the employee-name field.
- Actual HTTP creation/default UUID, deactivation and rename passed at its site.
- A new trimmed/case-varied name matching the inactive record failed 23505.
- Two simultaneous normalized-name HTTP inserts produced exactly one success and
  one 23505 rejection; a subsequent rename collision also failed 23505.
- Other-site permission helper returned false.
- Crafted direct cross-site INSERT failed 42501; crafted cross-site UPDATE of
  an owned synthetic Admin-created target affected zero rows, preserving its state.
- Direct invocation of Admin duplicate-review RPC failed 42501.
- Permanent client DELETE failed 42501.
- All checks reached the successful completion marker. This is real signed-in
  HTTP evidence, not SQL claim impersonation. See the local-only browser fixture.

## Record preservation / cleanup

Six exact PR39 test employee IDs were cleaned up after all checks, using an
owner-side development-only transaction. Before deletion it verified the original
roster/log fingerprints, the exact six IDs/names/locations and absence of Daily Log
activity under those test names. No original fixture row was deleted or changed.
After commit: **3 original employees and 12 Daily Logs**, with original fingerprints
and all unrelated policy fingerprints unchanged. No source sales/log changes.

No production permission/schema/data changes, merge or deployment occurred.
PRs #38/#39 remain draft; PR #37 stays paused. The completed Auth gate removes the
previous missing-session blocker; it does not authorize production execution.
Fresh production preflight, SQL review and explicit execution authorization remain.
Mobile viewport visual testing is not claimed by this desktop browser run.
