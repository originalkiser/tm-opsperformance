# Opening mapping correction — release paused

Read-only production template comparison completed before local changes. Both public templates are version 1. No production writes or development fixture changes were performed for this correction.

| Existing ID / overall position | Section | Existing question | Correction |
|---|---|---|---|
| opening-9 / 9 | Tunnel Inspection (first) | Check entry trap door (pull grates), inspect carriage for proper tension | Approved entry wording; retain Critical; require photo |
| opening-10 / 10 | Tunnel Inspection (second) | Check exit trap door (pull grates) for signs of air leaks or debris | Approved exit wording verbatim; retain Critical; require photo |

Opening keeps all 31 IDs and positions, the existing gauge-photo question opening-6 and separate hydraulic-fluid leak question opening-14. Both replacements show “Photo must clearly show the inspected components with the grate(s) removed.” No additional condition/bolt or exit air-leak wording is appended.

Weekly PM source is restored byte-for-byte from main and its entire definition compares equal to current production. Preserve weekly-pm-conveyer-10 at array position 15: “Inspect trap doors! Are they in good condition and are the bolts tight?” This retains the condition and bolt-tightness requirement.

Signatures are original approved requirements, not added by the proposal or a rendering defect:

- weekly-pm-tunnel-27, array position 64: arch ground-bolt tightening sign-off.
- weekly-pm-booster-1, array position 80: booster mesh-filter cleaning sign-off.
- Final auditor signature after all questions.

The incorrect proposal inserted Q28/Q29 after the original Tunnel Q27 signature, making that existing sign-off appear before the added questions. Restoring PM restores original order; do not remove or move required signatures.

Development read-only check finds the old November 9 PM two-question fixture and November 16 PM version-two 81-item fixture still saved as drafts. Neither represents the corrected assignment. November 15 Opening is a shortened one-item draft; November 16 Opening has 31 items with its saved version-one snapshot. Preserve all these drafts. Do not use them as evidence that the corrected prospective Opening template is published. No new preview or replacement fixture was created.

Smallest release change: replace the unapplied PM migration with the guarded prospective Opening migration, restore PM source/tests, update only Opening Q9/Q10 and focused tests. The bootstrap migration, verification endpoint, duplicate-photo enforcement code and camera implementation remain unchanged. Existing snapshot-based server validation already supplies required-photo enforcement.

## Production question order (read-only baseline)

### Opening Checklist — version 1

1. `opening-1` — Mechanical Room Actions — Turn air valve on air compressors, breakers, ball valves
2. `opening-2` — Mechanical Room Actions — Turn control power on for conveyor
3. `opening-3` — Mechanical Room Actions — Check chemical levels - fill to the line
4. `opening-4` — Mechanical Room Actions — Check water levels on RO holding tanks (full)
5. `opening-5` — Mechanical Room Actions — Turn on and check computers (POS, tunnel controller)
6. `opening-6` — Mechanical Room Actions — Power pack hydraulic fluid at optimal levels?
7. `opening-7` — Mechanical Room Actions — Air compressor tanks drained of condensation?
8. `opening-8` — Mechanical Room Actions — Inspect air compressor motor and belt for wear or oil leaks.
9. `opening-9` — Tunnel Inspection — Check entry trap door (pull grates), inspect carriage for proper tension
10. `opening-10` — Tunnel Inspection — Check exit trap door (pull grates) for signs of air leaks or debris
11. `opening-11` — Tunnel Inspection — Check for leaks or debris under and around rotating equipment
12. `opening-12` — Tunnel Inspection — Walk Tunnel and check for leaks and damage. Correct as necessary. Complete Tunnel Maintenance Daily at this time
13. `opening-13` — Tunnel Inspection — From Tunnel Control Podium, run Wet Down, go to tunnel entrance and verify wet down. Listen for abnormal noises.
14. `opening-14` — Tunnel Inspection — Check for any signs of hydraulic fluid leaks near Heco drive (exit end of conveyor), spinning wraps, or any hose connections
15. `opening-15` — Tunnel Inspection — Pull top brush down and spin it around to ensure no debris has wrapped around it from the prior day.
16. `opening-16` — Tunnel Inspection — Run ghost wash and complete tunnel walk board - listen for any unusual noises that may help detect an issue
17. `opening-17` — Tunnel Inspection — Fill prep buckets
18. `opening-18` — Property Actions — Inspect vacuum filter bags and ensure separators are empty
19. `opening-19` — Property Actions — Turn vacuum systems on one at a time - walk lot and inspect hoses for proper suction and listen for air leaks
20. `opening-20` — Property Actions — Ensure trash cans are prepped for opening
21. `opening-21` — Property Actions — Detail center is stationed, stocked, organized, and cleaned - wash dirty towels
22. `opening-22` — Property Actions — Ensure lot, landscaping, vacuum area, and all signage are clean and free of trash or debris.
23. `opening-23` — Property Actions — Turn on Paystation/XPT, close entry gate and return switch to normal position.
24. `opening-24` — Property Actions — Make sure lobby area and bathroom are clean and well stocked with supplies.
25. `opening-25` — Property Actions — Are the vacuum separators and producers clean and empty?
26. `opening-26` — Administrative Actions — Complete cash audit tracker and daily cash handling process
27. `opening-27` — Administrative Actions — Complete rotation schedule for the day
28. `opening-28` — Administrative Actions — Set daily/individual goals for the day
29. `opening-29` — Administrative Actions — Execute Team Huddle
30. `opening-30` — Administrative Actions — Turn open sign on and open entrance lanes
31. `opening-31` — Administrative Actions — Open up tunnel doors

