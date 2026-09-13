# TM Ops Performance

Internal web app for Strickland Brothers TM (Trademark) locations to log and review daily car wash performance metrics. Store associates enter hourly data; managers and admins view rollups, trends, and employee-level breakdowns.

## Tech Stack

- **React 18** with JSX (no TypeScript)
- **Vite 5** — dev server and build tool
- **Tailwind CSS 3** — utility-first styling; custom brand tokens defined in tailwind config
- **React Router v6** (HashRouter — required for GitHub Pages compatibility)
- **Supabase** — auth, database, and real-time via `@supabase/supabase-js`
- **Recharts** — charts on the Insights page
- **GitHub Actions → GitHub Pages** — CI/CD pipeline

## Project Structure

```
app/                        # Vite app root
  src/
    App.jsx                 # Root: router, auth guard, dark mode provider
    pages/
      Login.jsx             # Email/password login
      Dashboard.jsx         # Main view — daily log, snapshot, monthly rollup tabs
      Admin.jsx             # User/employee/location management
      Insights.jsx          # Network-wide charts and analytics (managers+)
    components/
      DailyLogTable.jsx     # Hourly data entry grid (13 time slots × 8 metrics)
      DailySnapshot.jsx     # Per-employee leaderboard + shop totals for one day
      EmployeeSummary.jsx   # Employee delta rollup shown below the daily log
      MonthlyRollup.jsx     # Aggregated stats for a full month
      NetworkDayView.jsx    # Cross-location daily comparison (Insights page)
      KioskSummary.jsx      # Kiosk/machine summary component
      NavBar.jsx            # Top nav with location context and settings
      LocationSelector.jsx  # Dropdown to switch between accessible locations
      DateSelector.jsx      # Date picker persisted to localStorage
      EmployeeSelect.jsx    # Employee name input with autocomplete
      UpdateBanner.jsx      # Version check banner for deployments
      ChangePasswordModal.jsx
      SettingsModal.jsx
      TrademarkLogo.jsx
    contexts/
      AuthContext.jsx       # User session, profile, and accessible locations
      DarkModeContext.jsx   # Dark mode state
    hooks/
      useDarkMode.js        # Dark mode persistence
      useVersionCheck.js    # Polls for new deployments
    lib/
      supabase.js           # Anon client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
      supabaseAdmin.js      # Service-role client (VITE_SUPABASE_SERVICE_KEY) — admin only
    utils/
      logMath.js            # Core metric calculations (shopTotals, employeeDeltasByDay)
.github/workflows/deploy.yml  # Build → GitHub Pages on push to main
```

## Key Concepts

### Data Model

Daily log rows are **cumulative within a shop day** — each hourly time slot records running totals, not per-hour deltas. The last filled-in row holds the day's final numbers.

**Metrics logged per time slot:**
- `total_washes`, `member_washes`, `google_reviews`
- `basic`, `good`, `better`, `best` (membership tiers sold)
- `net_members` (informational)

**Derived metrics** (computed client-side, stored on row save):
- `memberships_sold` = basic + good + better + best
- `opportunities` — two formulas per location:
  - **Simple**: `TW − MW`
  - **Detailed**: `TW − MW + MS` (default)
- `conversion` = `MS / opp`
- `p_mix` = `(better + best) / MS`

### Employee Delta Logic (`logMath.js`)

Because cumulative rows can have **different employees per time slot** (shift changes), raw totals can't be attributed per employee. `employeeDeltasByDay()` diffs each row against the previous row chronologically and attributes each delta to the current row's employee. This is the only correct way to compute per-employee stats — do not sum raw row values per employee.

`shopTotals()` returns the latest row with any data — used for shop-level totals on the Dashboard.

### Role System

| Role | Access |
|------|--------|
| `store` | Own location only; can edit daily log |
| `area_manager` | Assigned locations via `manager_locations` join table; can view Insights, access Admin panel (limited) |
| `admin` | All locations; full Admin panel including user/location creation |

`canEdit` flag on Dashboard: only store users at their own location, area managers, and admins can enter data.

### Supabase Tables

- `locations` — site metadata: `name`, `site_code`, `market`, `opportunities_formula`, `exclude_from_reporting`, `show_budget_tracking`, `show_ownership_tools`, `ownership_log_cutoff_time`
- `user_profiles` — extends Supabase auth: `role`, `location_id`, `email`, `name`, `settings`
- `manager_locations` — many-to-many: `manager_id` × `location_id`
- `employees` — per-location employee roster: `name`, `is_active`, `location_id`
- `daily_logs` — the hourly data rows: `location_id`, `log_date`, `time_slot`, all metric columns
- `budget_targets` — monthly goals per site (`target_month`, `revenue_goal`, `membership_goal`, `desired_rating`, two labor-hour goals)
- `budget_daily_entries` — daily Yesterday + MTD figures per site, one row per `(location_id, entry_date)`
- `ownership_log_entries` — the daily Ownership Log post, one row per `(location_id, log_date)`
- `ownership_scorecard_entries` — monthly 10-category manager rating, one row per `(location_id, score_month)`

