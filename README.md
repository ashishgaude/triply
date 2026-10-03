# Triply

A shared trip expense tracker built with React, TypeScript, Vite, and Supabase.

## Authentication

Triply uses Supabase email/password authentication, matching expense-tracker:

- Sign in or create an account; email confirmation is supported.
- Request a password reset and set a new password from the emailed link.
- Restore sessions on reload and sign out from the account button.
- Load trips owned by the account or shared with it through trip membership.

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in an ignored `.env.local` file using the names in `.env.example`. Use only a public anon/publishable key, never a service-role key. Restart Vite after changing environment settings. The local configuration reuses expense-tracker's Supabase project, so existing accounts work in both apps; their app sessions remain separate.

In Supabase Authentication settings, keep the email provider enabled and add the Triply URLs to the redirect allowlist:

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/?mode=reset-password
http://localhost:5173/
http://localhost:5173/?mode=reset-password
```

Also add the actual production app URL and its `?mode=reset-password` variant, including any deployment base path. Confirmation and password-reset links must return to Triply, not expense-tracker. Keep email confirmation enabled for production. PKCE confirmation/recovery links should be opened in the browser that requested them.

## GitHub Pages Deployment

The [deployment workflow](.github/workflows/deploy-pages.yml) runs on pushes to `main` or manually from the Actions tab. It installs dependencies with `npm ci`, runs tests and lint on Node 24, builds the PWA using GitHub Pages' base path, and deploys the `dist` artifact. Deployments do not modify the database.

Repository setup for `ashishgaude/triply`:

1. In **Settings > Pages**, set **Source** to **GitHub Actions**.
2. In **Settings > Secrets and variables > Actions**, add repository secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, using the same public Supabase configuration as the local app. Never use a service-role/secret server key; `VITE_` values are embedded in the public bundle.
3. Push the workflow and app to `main`, or run **Deploy Triply to GitHub Pages** manually after the workflow is pushed.
4. In Supabase Authentication's redirect allowlist, add `https://ashishgaude.github.io/triply/` and `https://ashishgaude.github.io/triply/?mode=reset-password`.

The expected deployment URL is `https://ashishgaude.github.io/triply/`. Production PWA installation requires HTTPS, which GitHub Pages provides. Auth and database setup from the sections below remain required. To verify repository-path assets locally, use `npm run build -- --base /triply/`.

## Local Development

```sh
npm install
npm run dev
```

## PWA

Triply uses `vite-plugin-pwa`, like Penny Pilot. The production build includes a standalone web app manifest, service worker, branded 192/512 icons, a maskable icon, and an Apple touch icon. Icons are generated with `npm run icons` and regenerated automatically during builds.

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Open the preview URL and install through the browser's Install app command. On iPhone/iPad, use Safari's Share menu and Add to Home Screen. Production hosting must use HTTPS; localhost is also supported. The service worker is intentionally disabled on the Vite development server, so test installation/offline behavior with the production preview.

After one online visit, the app shell and local assets can open offline. Supabase auth/API responses are never cached, and writes are not queued. Sign-in, trip loading, and expense/repayment saving require a network connection. An offline notice makes this clear. Fonts and the trip photo may be unavailable offline.

New versions display an update notice with Reload and Dismiss rather than automatically reloading an open expense form. Reload discards unsaved edits. Manifest URLs and install metadata use the configured Vite base path; when deploying to a subdirectory, build with the matching base and add the deployed auth redirect URLs in Supabase.

## Checks

```sh
npm test
npm run build
npm run lint
```

Use Node.js 22.18+ (or 24+) for the TypeScript tests.

## Database Setup

Run these migrations in the shared Supabase project's SQL editor, in order:

1. [Traveler directory](supabase/migrations/2026-10-03-traveler-directory.sql)
2. [Trips and expense storage](supabase/migrations/2026-10-03-trip-storage.sql)