### Weekly Preventive Maintenance Checklist — version 1

1. `weekly-pm-controls-1` — Carwash Controls — Are any breakers tripped?
2. `weekly-pm-controls-2` — Carwash Controls — Any fuses blown?
3. `weekly-pm-controls-3` — Carwash Controls — Equipment/Chemicals timed properly (Wash an employee car)?
4. `weekly-pm-controls-4` — Carwash Controls — Stop/Go light timed properly?
5. `weekly-pm-controls-5` — Carwash Controls — Auto Cashier functioning properly/clean?
6. `weekly-pm-conveyer-1` — Conveyer and Track — Are the rollers free to move both ways?
7. `weekly-pm-conveyer-2` — Conveyer and Track — Any spurs on the track or or roller equipment that can damage tires?
8. `weekly-pm-conveyer-3` — Conveyer and Track — Any air lines that are chafed, split or damaged?
9. `weekly-pm-conveyer-4` — Conveyer and Track — Call-up fork working properly?
10. `weekly-pm-conveyer-5` — Conveyer and Track — Spray the air cylinder rod with lubricant!
11. `weekly-pm-conveyer-6` — Conveyer and Track — Clean off take-up slides and tunnel entry!
12. `weekly-pm-conveyer-7` — Conveyer and Track — Check chain tension! If less than 1" tighten.
13. `weekly-pm-conveyer-8` — Conveyer and Track — Any rollers worn or missing?
14. `weekly-pm-conveyer-9` — Conveyer and Track — Is sprocket alignment correct?
15. `weekly-pm-conveyer-10` — Conveyer and Track — Inspect trap doors! Are they in good condition and are the bolts tight?
16. `weekly-pm-conveyer-11` — Conveyer and Track — Inspect rail guard for missing or damaged pieces!
17. `weekly-pm-conveyer-12` — Conveyer and Track — Are there any leaks on the drive motor/gearbox?
18. `weekly-pm-conveyer-13` — Conveyer and Track — Grease the take-up shaft bearings (2) 1 to 2 pumps of the grease gun!
19. `weekly-pm-conveyer-14` — Conveyer and Track / Trench/Pit — Pit/Trench is clean, with no mud or debris and water is flowing freely?
20. `weekly-pm-prep-1` — Prep Station — Do you have any leaks on the High Pressure hoses?
21. `weekly-pm-prep-2` — Prep Station — Are the tanks free of debris?
22. `weekly-pm-prep-3` — Prep Station — Are any of the quick couplings leaking?
23. `weekly-pm-prep-4` — Prep Station — Check hoses for any chafing, cracks or damage!
24. `weekly-pm-prep-5` — Prep Station — Inspect Nozzles! Do they show signs of wear or damage?
25. `weekly-pm-prep-6` — Prep Station — Check pump levels! If the level is low add
26. `weekly-pm-tunnel-1` — Tunnel Equipment — Complete the lock out tag out for the wash!
27. `weekly-pm-tunnel-2` — Tunnel Equipment — Check oil levels for all hydraulic components! Did any reservoirs need fluid?
28. `weekly-pm-tunnel-2-followup` — Tunnel Equipment — Which components needed fluid?
29. `weekly-pm-tunnel-3` — Tunnel Equipment — Check the depth of the water in the trench and the depth of the dirt!
30. `weekly-pm-tunnel-4` — Tunnel Equipment — Ensure all of the lights work!
31. `weekly-pm-tunnel-5` — Tunnel Equipment — Walk the tunnel greasing every bearing and spraying lubricant on all air cylinders!
32. `weekly-pm-tunnel-6` — Tunnel Equipment — Check the blowers for debris!
33. `weekly-pm-tunnel-7` — Tunnel Equipment — Walking back check all of the cloths! Do any of them need replacement?
34. `weekly-pm-tunnel-7-followup` — Tunnel Equipment — Which cloths are in need of replacement?
35. `weekly-pm-tunnel-8` — Tunnel Equipment — Remove lock out tag after verifying no one is in the tunnel and turn on the wash!
36. `weekly-pm-tunnel-9` — Tunnel Equipment — Is the reclaim system operating properly and is the strainer basket clean?
37. `weekly-pm-tunnel-10` — Tunnel Equipment — Are any water lines or fittings leaking?
38. `weekly-pm-tunnel-10-followup` — Tunnel Equipment — What is leaking?
39. `weekly-pm-tunnel-11` — Tunnel Equipment — Top Brush/Brushes operational?
40. `weekly-pm-tunnel-12` — Tunnel Equipment — Are there any leaks on the hydraulics of the top brush unit?
41. `weekly-pm-tunnel-13` — Tunnel Equipment — Do the Omni top and side sprayers operate properly?
42. `weekly-pm-tunnel-14` — Tunnel Equipment — Are there any hydraulic leaks on the Omni sprayers?
43. `weekly-pm-tunnel-15` — Tunnel Equipment — Are the nozzles clean and spraying?
44. `weekly-pm-tunnel-16` — Tunnel Equipment — Are the arches working properly?
45. `weekly-pm-tunnel-16-followup` — Tunnel Equipment — Which ones are not working?
46. `weekly-pm-tunnel-17` — Tunnel Equipment — Are the bottom motor side washers working properly?
47. `weekly-pm-tunnel-17-followup` — Tunnel Equipment — What is the issue?
48. `weekly-pm-tunnel-18` — Tunnel Equipment — Is Wrap station #1 functioning properly?
49. `weekly-pm-tunnel-18-followup` — Tunnel Equipment — What is the issue?
50. `weekly-pm-tunnel-19` — Tunnel Equipment — Is Wrap station #2 functioning properly?
51. `weekly-pm-tunnel-19-followup` — Tunnel Equipment — What is the issue?
52. `weekly-pm-tunnel-20` — Tunnel Equipment — Are the side to side mitters working?
53. `weekly-pm-tunnel-20-followup` — Tunnel Equipment — What is the issue?
54. `weekly-pm-tunnel-21` — Tunnel Equipment — Are the chemical tire applicators working?
55. `weekly-pm-tunnel-21-followup` — Tunnel Equipment — What is the issue?
56. `weekly-pm-tunnel-22` — Tunnel Equipment — Are the tire brushes working properly?
57. `weekly-pm-tunnel-22-followup` — Tunnel Equipment — What is the issue?
58. `weekly-pm-tunnel-23` — Tunnel Equipment — Is the tire shiner working properly?
59. `weekly-pm-tunnel-23-followup` — Tunnel Equipment — What is the issue?
60. `weekly-pm-tunnel-24` — Tunnel Equipment — Does the Spotfree rinse work properly?
61. `weekly-pm-tunnel-24-followup` — Tunnel Equipment — What is the issue?
62. `weekly-pm-tunnel-26` — Tunnel Equipment — Do the blowers function properly?
63. `weekly-pm-tunnel-26-followup` — Tunnel Equipment — What is the issue?
64. `weekly-pm-tunnel-27` — Tunnel Equipment — Have you tightened all bolts securing the arches to the ground with a wrench? [item signature required]
65. `weekly-pm-air-1` — Air Compressor — Does the oil level in the sight glass show halfway?
66. `weekly-pm-air-1-followup` — Air Compressor — Fill to the proper level!
67. `weekly-pm-air-2` — Air Compressor — Does the compressor belt squeal when it activates on?
68. `weekly-pm-air-3` — Air Compressor — Check the back up compressor and ensure it operates!
69. `weekly-pm-air-4` — Air Compressor — Are there any air leaks or oil leaks on either unit?
70. `weekly-pm-air-4-followup` — Air Compressor — What are the issues?
71. `weekly-pm-air-5` — Air Compressor — Do the tank drains operate properly?
72. `weekly-pm-air-5-followup` — Air Compressor — What is the issue?
73. `weekly-pm-vacuums-1` — Vacuums — Inspect all vacuum filter bags for wetness or tears!
74. `weekly-pm-vacuums-2` — Vacuums — Inspect the canister and filter access door gaskets for cuts, wear and leaks!
75. `weekly-pm-vacuums-3` — Vacuums — Are pipes and hoses in good shape?
76. `weekly-pm-vacuums-3-followup` — Vacuums — What is the issue?
77. `weekly-pm-vacuums-4` — Vacuums — Grease impeller shaft bearings!
78. `weekly-pm-vacuums-5` — Vacuums — Does the vacuum system have enough suction to run all lines?
79. `weekly-pm-vacuums-5-followup` — Vacuums — What is the issue?
80. `weekly-pm-booster-1` — Booster Pump Mesh Filter — Did you clean the booster pump mesh filter?? [item signature required]