Schema changes live in `app/supabase/migration*.sql`, applied by hand in the Supabase SQL Editor (there's no migration runner — each file is idempotent and safe to re-run).

### Budget Tracking, Ownership Log & Scorecard

Three related features, all hidden per-location until an admin turns them on in **Admin → Locations** (`show_budget_tracking`, `show_ownership_tools`). Data entry and reporting are deliberately split across two pages:

- **Site Entry (`Dashboard.jsx`)** — where the actual daily numbers get typed in. When a site has the toggle on, "Budget Tracking" and/or "Ownership Log" appear as extra tabs next to Daily Log / Snapshot / Rollup, using `BudgetTrackingSection.jsx` (Daily Entry +, for admins/area managers, a Targets tab) and `OwnershipLogSection.jsx` (today's post). Each tab shows a small orange/red dot (see `morningStatus.js`) when that day's entry is still outstanding.
- **Reports (`Reports.jsx`)** — read-only, admin/area-manager only, no data entry. `BudgetTrackingReport.jsx` shows the cross-site leaderboard; `OwnershipLogReport.jsx` shows each site's latest post and status. Both have a per-row edit (pencil) icon that opens a modal to correct that one site's data — this is the only way to edit from Reports.

Shared pieces:
- `budgetMath.js`: Yesterday/MTD derived metrics, revenue pace, membership bonus tiers, and the Leaderboard score (Yesterday Conv 25%, MTD Conv 25%, MTD P-Mix 15%, membership progress 25%, rating 10% — the documented workbook weights, not the source sheet's buggy live formula). MTD Membership Actual is typed in directly (`budget_daily_entries.mtd_membership_actual`), same as the rest of the daily figures.
- `morningStatus.js`: the shared "is today's entry done yet" status used by both features — `none` before 6am local, `pending` (orange) 6–10am, `overdue` (red) after 10am, `complete` once submitted. Fixed schedule, not per-site configurable (`ownership_log_cutoff_time` on `locations` is unused now).
- **Ownership Scorecard** (`OwnershipScorecardSection.jsx`, Reports only): monthly 10-category manager rating (each 0–10, shown as a single overall percentage out of 100%), edited via a modal, admins/area managers only.
- A site can edit its own Ownership Log post for up to 3 days after submitting (`OwnershipLogSection.jsx`); the Reports-page edit modal has no such limit since it's an admin/area-manager override.
- **"Set targets" reminders** (`targetsNotifications.js`, `useMissingTargets.js`, `TargetsBanner.jsx`, `TargetsBell.jsx`, `SetTargetsModal.jsx`): flags any admin/area-manager-visible site missing a `budget_targets` row for the current month, or (starting 7 days before month-end) missing next month's row. The banner and NavBar bell both open the same modal — either one site at a time with a "Save Target — N sites remaining" button, or a single table to enter every missing site at once.

### State Persistence

Dashboard persists user selections to `localStorage` with `tm_` prefix:
- `tm_selected_location`, `tm_selected_date`, `tm_active_tab`, `tm_market_filter`

These are restored on page load so users land where they left off.

## Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | All clients | Project URL |
| `VITE_SUPABASE_ANON_KEY` | `supabase.js` | Row-level security enforced anon key |
| `VITE_SUPABASE_SERVICE_KEY` | `supabaseAdmin.js` | Service role key — bypasses RLS, used only for admin user creation/password reset |

Set in `.env` locally and as GitHub repository secrets for CI builds. The service key is never required for normal app use — missing it only disables the "Add User" and "Reset Password" features.

## Development

```bash
cd app
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → app/dist
npm run preview   # serve the dist build locally
```

## Deployment

Push to `main` → GitHub Actions builds and deploys to GitHub Pages automatically. The live app uses `HashRouter` so that deep links work without server-side routing.

## Styling Conventions

Custom Tailwind color tokens (defined in `tailwind.config.js`):
- `tm-navy`, `tm-blue`, `tm-teal`, `tm-sky`, `tm-cream` — brand palette
- `tm-dark-*` variants for dark mode: `tm-dark-bg`, `tm-dark-surface`, `tm-dark-card`, `tm-dark-nav`, `tm-dark-text`, `tm-dark-muted`, `tm-dark-border`, `tm-dark-row-alt`
- `font-brand` — the custom brand font

Dark mode is class-based (`dark:` prefix) toggled by `useDarkMode` hook. Always include dark mode variants when adding new UI.

## Copy-to-Image Feature

`DailySnapshot` and `EmployeeSummary` both have a **copy as PNG** button. This uses the browser Canvas API to render a styled card image to the clipboard so users can paste into group chats. The rendered image includes a location + date banner in TM brand colors. When modifying these components, verify the copy output still looks correct.
