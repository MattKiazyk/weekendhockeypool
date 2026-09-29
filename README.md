# Weekly Pools

Weekend confidence pools for NHL and PWHL Friday–Sunday games and official NFL regular-season weeks, built with React, Vite, a Cloudflare Worker, D1, and Clerk. Each person can submit one entry per league per pool week. The new canonical address is [weeklypools.ca](https://weeklypools.ca). The previous pool and hockey addresses will redirect there after domain and authentication verification.

## Local development

Use Node.js 24 LTS (`.nvmrc`) and npm. Node 22.13+ within the 22.x release line and Node 26+ are also supported; Node 25 is outside Vitest's supported versions.

```sh
nvm use
npm ci
npm run db:migrate:local
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:5173`. Without a Clerk publishable key, development shows interactive NHL and NFL previews using checked-in October 2026 fixtures; PWHL shows its coming-soon state. NHL includes nearby sample weekends. The yellow bar switches hockey between upcoming, open, locked, and final states, and NFL between open, locked, final, and offseason states. NHL entries use the legacy `hockey-pool-demo-entry` localStorage key for the main sample weekend and date-suffixed keys for nearby weekends; NFL uses `hockey-pool-demo-entry-nfl`. Clear the corresponding key to reset a preview. Preview mode never submits entries to D1.

For the real authentication flow, copy the configuration templates and fill in development credentials from the existing Clerk application (**Weekly Pools**, originally **Hockey**). Keep the same application and user IDs:

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

| Path                                             | Responsibility                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/main.tsx`                                   | Clerk and preview session adapters                                             |
| `src/App.tsx`                                    | Navigation, page composition, and action feedback                              |
| `src/components/`                                | Pick sheet, matchup controls, standings, admin forms, and shared page elements |
| `src/About.tsx`                                  | Public playbook and rules                                                      |
| `src/hooks/usePool.ts`                           | Loading, cancellation, deadline refresh, entrants polling, and saving          |
| `src/lib/pool.ts`                                | Shared types and pure pool rules used by both browser and Worker               |
| `src/lib/leagues.ts`                             | Supported league IDs and display metadata                                      |
| `src/lib/api.ts`                                 | Browser JSON requests and the pool data shape                                  |
| `src/lib/demo.ts`                                | Preview fixtures and validated browser storage                                 |
| `src/lib/format.ts`, `session.ts`, `views.ts`    | Display dates, session contract, and navigation metadata                       |
| `src/style.css`                                  | Shared styling and responsive rules                                            |
| `worker/index.ts`                                | Cloudflare fetch and scheduled entry points                                    |
| `worker/api.ts`, `admin.ts`                      | API routing, authorization checks, and admin operations                        |
| `worker/auth.ts`                                 | Clerk session verification                                                     |
| `worker/db.ts`                                   | Database row conversion, shared game writes, and atomic entry replacement      |
| `worker/nhl.ts`, `pwhl.ts`, `nfl.ts`, `feeds.ts` | League feed normalization and adapter selection                                |
| `worker/sync.ts`                                 | Shared league schedule and result refreshes                                    |
| `worker/standings.ts`                            | Final score calculation and publication                                        |
| `migrations/`                                    | D1 schema and deadline triggers, applied in order                              |
| `tests/`                                         | Rules and Worker regression tests using the actual SQL migrations              |

## Rules and data flow

- First-time visitors see a compact how-to at the top of Picks. Choosing **Got it** hides it on future visits in that browser using the `hockey-pool-intro-dismissed` localStorage key; clear that key to show it again. If storage is blocked, dismissal lasts for the current page session. The full rules remain available in About.
- Each league has its own slate and deadline. NHL slates include only `gameType: 2`; PWHL slates use the discovered regular-season feed. Both cover Friday through Sunday in **America/New_York**. The next Friday is used on weekdays; Saturday and Sunday belong to the preceding Friday. Matchups are visible early, while hockey picks open Monday at 8 a.m. Eastern. NFL slates use every game assigned to the official regular-season week, including games outside the usual Thursday–Monday window.
- Picks shows each team's regular-season record from its league's standings: NHL W–L–OTL, PWHL regulation W–OTW–OTL–regulation L, and NFL W–L–T. The existing 15-minute Worker cron saves a record snapshot for each open pick sheet at 7:30 a.m. America/New_York on every day from its opening date until its first-game deadline, including a weekend day if picks remain open. It skips a league when one of its pool games is live at that time; a game later that day does not block the refresh. Feed failures retain the last snapshot, and records stay frozen after the deadline. Older sheets without a saved snapshot show “Record unavailable” rather than a current record.
- An NFL week opens Tuesday at 8 a.m. **America/New_York** time (EDT or EST as applicable) and replaces the preceding week as the default sheet. Earlier weeks remain selectable. If NFL support starts after a week’s first kickoff, that week is not created as a results-only pool. After Week 18, the default NFL view shows an offseason message and past weeks remain available.
- League tabs show **OPEN** only when that league has a released slate that still accepts entries. The indicator disappears when its first game starts; unreleased NFL weeks never appear as open.
- Every game needs one winner and a unique confidence value from 1 through the game count. Choosing a number already assigned to another ranked game swaps the two numbers.
- Entries close at the earliest game start. Both the API and D1 triggers enforce the deadline and each league's opening time. Entry replacement is a single database batch so a failed write preserves the previous entry. Earlier entries remain on file during an upcoming period, while schedule corrections may remove displaced picks.
- Submitted usernames are public immediately. Other players' picks require sign-in and remain hidden until the actual deadline, regardless of a weekend's status label.
- Only final winning picks earn points. Void games earn zero. NFL ties are void, as are locked NFL games moved to another official week. Rankings publish after the deadline and once every frozen game is final or void; tied point totals share competition ranks (1, 1, 3).
- Each league has separate weekly and season standings. The **All leagues** season view sums finalized points from any of the three leagues and shows each contribution. NFL 2026 belongs to the shared 2026–27 pool season, while NFL views display the 2026 season year and official week number. A player can appear after entering only one league. Entries made incomplete by a pre-lock schedule change must be updated before lock to qualify for standings.
- Admins can add/remove games before lock and correct/void results. Manual changes take precedence over the feed, and removed games stay excluded during later schedule refreshes.

The NHL adapter reads `schedule/{date}`, `score/{date}`, and `gamecenter/{id}/landing` from `https://api-web.nhle.com/v1/`. The PWHL adapter uses the [LeagueStat feed documented in the PWHL Data Reference](https://github.com/IsabelleLefebvre97/PWHL-Data-Reference) for seasons, schedules, teams, and results. It discovers regular-season IDs and uses the feed's offset-aware `GameDateISO8601` time. The PWHL pool begins with the 2026–27 regular season; older PWHL results are not imported. The NFL adapter reads ESPN’s [weekly scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=4) and event summaries using the [community endpoint reference](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c) supplied for this feature. It uses ESPN's regular-season week calendar and event week number; earlier NFL weeks are not imported. A 15-minute cron checks the current and next hockey weekend, refreshes open hockey schedules around noon UTC, refreshes the active NFL slate, prefetches the next NFL week within seven days of release, and updates pending results. Empty replacement feeds cannot erase an existing slate. Once locked, the slate is frozen; postponed/cancelled games and games moved out of the selected pool week are voided.

League tabs use the [NHL shield asset](https://assets.nhle.com/logos/nhl/svg/NHL_light.svg), the [white PWHL lockup](https://res.cloudinary.com/pwhl-low/image/upload/PWHL_Logo_Lockup_White_z8mr75), and the [transparent NFL shield supplied by ESPN](https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png). Local copies are in `public/leagues/`.

The browser uses `/api/week`, `/api/weeks`, `/api/open-leagues`, `/api/entrants`, `/api/standings`, and `/api/season` for public data. `/api/open-leagues` returns league IDs with released, entry-accepting slates for the tab indicators. Other endpoints accept `league=nhl|pwhl|nfl` and default to NHL for existing links; `/api/season` also accepts `league=all`. Entry and admin write bodies include `league` and also default to NHL for older clients. `/api/me`, `/api/entry`, and `/api/picks` require Clerk sessions. All `/api/admin/*` operations require the configured admin account. Game IDs in picks are internal IDs; `sourceId` holds the league feed's game ID. Game and entry models use camelCase; NFL weeks add `weekNumber` and `opensAt`, and combined standings add `nflPoints`. Existing listing/public-pick response fields retain their SQL-style names for compatibility.

## Formatting and verification

```sh
npm run format       # Apply repository formatting
npm run check        # Formatting, TypeScript, tests, and production build
```

Individual checks: `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build`. TypeScript also rejects unused locals and parameters.

Worker tests run the real migrations and queries in an in-memory SQLite database through a small D1 adapter. Clerk and league network calls are mocked, so tests do not require credentials or mutate a deployed database. They cover entry replacement and opening/deadline triggers, pick privacy, admin authorization, league isolation, migration preservation, schedule exclusions and overrides, NFL week timing and ties, result syncing, combined totals, and repeatable finalization. They do not replace checking the real Clerk flow in a configured local environment.

After UI changes, check desktop and mobile layouts, switch leagues, select and swap confidence numbers, submit and reload NHL/NFL preview entries, switch open/locked/final states, and visit Standings, Season, and About. Check the PWHL coming-soon state, NFL past-week/offseason states, and three-league combined season filter. Verify guest pick visibility after signing out. Keep responsive CSS in source order: later rules may intentionally refine an earlier breakpoint.

## Production

`wrangler.jsonc` configures `weeklypools.ca` and the retained `pool.mattkiazyk.com` and `hockey.mattkiazyk.com` custom domains on the existing Worker, using the same D1 database and 15-minute cron. Configure matching Clerk production keys and the admin user on the Worker. Ensure Clerk allows the production origin.

The npm package is `weekend-pools`, but the following compatibility identifiers intentionally retain their old names:

- Worker: `weekend-hockey-pool`; keep its secrets, bindings, and single scheduled trigger.
- D1: `hockey-pool`, ID `2ac78f44-5754-4419-84a1-86667857b63a`, binding `DB`; keep the local migration command targeting that database.
- Browser storage: legacy `hockey-pool-demo-entry` and `hockey-pool-intro-dismissed`; NFL preview adds `hockey-pool-demo-entry-nfl`.
- GitHub repository: `MattKiazyk/weekendhockeypool`; the local checkout folder also stays unchanged.

The rebrand changes no API contracts, pool rules, data, or schema and requires no database migration. Browser storage belongs to each origin, so it does not transfer to the new hostname. The intro may reappear and users may need to sign in again; saved server entries remain attached to the same Clerk user IDs.

Before an authorized deployment, run the checks, apply any new D1 migrations to the remote database, and build with `VITE_CLERK_PUBLISHABLE_KEY` set to the production publishable key. Deploy with `npx wrangler deploy`. `public/.assetsignore` excludes Finder metadata from published assets. Build output lives under `dist/client` and `dist/weekend_hockey_pool`; it is generated and should not be edited or committed. Keep previously applied migrations unchanged; add a new numbered migration for schema changes.

### Weekly Pools domain cutover — September 29, 2026

The canonical domain is `https://weeklypools.ca` and the public brand is **Weekly Pools**. The production cutover is complete.

GoDaddy uses Cloudflare nameservers `kia.ns.cloudflare.com` and `robert.ns.cloudflare.com`; authoritative `.ca` and public DNS resolve the delegation. The Free-plan zone connects the apex to the existing Worker. Clerk's existing application was renamed and migrated in place to `weeklypools.ca`, preserving users and its secret. All five DNS-only CNAME records are verified, and Frontend API and account-portal certificates are issued. Application paths use the new domain.

Worker version `2a37b073-9f50-4c35-a1aa-ef366c02cf5f` is deployed with matching browser and Worker production publishable keys for `clerk.weeklypools.ca`. HTTPS, assets, all three league APIs, combined season totals, real existing-account sign-in, saved 23-game entry after reload, admin access, sign-out, and desktop/mobile rendering were verified. Sign-in updates the application without requiring a full page refresh. No database migration was needed.

The existing Google Analytics property and web stream are **Weekly Pools**, with stream URL `https://weeklypools.ca` and unchanged measurement ID `G-911GHGNZ8V`. The active **Weekly Pools legacy domains** Single Redirect sends both `pool.mattkiazyk.com` and `hockey.mattkiazyk.com` directly to the new domain with status 308. HTTP and HTTPS root, asset, API, and league links were verified to preserve paths and query strings. Sampled Worker API requests returned successful responses without exceptions; a post-cutover scheduled sync has not yet been observed.

The procedure below documents the cutover for future maintenance:

1. Add `weeklypools.ca` to the existing Cloudflare account and select the Free plan. Review imported DNS records and replace GoDaddy's nameservers with the exact pair assigned by Cloudflare. Wait for the zone to become active.
2. Update the existing Clerk application to **Weekly Pools** and migrate its production domain in place to `weeklypools.ca`, preserving all existing users. Follow [Clerk's domain migration instructions](https://clerk.com/docs/guides/development/deployment/changing-domains). Configure its requested DNS records, wait for DNS and TLS verification, and update application URLs and allowed origins. Use the new matching production publishable key for both `VITE_CLERK_PUBLISHABLE_KEY` in the build and `CLERK_PUBLISHABLE_KEY` on the Worker. Keep the existing secret and user IDs.
3. Run `npm run format` and `npm run check` with Node 24, then deploy the existing Worker with `npx wrangler deploy`. Retain `pool.mattkiazyk.com` and `hockey.mattkiazyk.com` as custom domains. No database migration is needed for this rebrand.
4. Verify the new domain's HTTPS, assets, APIs, desktop/mobile navigation, real existing-account sign-in/sign-out, saved entries, and admin access. Preview and mocked tests do not establish that production Clerk works.
5. In the `mattkiazyk.com` zone, update the existing legacy Single Redirect to target the new domain directly and include both old hosts. Preserve unrelated rules:

   | Setting               | Value                                                            |
   | --------------------- | ---------------------------------------------------------------- |
   | Name                  | Weekly Pools legacy domains                                      |
   | Match expression      | `(http.host in {"pool.mattkiazyk.com" "hockey.mattkiazyk.com"})` |
   | Redirect type         | Dynamic                                                          |
   | Target expression     | `concat("https://weeklypools.ca", http.request.uri.path)`        |
   | Status                | `308`                                                            |
   | Preserve query string | Enabled                                                          |

   Keep both old hosts proxied with TLS coverage. Enable this redirect only after the new domain and real Clerk flow pass verification. See [Cloudflare Single Redirect settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/).

6. Rename the existing Google Analytics property and web stream to **Weekly Pools**, change its website URL to `https://weeklypools.ca`, and preserve measurement ID `G-911GHGNZ8V` and historical data. Verify Realtime traffic.
7. Verify HTTP and HTTPS old links preserve paths and queries and redirect directly to the new host. Check `/`, `/logo-concepts/04-center-ice-roundel.png`, `/api/week?league=nhl`, and `/?league=pwhl`. Observe the next scheduled sync and check Worker authentication/API errors.

**Rollback:** Keep the new hostname operational after enabling permanent redirects, because browsers may cache them. Roll back code with the active Clerk publishable key and retain all custom domains. Do not redirect the new domain back to an old one.

### Previous deployment reference

The September 28 release used commit `d96b78f` and Worker version `1caa2b26-c0ee-4f8d-ac31-7696be9440af`. Clerk was migrated in place to `pool.mattkiazyk.com`; its Frontend API is `clerk.pool.mattkiazyk.com` and account portal is `accounts.pool.mattkiazyk.com`. Existing-account sign-in, saved entries, admin visibility, sign-out, APIs, and cron were verified. The hockey-domain 308 redirect was active. These are historical settings, not verification of the new domain.

See [AGENTS.md](AGENTS.md) for maintenance guidance.
