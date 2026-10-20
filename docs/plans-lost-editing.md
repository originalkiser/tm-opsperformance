# Plans Lost help and editing correction

Based on main 555ccfbe747ae257e3f84cd61b773baf7fdda252. Only the Micrologic help wording and Plans Lost editability change. DRB instructions remain unchanged.

The original UI disabled Plans Lost when any saved row carried the migration's legacy marker. The installed guard also rejected losses for these days, even when historical Net Members were zero. Saved nonlegacy days already allowed editing. This update removes only that legacy-based input/write rejection. Existing canEdit and load-success checks still apply to both rendering and persistence. No other inputs, location permissions, business-date logic, or Admin audit controls change.

A database change is necessary to permit legacy-day saves. The separate review-only forward SQL replaces only public.guard_daily_plans_lost(): explicitly entering daily losses opts the date into calculated display without overwriting stored manual net_members or changing net_members_legacy. Existing manual net values remain immutable once losses are present; nonzero net values cannot be inserted into a calculated day. Nonnegative-integer/anchor constraints, saved-loss retention, identity guards, RLS, function execution grants/owner, and existing audit controls are retained. No data UPDATE, backfill, new grant, new policy or new column is included.

RELEASE GATE: review and approve docs/sql/plans-lost-editing-REVIEW-ONLY.sql, validate against the development project with existing assigned-site policies, then separately approve/install it before merging/deploying the frontend. No Supabase project was accessed or changed during implementation. Do not replay the original Plans Lost migration. The new proposal is not installed.

The inverse at docs/sql/plans-lost-editing-ROLLBACK-REVIEW-ONLY.sql restores the original guard body only, preserving all saved losses, manual values, sales, permissions and markers. It reinstates the old restriction on corrections to legacy days; it does not reverse loss entries or rewrite data. Any production execution or frontend rollback needs separate approval.

Validation: nine focused tests passed, covering exact DRB/Micrologic text, accessible popup, Store/Admin save/correct/reopen on legacy logs, explicit zero, immediate negative/daily recalculation, unchanged manual values, scoped persistence, invalid values and existing permission denial. Both production builds passed; existing duplicate-title/large-bundle warnings remain. A temporary local PostgreSQL/PGlite test exercised legacy-day edits, zero, immutable manual net, preserved sales/ACLs, retained loss/anchor validation and the data-preserving function inverse. This local test does not certify live production RLS; the patch does not modify it.

Commit messages contain [CF-Pages-Skip] to suppress branch previews. PR remains draft until migration approval and release authorization.
