# Running Daily Log Net Members

Based on main ee317f31094f3a75bd2102f936a5a23e732b5c5f. Frontend-only change; no migration, Supabase access, permission change or record rewrite.

Simple sites: cumulative Basic + Good + Better + Best minus the one daily Plans Lost value. Detailed sites additionally include cumulative Reactivations once. Stored memberships_sold is not added again; Reactivations remain outside the existing opportunity/conversion calculations.

The shared calculation orders rows by hour and split index. Each explicitly reported cumulative metric replaces that metric's previous value; blank/unreported fields and future hours carry the last reported count. Explicit zero is retained. Opening counts start at zero, giving a negative opening balance as soon as daily losses are reported. Missing losses remain unknown, not confirmed zero. Historical manual Net Members remain displayed as before until losses are explicitly reported; their stored values are never rewritten.

The Daily Log table, card view, image/text copies and Network hourly view use the running calculation. Daily/Employee Rollup totals use the final running balance, never the sum of hourly balances. Employee-attributed Net Members remain blank because losses have no employee attribution. The existing single editable Plans Lost input, save queue, scoped keys, authorization/date checks, database guards and audit protections are unchanged. Updating losses only updates that existing loss field; cumulative sales/reactivations are not modified.

Validation: 15 focused tests passed. Coverage includes both formulas, negative opening balances, sales/reactivation running values, split ordering, blank carry-forward, explicit zero resets, mid-day loss correction, unknown losses, historical preservation, actual hourly table values, final-only totals, immediate reactivation edits without opportunity changes, editable loss persistence and permission denial. Both production builds passed (default GitHub Pages base and --base=/), with existing duplicate-title and large-bundle warnings. No unrelated full test suite was repeated.

Branch pushes use [CF-Pages-Skip]. Keep PR draft/unmerged until release approval; no deployment was performed.
