# Hourly Daily Log cumulative warnings

This is advisory validation in the existing Hourly Daily Log, not a new persistence or reporting rule. Autosave continues unchanged; warnings never infer a correction, block edits, rewrite counters, remove checkpoints, change attribution or alter scoring.

The validator compares each actual checkpoint with the immediately preceding checkpoint in the same location/business date, using the exported, unchanged `logMath` chronological comparator (time slot, then split index). It does not restart when employees change. Unused placeholder hours and the existing loss-only anchor are excluded using the editor's existing hourly-activity predicate. Explicit zeros are real values; blank inputs at an active checkpoint are labeled “blank (saved as 0)” to reflect the existing save semantics rather than inventing a correction.

Total Washes, Member Washes, Google Reviews, Basic, Good, Better and Best decreases are flagged. Member-wash growth greater than total-wash growth is flagged independently of the site's Simple/Detailed formula, since cumulative nonmember washes cannot legitimately fall. Reactivations, Plans Lost and Net Members keep their existing behavior. Validation also identifies invalid nonnegative whole-count inputs without changing them.

Both table and card views show an amber field indicator, previous/current values and a full explanatory warning panel. Review buttons focus the affected field/hour. Every edit, paste, Undo and split change recalculates all later comparisons. A save attempt retains visible warnings. Cancelable navigation confirmation covers Site Entry date/range/site/market/tab changes, links, navigation buttons and browser back/forward; closing/reloading uses the existing native unload warning, extended to inconsistent saved data. Cancel keeps the current local work. Existing queued saves still flush through the captured site/date persistence queue. Read-only views display issues without editing or leave prompts.

## Validation and release

- 82 focused tests passed: cumulative example, all seven counters, chronological splits, site/day boundaries, unused hours, blanks, explicit zeros, earlier corrections, original totals/deltas, navigation confirmation, persistence conflicts, historical names/IDs, Undo, paste, memberships, read-only boundaries and employee scoring.
- The existing test harness now stubs the already-present Revenue Goal component, allowing these focused Daily Log integration tests to execute; that production component is unchanged.
- Isolated headless Chrome exercised actual Dashboard + DailyLogTable, with fictional in-memory persistence and all hosted traffic blocked: table/card fields, exact example, warnings on autosave, correction and revalidation, Undo, appended split chronology, canceled date/site/tab/back/link/sign-out changes, retained unsaved edits, read-only restrictions, 390px mobile and Light/Dark layouts. Screenshots were reviewed.
- Both normal GitHub Pages and root-base production builds pass; inherited duplicate JSX attribute and chunk-size warnings remain. Backend queries, write payloads, permissions, schema, employee records and calculations are unchanged. No migration is required.

Release via the existing main-branch GitHub Pages/Cloudflare pipelines. Recovery is a frontend revert through those pipelines; no data or database rollback is necessary. Production verification uses public app loading and deployed asset checks; no live Daily Log is edited for validation.
