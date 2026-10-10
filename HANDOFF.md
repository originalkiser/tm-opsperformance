# Collaborator handoff

Read [`CLAUDE.md`](CLAUDE.md) first — it covers the architecture, data model, roles and conventions. This file covers what it doesn't: **how changes reach production, how to work safely against the one database we have, and what to know before you touch anything.**

> This repository is public. Never commit keys, passwords, user data or screenshots of the admin panel. Credentials are handed over person-to-person, not through the repo.

## What you'll need access to

| What | Why | Who grants it |
|---|---|---|
| GitHub repo (write access) | A push to `main` **is** a production deploy | Michael |
| Supabase project `tm-opsperformance` (ref `qbdvixxooofdlfurcpqy`) | Database, auth, edge functions, backups | Michael — via the Supabase org |
| Cloudflare Pages project | Second host, `ops.tmcw.app` | Michael |
| An admin login to the app itself | To see the Admin panel and every site | Michael |

The Supabase org also contains unrelated projects (InventoryOS, tripplanner). **Always pass `--project-ref qbdvixxooofdlfurcpqy` to the CLI** and never run commands against another project.

## 1. Deployment

**Does merging to `main` publish the live site? Yes, automatically.**

- Push to `main` → `.github/workflows/deploy.yml` (the only workflow) runs `npm ci` + `npm run build` and publishes to GitHub Pages at `https://originalkiser.github.io/tm-opsperformance/`. Usually live within a couple of minutes. The workflow can also be re-run by hand (`workflow_dispatch`).
- The same repo is also built by **Cloudflare Pages** and served at `https://ops.tmcw.app`. That build is configured in the Cloudflare dashboard, not in this repo: root directory `app`, build command `npm run build -- --base=/`, output directory `dist`. It needs its own environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); if they're missing at build time the site loads but login fails with "Failed to fetch". (GitHub Pages builds use `base: '/tm-opsperformance/'` from `vite.config.js`.)
- Both hosts talk to the **same database**. There is no staging site.
- Work has gone **straight to `main`** — no PRs or feature branches so far. CI is a build only: **no tests and no lint**. A failed build does not replace the live site. (Branch-protection rules, if any, are in the GitHub repo settings and can't be seen from the code.)
- Users get an "update available" banner within about 5–6 minutes of a deploy (`useVersionCheck.js`).
- **Rolling back:** `git revert <sha>` and push. Don't force-push `main`. Database changes need their own rollback — see `app/supabase/migration10_rollback.sql` for the pattern.

**Supabase is not part of that pipeline.** Migrations and edge functions are applied by hand:

```bash
cd app
supabase db query --linked -f supabase/migrationNN.sql
supabase functions deploy <name> --project-ref qbdvixxooofdlfurcpqy --use-api
```

When a change needs both, **do the Supabase side first, then push the client** — otherwise the live app briefly calls something that doesn't exist yet. Migration 10 is the example of a change that can't be fully done ahead of time; read its header.

## 2. Database and testing

There is **one** Supabase project, and **`npm run dev` points at it** (via `app/.env`). Anything you enter while signed in locally is real data. We decided a separate test instance isn't worth the upkeep, so work carefully instead:

- Write migrations that are **additive and safe to re-run** (`if not exists`, `drop … if exists` first). Every `migrationNN.sql` follows this.
- If a step can't be undone cleanly, split it into a safe step and a risky step, and write a rollback file alongside it (`migration10.sql` / `migration10_rollback.sql`).
- Read-only exploration is always fine. For anything that writes, use a throwaway or low-stakes record, never a real site's day.
- Don't test the Jotform hand-off on real downtimes — it posts to the real Jotform form and can email sites. Use the function's `dry_run` option (admins and area managers), which builds the payload without sending it.
- Row-level security is on for every table. A "no error, nothing happened" result usually means RLS filtered the row, not that the write worked. Check how many rows were affected.

**The schema is not fully in this repo.** Several tables the app uses — `app_settings`, `downtime_logs`, `deleted_downtime_logs`, `downtime_reasons` — and several columns on `locations` (`exclude_from_reporting`, `timezone`, `site_email`, `metric_thresholds`, `downtime_tracking_enabled`, `operating_hours_override`) were created by hand in the Supabase dashboard and aren't in any `migration*.sql`. `supabase/seed.sql` is the original base schema only. So if you ever want a test copy, **start from a schema-only dump of production, not from the repo SQL**, and do not copy the contents of `app_settings` (it holds the Jotform API key, so a copy could post to the real form).

The database also contains tables this app doesn't use (`dvt_*`, `kiosk_summary`). They're not referenced anywhere in this repo. Don't drop or alter them; ask Michael what they are.

## 3. Backups, scheduled jobs, credentials

**Backups.** Supabase takes automatic daily backups (about a week is retained). Point-in-time recovery is off, so the worst case is losing up to a day of entries. Restoring replaces the whole database, so treat it as a last resort. Nothing backs up outside Supabase. Code is in git; Jotform's data lives in Jotform.

**Scheduled jobs.** There are none in the database (no `pg_cron`). The only automation is:
- the GitHub Actions deploy;
- Supabase's daily backups;
- one trigger that creates a `user_profiles` row (role `store`) whenever an auth user is created;
- one trigger that stops anyone but an admin changing a user's role, location, active/deleted status or email (`migration12.sql`).

The "Deletes in N days" countdown on deleted users and deleted downtime logs is display-only — nothing purges them; they stay until an admin permanently deletes them.

**Edge functions** (both require a signed-in caller and check roles inside):
- `submit-downtime-jotform` — posts a resolved downtime to Jotform; see the "Downtime → Jotform hand-off" section of `CLAUDE.md`.
- `admin-users` — create user, reset password, change email, permanent delete.
- `invite-user` is in the repo but is not deployed and nothing calls it.

**Where credentials live** (values are never in the repo):
- Supabase URL + public (anon) key: GitHub Actions secrets, Cloudflare env vars, and your local `app/.env` (gitignored). The anon key is public by design — row-level security is what protects the data.
- The Supabase **service-role** key bypasses all security. It must only ever exist inside Supabase (it's injected into edge functions). **Never put it in a `VITE_*` variable** — Vite bakes those into the public JavaScript.
- The Jotform API key and field mappings are in the `app_settings` table, readable only by admins, and edited at Admin → JotForm Integration.
- Power BI reads downtime data through the public key, via a read policy on `downtime_logs` (the connection details are shown in Admin → Downtime). If the project's API keys are ever rotated, Power BI needs the new key.

**Before touching any keys or secrets, check with Michael** — a rotation of the project's API keys is planned, it signs every user out, and it needs the GitHub secrets, Cloudflare variables and Power BI updated together.

## 4. Things that will trip you up

- **Cumulative data model.** Hourly rows are running totals, not per-hour counts; use `logMath.js` for anything per-employee or per-hour. A "split hour" is several rows sharing a `time_slot` with different `split_index`.
- **Site names.** The Jotform "Site" dropdown uses long names (`1520-Cleveland-N Davis`); a new site needs an entry in `supabase/functions/submit-downtime-jotform/siteNames.ts` and a redeploy of that function.
- **Time zones.** Store-local dates/times use `locations.timezone`; never format a store's times in the browser's zone.
- **Two hosts, two base paths.** Use `import.meta.env.BASE_URL` / relative paths for assets, never a hard-coded `/tm-opsperformance/`. Routing is `HashRouter`, so deep links work on both.
- **Accounts.** Create and manage users through the Admin panel (it calls `admin-users`). A user made directly in the Supabase dashboard still gets a `store` profile from the trigger, but has no site until an admin assigns one, and its temp password wouldn't be shown anywhere.