## Corrected nonproduction acceptance preparation

Authorized preparation completed November 16, 2026. Only tm-ops-dev was modified. Its Opening catalog is now prospective version 2; Weekly PM and all other templates are unchanged. A new fictional location `PR68-OPENING-TEST` has one fresh Opening occurrence, November 16, snapshot version 2 with all 31 original IDs/order, including required photos opening-6, opening-9 and opening-10. Non-photo responses are explicitly fictional and prefilled to minimize phone testing. Older fixtures remain preserved at the earlier fictional location and are absent from this QR context.

The existing HTTPS preview was reused without a frontend deployment or Cloudflare login. Its unchanged runtime renders the corrected database snapshot: both trap-door Critical labels, both exact instructions and enabled camera controls were verified in Edge. Physical Safari/Chrome camera acceptance remains pending. Preview CSP restricts backend connections to tm-ops-dev; 32 reachable JS chunks were scanned without production references or secret credentials.

Development server save-RPC checks, entirely rolled back, rejected both photos missing, entry missing and exit missing separately. The positive control with all three required photos plus final signature submitted successfully within that rolled-back transaction. No mock Storage metadata or test submission persisted. A real endpoint draft save/reopen passed. Fingerprints of every pre-existing submission, attachment, Storage metadata object and non-Opening template matched before/after.

