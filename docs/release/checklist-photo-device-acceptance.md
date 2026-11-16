> Correction notice: the proposed trap-door changes belong to Opening. Prior Weekly PM proposal/test fixtures are superseded; preserve their saved snapshots. Preview work and release are paused. See [verified mapping](checklist-photo-opening-mapping-correction.md).

# PR #68 minimal physical-device acceptance

Preparation only. No frontend preview has been deployed by this step. Production enforcement stays disabled; no production template change or merge is authorized.

## Current production result

Reconciliation queued zero photos. At November 16, 2026 04:26:42 UTC (November 15, 11:26:42 p.m. EST), all 20 eligible sites had zero pending, inaccessible and missing photos. All 170 operational photos were verified. The endpoint drain had elapsed. Hash/source-identity conflicts, active/legacy in-flight uploads, expired unregistered photo intents and uploaded-but-unregistered objects were all zero. Enforcement was false. The prior historical duplicate groups remain preserved; readiness is not activation authorization.

## Smallest safe setup

Use the existing `tm-ops-dev` Supabase project (`bmfvcnsuduttebxbjvwx`) and existing preview hosting, with fictional records at one clearly labeled acceptance location. Never use the production application, production locations, real inspection images or production account credentials for this test.

A read-only development check found all seven version-1 templates and 28 existing checklist records, but no photo-integrity bootstrap. No development rows or schema were changed. No verified HTTPS preview of the PR frontend is currently available. The current local launcher binds to the Mac's loopback interface; it is not an iPhone URL. Camera access from an ordinary phone browser requires a secure context; an HTTP LAN address is not a substitute. See [camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Before a phone test can run, separately authorize a temporary HTTPS nonproduction acceptance preview and the bounded development preparation: apply the reviewed backend to dev, preserve and reconcile its existing records/evidence, verify dev readiness, configure the preview to dev only, and enable duplicate protection in that nonproduction backend for acceptance. The rollout switch is backend-wide, so it cannot be enabled for just the fictional location; existing dev history must pass readiness first. No new CLI authentication or infrastructure is needed. This is deliberately not executed under the instruction forbidding frontend deployment or enforcement activation. The source artifacts are already reviewed in PR #68; do not use a preview that points at production.

The browser camera fixture in `scripts/tests/checklist-photo-browser.mjs` is useful for simulated camera/UI checks but uses a mocked transport and mocked duplicate response. It must not be presented as proof of real upload persistence or server rejection. The actual nonproduction backend must receive the test bytes for those checks.

## iPhone Safari: one short session

After the isolated HTTPS link and existing dev test sign-in are verified and supplied, use Safari directly, not an in-app browser. Record the iPhone model and iOS version once. Use a sheet of paper marked `PR68 TEST`; a harmless photo of that paper already in Photos is sufficient for the audit check.

1. Open the supplied nonproduction acceptance link. Confirm the fictional location/test banner. Open its Opening inspection draft and enter `Device Test` as the name. Do not fill out or submit an entire checklist.
2. At the first required photo, tap **Open camera**, allow camera access, then **Cancel camera** once. Reopen it and tap **Take photo** while pointing at the test paper. Expect a live camera preview, no normal photo-library control on the operational question, camera closure after capture, and **Photo saved privately.**
3. Tap **Save Draft**. Close the form, refresh Safari and reopen the same draft. Confirm the answer/name and saved photo remain. Tap **View saved photo** and confirm the image opens. This checks server persistence, not just local unsaved-answer recovery. No fresh photo should be required merely to retain saved evidence.
4. Open the nonproduction Monthly Site Assessment. At **Site Standards / Other, Question 1 — Hours of Operations**, use **Add photo**, choose **Photo Library** and select the harmless test image. Confirm upload success. Reopen the native picker and verify that its camera option is also available; cancel without taking another image.
5. Check the same camera/library picker once in the prepared fictional Quarterly audit snapshot. The original Quarterly template currently has no photo-required questions, so it normally renders no picker. A one-photo fictional snapshot using the real Quarterly key exercises its unchanged upload branch without editing any template. Save/reopen this short fixture if testing its upload persistence; do not add a photo requirement to the actual Quarterly template.

A fail is any library picker on an operational photo question, inability to capture/upload on Safari, lost saved evidence after reopening, or missing library/camera choices in the native audit picker. Record the step and message; do not troubleshoot by changing production settings.

## Exact-byte duplicate check: operator, not extra phone work

The operator keeps the exact bytes of the newly uploaded nonproduction operational photo. Replay those bytes through the real verification endpoint as a NEW upload request to a different operational draft at the SAME fictional location. Require the server response to reject it with: `This photo was already used for this location. Take a new photo of the current inspection.` Verify that no new attachment was registered. Retrying the original request or reopening the saved draft must retain the original evidence normally.

Taking another photo of the same paper does not exercise SHA-256 duplicate detection because it usually produces different bytes. Do not weaken the operational picker or add a production test button to make this test possible. The existing focused endpoint/SQL tests already cover hash computation, duplicate rejection, draft retention and bypass restrictions; the short live dev replay connects them to a real device upload. No production duplicate activation is needed.

## Android minimum

One physical Android phone running Chrome; the same person can borrow it, so a second person is not required. Repeat the five short phone steps once, with a separate fictional draft. No second round of the full checklist inventory, screenshots at every step, or broad OS/device matrix is required. Reuse the operator's duplicate check implementation; it need only replay the Android-produced bytes once. Record phone model, Android version, Chrome version and pass/fail.

## Status and handoff

Production readiness: passed at the snapshot above. The focused audit-picker test now explicitly covers both audit keys with fictional snapshots and passed (one selected test; unrelated tests skipped). Existing automated camera/SQL/endpoint results remain simulated/local evidence, not physical-device acceptance. No broad suite was repeated.

Physical Safari/Chrome capture, real nonproduction uploads/reopening and live byte-replay rejection remain NOT RUN until the nonproduction setup is authorized and available. The only phone-side requirements are the two physical browsers and the short steps above. No production template, enforcement, frontend release or PR merge may be inferred from acceptance preparation or a passing test.