Both are rerunnable. All application tables and functions belong to `triply`; existing public-schema tables are untouched. Add `triply` to Supabase Data API's **Exposed schemas** without removing schemas used by the other project. Database administrator access is required to apply migrations; the public browser key cannot do this.

Tables:

- `triply.users`: registered-user directory.
- `triply.trips`: owner, destination, currency, version, and timestamps.
- `triply.trip_members`: selected registered travelers and their display order.
- `triply.expenses`: description, payer, category, date, and integer-cent amount.
- `triply.expense_participants`: selected travelers, split order, and exact-cent shares.
- `triply.payments`: recorded repayments between travelers.

The UI reads `get_workspace` and writes `save_trip` through the authenticated Supabase client. Each save is one transaction; validation failures roll back the entire change. Version checks reject stale edits instead of overwriting another device's changes. Direct table writes are denied. Row-level security restricts reads to the owner and trip members. Owners manage trip details and travelers; owners and members can add/edit/delete expenses and record/undo repayments. Trip currency is fixed after creation. Amounts and relationships are checked in the database as well as the UI.

Use Refresh trips to fetch changes made on another device. There is no automatic realtime subscription yet. Reads use a consistent database snapshot, not separately fetched fragments. The app never reports a successful save before the database confirms it, and it shows errors and retry controls when configuration or connectivity is unavailable.

## Traveler Directory

Run [the traveler-directory migration](supabase/migrations/2026-10-03-traveler-directory.sql) in the shared Supabase project's SQL editor before using registered travelers. This requires a database administrator; the frontend's public key cannot apply migrations.

Triply database objects live exclusively in the `triply` schema. The Supabase client defaults to that schema; the other project's public-schema tables are not read or modified. In Supabase Data API settings, add `triply` to **Exposed schemas**, retaining the existing schemas needed by other apps. The migration grants authenticated users schema usage and read-only table access. If the earlier migration was already run against `public`, rerun the updated migration to create the Triply directory and redirect its own auth trigger; it does not drop or modify existing public tables or functions.

The migration creates `triply.users` with only a user ID and display name, and a `triply.sync_user` trigger function. It backfills existing `auth.users` and synchronizes new registrations and name changes through a database trigger. Supabase authentication remains in its managed `auth` schema. Names come from `full_name`/`name` metadata, falling back to the email's local part or a short ID. Full emails, tokens, passwords, and other auth fields are not exposed. All authenticated accounts in the shared project can read this directory, including accounts from expense-tracker. Anonymous reads and client writes are denied.

New trip and Add travelers use searchable checkboxes populated from that table. Traveler IDs are the registered users' database IDs, so matching display names remain distinct. Already-added users are excluded from the add-traveler picker. Loading failures, an empty directory, and the missing migration are shown explicitly; there is no free-text or mock-user fallback.

Selecting a registered traveler grants that account access to the trip through membership. They can find it when they sign in and refresh their trip list. No invitation email or actual money transfer is sent.

## First version

- An empty workspace with no seeded trips, travelers, or expenses; create your first trip with New trip.
- Select a trip in the sidebar or top dropdown before adding expenses. Each trip has its own travelers, expenses, and repayments; the selected trip is remembered after reload.
- Select registered users as travelers; add, edit, delete, search, and filter expenses.
- Equal splits across all travelers or a selected subset.
- Exact-cent balances and suggested repayments, with recording and undo.
- Database persistence across accounts/devices and CSV expense export.
- One currency per trip: EUR, USD, GBP, INR, CAD, or AUD.

Trips, memberships, expenses, split participants, and repayments are stored in Supabase. Only the selected-trip preference and auth session are stored locally. Existing browser-only workspaces are not silently uploaded or deleted: the app offers a JSON backup download, so old data can be retained while trips are recreated using registered travelers. There is no currency conversion or actual money transfer. CSV exports cover the selected trip's expenses and are not full backups. The trip photo and fonts require an internet connection.