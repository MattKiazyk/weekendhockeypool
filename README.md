# Weekend Hockey Pool

An NHL and PWHL regular-season confidence pool for Friday–Sunday games, built with React, Vite, a Cloudflare Worker, D1, and Clerk. Each person can submit one entry per league per weekend. Production: [hockey.mattkiazyk.com](https://hockey.mattkiazyk.com).

## Local development

Use Node.js 24 LTS (`.nvmrc`) and npm. Node 22.13+ within the 22.x release line and Node 26+ are also supported; Node 25 is outside Vitest's supported versions.

```sh
nvm use
npm ci
npm run db:migrate:local
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:5173`. Without a Clerk publishable key, development shows an interactive NHL preview using the checked-in October 2–4, 2026 schedule. The PWHL tab shows its coming-soon state. The yellow bar switches the NHL preview between open, locked, and final states. Preview entries live only in that browser's `hockey-pool-demo-entry` localStorage key. Clear that key to reset the entry. Preview mode never submits entries to D1.

For the real authentication flow, copy the configuration templates and fill in development credentials from the Clerk **Hockey** application:

```sh
cp .env.example .env
cp .dev.vars.example .dev.vars
```

| Variable                     | Location                           | Purpose                                        |
| ---------------------------- | ---------------------------------- | ---------------------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env`                             | Browser Clerk instance; embedded at build time |
| `CLERK_PUBLISHABLE_KEY`      | `.dev.vars` / Worker configuration | Matching server Clerk instance                 |
| `CLERK_SECRET_KEY`           | `.dev.vars` / Worker secret        | Server authentication and user lookup          |
| `ADMIN_CLERK_USER_ID`        | `.dev.vars` / Worker secret        | Account allowed to use admin endpoints         |

Enable usernames in Clerk. Existing accounts without one can choose a username from the pick sheet. Local credential files are ignored by Git; only placeholder examples belong in source control. The secret key must never use a `VITE_` prefix. Production builds without a publishable key show a configuration error instead of enabling preview mode.

## Code layout

| Path                                          | Responsibility                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main.tsx`                                | Clerk and preview session adapters                                             |
| `src/App.tsx`                                 | Navigation, page composition, and action feedback                              |
| `src/components/`                             | Pick sheet, matchup controls, standings, admin forms, and shared page elements |
| `src/About.tsx`                               | Public playbook and rules                                                      |
| `src/hooks/usePool.ts`                        | Loading, cancellation, deadline refresh, entrants polling, and saving          |
| `src/lib/pool.ts`                             | Shared types and pure pool rules used by both browser and Worker               |
| `src/lib/leagues.ts`                          | Supported league IDs and display metadata                                      |
| `src/lib/api.ts`                              | Browser JSON requests and the pool data shape                                  |
| `src/lib/demo.ts`                             | Preview fixtures and validated browser storage                                 |
| `src/lib/format.ts`, `session.ts`, `views.ts` | Display dates, session contract, and navigation metadata                       |
| `src/style.css`                               | Shared styling and responsive rules                                            |
| `worker/index.ts`                             | Cloudflare fetch and scheduled entry points                                    |
| `worker/api.ts`, `admin.ts`                   | API routing, authorization checks, and admin operations                        |
| `worker/auth.ts`                              | Clerk session verification                                                     |
| `worker/db.ts`                                | Database row conversion, shared game writes, and atomic entry replacement      |
| `worker/nhl.ts`, `pwhl.ts`, `feeds.ts`        | League feed normalization and adapter selection                                |
| `worker/sync.ts`                              | Shared league schedule and result refreshes                                    |
| `worker/standings.ts`                         | Final score calculation and publication                                        |
| `migrations/`                                 | D1 schema and deadline triggers, applied in order                              |
| `tests/`                                      | Rules and Worker regression tests using the actual SQL migrations              |

## Rules and data flow

- First-time visitors see a compact how-to at the top of Picks. Choosing **Got it** hides it on future visits in that browser using the `hockey-pool-intro-dismissed` localStorage key; clear that key to show it again. If storage is blocked, dismissal lasts for the current page session. The full rules remain available in About.
- Each league has its own slate and deadline. NHL slates include only `gameType: 2`; PWHL slates use the discovered regular-season feed. Games must start Friday through Sunday in **America/New_York**. The next Friday is used on weekdays; Saturday and Sunday belong to the preceding Friday.
- Every game needs one winner and a unique confidence value from 1 through the game count. Choosing a number already assigned to another ranked game swaps the two numbers.
- Entries close at the earliest game start. Both the API and D1 triggers enforce the deadline. Entry replacement is a single database batch so a failed write preserves the previous entry.
- Submitted usernames are public immediately. Other players' picks require sign-in and remain hidden until the actual deadline, regardless of a weekend's status label.
- Only final winning picks earn points. Void games earn zero. Rankings publish after the deadline and once every frozen game is final or void; tied point totals share competition ranks (1, 1, 3).
- Each league has separate weekend and season standings. The **All leagues** season view sums finalized points from either league as they become available and shows each league's contribution. A player can appear after entering only one league. Entries made incomplete by a pre-lock schedule change must be updated before lock to qualify for standings.
- Admins can add/remove games before lock and correct/void results. Manual changes take precedence over the feed, and removed games stay excluded during later schedule refreshes.

The NHL adapter reads `schedule/{date}`, `score/{date}`, and `gamecenter/{id}/landing` from `https://api-web.nhle.com/v1/`. The PWHL adapter uses the [LeagueStat feed documented in the PWHL Data Reference](https://github.com/IsabelleLefebvre97/PWHL-Data-Reference) for seasons, schedules, teams, and results. It discovers regular-season IDs and uses the feed's offset-aware `GameDateISO8601` time. The PWHL pool begins with the 2026–27 regular season; older PWHL results are not imported. A 15-minute cron checks the current and next weekend for both leagues, refreshes open schedules around noon UTC, and updates pending results. Empty replacement feeds cannot erase an existing slate. Once locked, the slate is frozen; postponed/cancelled games and games moved outside that weekend are voided.

League tabs use the [NHL shield asset](https://assets.nhle.com/logos/nhl/svg/NHL_light.svg) and the [PWHL mark](https://commons.wikimedia.org/wiki/File:Professional_Women%27s_Hockey_League.svg). Their locally stored SVG copies are in `public/leagues/`.

The browser uses `/api/week`, `/api/weeks`, `/api/entrants`, `/api/standings`, and `/api/season` for public data. Endpoints accept `league=nhl|pwhl` and default to NHL for existing links; `/api/season` also accepts `league=all`. Entry and admin write bodies include `league` and also default to NHL for older clients. `/api/me`, `/api/entry`, and `/api/picks` require Clerk sessions. All `/api/admin/*` operations require the configured admin account. Game IDs in picks are internal IDs; `sourceId` holds the league feed's game ID. Game and entry models use camelCase; existing listing/public-pick response fields retain their SQL-style names for compatibility.

## Formatting and verification

```sh
npm run format       # Apply repository formatting
npm run check        # Formatting, TypeScript, tests, and production build
```

Individual checks: `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build`. TypeScript also rejects unused locals and parameters.

Worker tests run the real migrations and queries in an in-memory SQLite database through a small D1 adapter. Clerk and league network calls are mocked, so tests do not require credentials or mutate a deployed database. They cover entry replacement and deadline triggers, pick privacy, admin authorization, league isolation, migration preservation, schedule exclusions and overrides, result syncing, combined totals, and repeatable finalization. They do not replace checking the real Clerk flow in a configured local environment.

After UI changes, check desktop and mobile layouts, switch leagues, select and swap confidence numbers, submit and reload a preview entry, switch open/locked/final states, and visit Standings, Season, and About. Check the PWHL coming-soon state and combined season filter. Verify guest pick visibility after signing out. Keep responsive CSS in source order: later rules may intentionally refine an earlier breakpoint.

## Production

`wrangler.jsonc` identifies the `hockey-pool` D1 database, `hockey.mattkiazyk.com` custom domain, and 15-minute cron. Configure matching Clerk production keys and the admin user on the Worker. Ensure Clerk allows the production origin.

Before an authorized deployment, run the checks, apply any new D1 migrations to the remote database, and build with `VITE_CLERK_PUBLISHABLE_KEY` set to the production publishable key. Deploy with `npx wrangler deploy`. Build output lives under `dist/client` and `dist/weekend_hockey_pool`; it is generated and should not be edited or committed. Keep previously applied migrations unchanged; add a new numbered migration for schema changes.

See [AGENTS.md](AGENTS.md) for maintenance guidance.
