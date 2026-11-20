# Completed checklist printing

Open a completed checklist and choose **Print / Save PDF**. The browser's print dialog supports a printer or Save as PDF. All five operational checklist types and both authenticated Management Audits share this action. Drafts and template previews do not print. Existing view authorization and QR audit restrictions remain unchanged.

The print copy reloads the authorized submitted record, its saved template snapshot, and private evidence through the existing checklist transport. If the server overlays an unfinished correction, the copy uses the archived official base revision and its evidence instead. It never prints unsaved form state or queries the current template. The original completion timestamp and, where different, official revision timestamp are labeled separately in the site's time zone.

Private downloads reuse the existing authorization checks. Each image must decode, then authorization and the official revision are rechecked before printing. A denied/failed transfer or changed revision blocks the action rather than printing a silently partial copy. A temporary same-origin frame contains only read-only report content and browser-local object URLs; it contains no Storage URLs, bearer credentials, editing controls or application navigation. Resources are released after printing, on retry, or when leaving the viewer. No PDF service, dependency, database migration or new permission is introduced.

The layout includes all saved questions, responses and comments, conditional follow-ups (including clearly labeled inactive questions), failed/incomplete status, photographs, item signatures and the final signature. Empty optional responses are labeled separately from missing required responses. Photos keep their aspect ratio and page boundaries; signature/answer blocks stay together where they fit. Print margins and page size remain available through the browser dialog.

## Focused validation

- 26 focused rule, official-version, correction and existing endpoint tests passed.
- Expanded relevant viewer/QR checks: 65 passed, 3 failed; the same three tests fail on unchanged main (two stale guest-context fixtures and an existing BudgetLabelsEditor harness binding). No new failure was introduced and no broad suite was repeated.
- Isolated headless Chrome and Edge: actual React action, seven types, multi-page Weekly PM, per-item/final signatures, photos, optional blanks, conditional follow-ups, mobile width, official correction bases, revoked access, broken/denied downloads, changed revision and print cleanup passed. All hosted traffic was blocked and all records/evidence were fictional.
- Both browsers generated 11-page print-media PDFs with five embedded fictional images; page images were visually reviewed, with no blank pages or clipped photos/signatures. Failure and missing-response labels remain visible in monochrome.
- GitHub Pages and root-base builds passed, with inherited duplicate JSX attribute and bundle-size warnings. Current production hosts are compatible with the unchanged transport and browser-local frame/blob approach.

Release through the normal main-branch GitHub Pages and Cloudflare pipelines. Rollback is a frontend revert through those pipelines; there is no backend or data rollback. No production checklist record, evidence, template, permission or compliance result is modified by this feature.
