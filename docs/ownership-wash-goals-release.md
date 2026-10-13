# Ownership Log wash goals release

Three goals persist per location independently of daily posts and calendar changes. They start read-only; Edit goals opens a draft with separate Save goals and Cancel controls. Daily post submission never saves goal drafts. Goal updates use the loaded updated_at value to reject concurrent overwrites. Saves stamp authenticated actor/time at the database.

The new daily field is WHAT WILL WE DO TODAY TO HELP ACHIEVE OUR GOALS. Existing Plan for Today remains. Original comments are neither rewritten nor deleted; recent history displays daily goal actions or legacy notes. Both Site Entry and Admin post editor use the same goals component.

Migration18 adds one nullable daily-action column and the per-location goals table, with RLS based on the existing Ownership Log location-access function. No existing security policies or records change. Anonymous access and authenticated delete/direct-trigger execution are denied.

Validation: 39 automated tests passed, including locked goals, explicit editing, Cancel, separate saves, optimistic conflict filter and failed saves. Both production builds passed; existing duplicate-title/bundle warnings remain. Rollback-only tm-ops-dev schema validation passed with RLS enabled and no anonymous read, authenticated delete or direct stamp execution. Dev lacks the Ownership Log baseline, so temporary baseline fixtures were used and all schema changes rolled back. Authenticated database role/write tests and full browser UI checks remain before production approval.

Release order: complete development integration/visual checks; verify production backup/schema and migration number; apply reviewed migration18 once after explicit approval; merge reviewed app and confirm automatic deployments; verify real daily action/goal saves using owner-approved values. Do not rerun earlier migrations. Rollback must keep goal, daily action and legacy comment data; reverting the UI can hide new fields but should not drop tables or columns.

No production changes, merge or deployment are authorized by this review PR.