The new QR session and location-scoped duplicate protection expire November 16 at 2:28 a.m. EST. Global development enforcement remains false. Production was not accessed or changed. Capability URLs remain in the private acceptance folder, outside Git. After physical testing, revoke the new grant, disable its acceptance scope and clean up only authorized temporary resources; preserve earlier records. Do not run the old cleanup helper alone, because it predates this additional fictional location.

## Physical iPhone acceptance — PASS

November 16, 2026: the user reported physical iPhone Safari acceptance PASSED. Both corrected Opening required-photo camera controls worked, both photos uploaded, and both remained attached after reopening the draft. Device model and iOS/Safari versions were not provided; the pass records this specific observed flow, not a wider browser matrix.

A read-only tm-ops-dev check independently confirmed the original fictional occurrence `36019a2d-3548-4eb6-89d7-0d3b5f4b1552` is now submitted (version-two snapshot, revision 7), with one photo each for opening-6, opening-9 and opening-10. Preserve this completed acceptance record and all its evidence. The corrected catalog and local implementation remain unchanged.

## Minimum Android Chrome acceptance — READY, NOT RUN

One physical Android phone using Chrome; no second tester required. Reuse the existing HTTPS preview. Because the iPhone occurrence is now submitted, prepare one separate fictional location `PR68-ANDROID-TEST` and fresh Opening draft `806e955f-ec1c-4d67-87ea-0389e34ef1cb`. It uses the same complete Opening version-two snapshot and prefilled fictional answers. Save/reopen through the real dev endpoint passed. Its QR excludes old fixtures and shares the existing November 16, 2:28 a.m. EST expiry; no session extension, login, template change or deployment was needed.

Phone procedure: open the private Android link in Chrome, verify PR68-ANDROID-TEST and resume Opening November 16; under Tunnel Inspection capture a different fictional scene for each of its first two required-photo questions; save draft, close and reopen, and confirm both photographs remain. A gauge photo and final signature are required only if testing final submission; final submission is not necessary for this minimum physical capture/reopen check. Record phone model, Android/Chrome versions and pass/fail. Preserve iPhone evidence.

Remaining release gates: physical Android capture/reopen confirmation; any outstanding original physical Management Audit picker checks must not be inferred from the operational camera pass; synchronize/review the corrected feature branch and PR artifacts; final production drift/reconciliation/readiness check and explicit authorization for enforcement activation, prospective Opening publication, frontend release and merge. Required-photo server rejection and exact-byte duplicate security checks already passed; no broad suites were repeated. Production was neither accessed nor modified for this acceptance update.


## Final release authorization and physical acceptance

November 16, 2026: user confirmed both iPhone Safari and Android Chrome PASS and authorized controlled production release conditional on final gates. Preserve both physical acceptance records and the corrected Opening definition. Final source review confirms Weekly PM is identical to main and the read-only production baseline; its original generic trap-door question and all three signatures remain unchanged. Both Management Audits retain their original native file inputs without capture restrictions; focused picker/upload checks passed. This authorization supersedes earlier holds but does not waive readiness, recovery, compatibility or deployment gates.
