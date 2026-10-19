# Help and missing Store location recovery

Based on main 93589f5. No database, policy, assignment, reporting query, or deployment changes.

## Root causes found in code

AuthContext ignored errors from profile and location reads, treating failures as empty data. It marked the user as fetched before those reads succeeded, so subsequent same-user auth events could not retry. Initialization also raced getSession against auth events and allowed old requests to repopulate state after sign-out/account changes. Supabase requests were started directly inside the auth callback rather than scheduled after it returned.

Site Entry applied a saved market filter to Store assignments even though Stores could not see or change that filter. It retained a stale selected ID while the accessible list was empty, and several effects competed to clear/reselect it. These defects reproduce with mocked failed reads and stale preferences; no production account/browser state was inspected.

## Change

Help is always beside Sign Out, including missing-profile/location recovery screens. Its native modal supports keyboard focus, Escape and focus return. Missing My Location offers Reload My Location first and Microsoft Edge instructions for refreshing, removing only the current host's cookies/site data, and signing in again. The guide links to Microsoft's cookie instructions. The supplied PowerPoint screenshots are included in a collapsed Edge fallback guide below Reload My Location. Images preserve their aspect ratio, fit the panel on mobile and desktop, and open at full size. The final screenshot is explicitly labeled as an example: use the current TM Operations hostname, not its broad GitHub search, and delete only the matching row. Never use Delete displayed data or delete unrelated github.com/github.dev data. The original PowerPoint is not published.

Reload removes only tm_selected_location, tm_market_filter and the legacy tm_entry_market_filter preference. It resets mounted entry selectors, rereads profile/location access through the signed-in Supabase client and displays the outcome. Only explicit authentication failures trigger one session refresh/retry; network/permission errors and missing assignments do not. Refreshed identity must match the requesting user. No automatic cookie clearing, sign-out, assignment writes or security bypass is introduced. Query failures and inaccessible assigned rows display an error, while a successfully read Store profile with no location_id explains that an Admin must assign a location.

The successful-user guard is set only after reads succeed; failed loads remain retryable, healthy token refreshes leave forms alone, reads run outside the auth callback, and obsolete requests cannot commit. Site Entry validates every selection against the current authorized list and ignores market filters for Store users. Admin/Area Manager market filtering, assignment query scope and existing reporting remain intact. This preserves latest main's Store assignment model (user_profiles.location_id), Admin all-sites model and Area Manager manager_locations model; no unmerged role-model work is included.

## Validation

Focused tests exercise real JSX handlers with mocked hooks and Supabase results, plus the assignment/recovery utilities. Coverage includes Help without any loaded profile/location, stale selections/market filters, true missing assignments, inaccessible rows, failures, explicit repair, expired-session recovery, identity changes, duplicate clicks, initialization races, sign-out, site switching and all existing role scopes.

Isolated Microsoft Edge desktop (1280×900) and mobile-size (390×844) checks exercise the actual app with an in-memory backend, a fresh browser profile and external requests blocked. Help with no site, repair success, saved-selection replacement, conditional refresh, keyboard closing/focus, Admin Reports navigation and site switching were checked. Screens were visually inspected. These checks do not certify live authenticated RLS behavior; RLS and migrations are unchanged.

Original feature validation: 18 focused tests, 133 total tests, GitHub Pages production build and root-base production build. Both builds retain existing duplicate-title and bundle-size warnings.

Screenshot follow-up: the four unmodified PNGs come from slides 4–7 of the supplied PowerPoint. Only the Help guide, its assets, affected Help tests and this documentation changed; the self-repair/authentication implementation is unchanged. Follow-up validation: 19 affected Help/recovery tests and both production builds passed. Desktop/mobile Edge checks passed for image loading, expansion, full-size links and keyboard closing. All four assets were emitted in both production builds. The completed full test suite was not rerun for this guide-only change.
