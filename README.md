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

Completing the sign-in modal (including its sign-up flow) returns to the current league, week,
and view. Clerk navigation reloads an identical destination so the website automatically loads
the active account and its saved picks. `src/lib/auth-navigation.ts` owns this return behavior;
ordinary in-app navigation remains in `src/App.tsx`.

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

## Transactional email

Email Settings (`#email-settings`) is available to signed-in users. Each account has separate NHL,
PWHL, and NFL pick-reminder and recap switches; all six default on for new accounts.
Migration `0014_email_defaults_on.sql` enables all six
once for existing accounts; subsequent saved opt-outs persist through sign-ins and webhook updates.
The cron refreshes up to 25 older players missing email account state from Clerk per run, using
verified primary addresses and actual creation dates. No welcome or recap history is backfilled.
Only the verified primary Clerk address receives mail. Email addresses are private and never appear
in entrant or standings responses. Preview settings use browser-local
`hockey-pool-demo-email-settings-v1` storage and never call the email API or send mail.

- Welcome: once for accounts created at or after `EMAIL_LAUNCH_AT`, after primary-email verification.
  Explains confidence picks and deadlines, and that play is free with no betting, money, or prizes.
- Reminders: 9 a.m. America/New_York on Friday for NHL/PWHL and Thursday for NFL, for subscribers
  who need a complete entry while a nonempty slate is open. A delayed cron can catch up later that
  same day; delivery always rechecks the entry and deadline.
  After four successfully sent reminders without a complete entry, reminders pause for that
  league. Submitting a complete entry resets the count and resumes eligible reminders. Signing
  in or changing email switches does not reset it; welcome and recap emails are unaffected.
  Private `email_reminder_engagement.suppressed_at` marks current candidates for future
  re-engagement messaging. No re-engagement emails are sent yet. Failed and ambiguous sends do
  not count; the successful job transition and counter update are atomic.
- Recaps: the next 9 a.m. Eastern strictly after first standings publication. Recipients must have
  subscribed before publication, including users who did not enter. Show ranks 1–10 (including
  ties at tenth), plus the recipient’s lower-ranked result. Recipient lists and standings are
  snapshotted atomically with publication; corrections do not resend and historical weeks do not
  backfill. Disabling and re-enabling after publication does not restore eligibility for that recap.

All messages have HTML and plain-text alternatives and use **Weekly Pools <noreply@weeklypools.ca>**.
Every footer explains the settings controls and links to the signed-in settings page; replies are
not monitored. Welcome is a one-time account email, independent of the six switches.

`worker/email/store.ts` owns private account/preference persistence and recap snapshots;
`webhook.ts` verifies Clerk events; `templates.ts` renders email; `delivery.ts` schedules and sends.
The existing 15-minute cron runs email processing after schedule/results work, even if that work
fails. A run claims at most 25 jobs. Explicit rate/daily quota rejections retry with backoff (up to
six delivery attempts); reminder jobs expire at lock. Unknown provider outcomes and stale sending
claims are marked `review` to avoid automatically duplicating potentially accepted mail. Permanent
configuration/recipient rejections are `failed`; ineligible jobs are `skipped`. This does not provide
exactly-once delivery across D1 and Cloudflare. Preparation failures retry without contacting the
provider. Addresses and message bodies are not written to application logs.

`GET /api/email-settings` returns `{ email, verified, preferences }`; authenticated
`PUT /api/email-settings` accepts exactly `{ nhl: { reminder, recap }, pwhl: { reminder, recap },
nfl: { reminder, recap } }` with boolean values and updates only the caller.
`POST /api/webhooks/clerk` uses a verified Svix signature, independently of browser authentication.
Subscribe that endpoint to `user.created`, `user.updated`, and `user.deleted`. Events are deduplicated
and ordered by account update/event timestamps; permanent deletion tombstones prevent resurrection.
Authenticated account access also refreshes primary-email state without enabling optional mail.

### Email rollout (requires separate deployment authorization)

Production sending is enabled with the launch timestamp recorded below. Development example
configuration keeps sending disabled. To pause production, set `EMAIL_ENABLED=false` while
preserving the existing launch timestamp and delivery records.
Do not enable a remote email binding for local development. Wrangler simulates the native email
binding locally; unit tests mock delivery, Clerk, and feeds and use the real migrations.

1. Confirm access to [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)
   on Workers Paid. Onboard `weeklypools.ca` as a sending domain and verify the DNS records Cloudflare
   requests. Existing Clerk DNS and unrelated records must remain intact.
2. Configure the native `EMAIL` send binding, restricted to `noreply@weeklypools.ca`, as in
   `wrangler.jsonc`. Configure `CLERK_WEBHOOK_SIGNING_SECRET` as a Worker secret, never a `VITE_` value.
   Register `https://weeklypools.ca/api/webhooks/clerk` in the existing Clerk application.
3. Run the required checks on Node 24. Apply migrations `0011_email.sql` and
   `0012_reminder_engagement.sql` remotely and deploy only
   with explicit authorization. Leave sending disabled until setup and controlled tests pass.
4. Validate signed webhook delivery, a new verified test signup, all-off settings, opt-in/save/reload,
   opt-out suppression, and controlled HTML/plain-text inbox delivery. Local preview and mocked tests
   do not establish real Clerk webhook or Cloudflare deliverability.
5. Set `EMAIL_LAUNCH_AT` to the actual activation instant as a full UTC ISO timestamp and set
   `EMAIL_ENABLED=true`. Never backdate launch or bulk-enable preferences. Accounts created before
   launch do not receive welcome backfill, and jobs created before launch are not delivered.
6. Observe Worker logs and Cloudflare email logs for the first scheduled reminders/recaps. Inspect
   D1 `email_jobs` for `failed`/`review` statuses and provider `message_id`. Investigate ambiguous
   jobs in Cloudflare before any manual retry; never blindly reset review jobs to pending.

To stop sending, set `EMAIL_ENABLED=false`; preserve the launch timestamp and delivery records when
re-enabling. There is no automatic retry of review/failed jobs. Remote configuration, DNS, migrations,
real email testing, and deployment are not performed by local implementation checks.

### Production sender setup — September 30, 2026

The shared Cloudflare account already has Workers Paid. `weeklypools.ca` is onboarded for
Email Sending with Cloudflare-managed `cf-bounce` MX/SPF/DKIM and `_dmarc` records. Three
controlled HTML/plain-text examples sent through the production Email Sending API reached
the owner's Gmail inbox. This setup did not upgrade the account's plan.

The production Clerk instance now subscribes `https://weeklypools.ca/api/webhooks/clerk`
to `user.created`, `user.updated`, and `user.deleted`. Its signing secret is encrypted on the
Worker as `CLERK_WEBHOOK_SIGNING_SECRET`. An unsigned production request returned HTTP 400.
A real signed `user.created` event stored the controlled test account as verified in D1.
Authenticated production settings passed all-off defaults, opt-in/save/reload, and opt-out;
the test account was restored to all-off. The native structured Worker email binding also
accepted a controlled welcome example. Automated sending was enabled with
`EMAIL_LAUNCH_AT=2026-09-30T15:47:59.333Z`. Accounts created before this cutoff, including the
controlled test account, receive no welcome backfill. The password-based signup verification
screen was not exercised; the operator created the account through Clerk and testing used
Clerk's test-account impersonation session. No production picks or standings were changed.

### Email defaults update — October 1, 2026

Migration `0014_email_defaults_on.sql` was applied remotely and Worker version
`6847bc74-6f6d-4e10-a8c0-abf03d9f31b6` deployed. All six preferences start on for new accounts
and were enabled once for existing tracked accounts. The scheduled Clerk account refresh covers
older players without private email records. Later opt-outs remain saved. The original launch
cutoff and four-reminder pause per league are preserved; no historical messages are backfilled.
All 114 tests, API contract checks, formatting, typechecking, and builds passed. Fresh preview
defaults and saved opt-outs were checked in the browser, including mobile layout.

### Free example-email verification — September 29, 2026

Cloudflare Email Routing is enabled for `weeklypools.ca`, with its managed email DNS records,
and `mattkiazyk@gmail.com` is a verified account-level destination. The three sample welcome,
reminder, and recap messages were accepted by Cloudflare using the legacy MIME `EmailMessage`
API through an isolated temporary Worker with a remote email binding restricted to that address.
The temporary development session was stopped after sending. No paid plan upgrade, production
application deployment, remote D1 migration, or automated email activation was performed.

The structured REST sending API rejected this routing-only setup as `sending_disabled`; use the
verified-destination MIME route for these free examples. This test confirms provider acceptance,
not inbox placement. Check Gmail and spam for subjects beginning `[EXAMPLE]`. General user
emails still require the Email Sending rollout above. Explicitly requested real example sends
must remain isolated from the application's development preview and automated email pipeline.

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

## Native API

The versioned native API is configured for **https://api.weeklypools.ca/v1**. Its canonical
machine-readable contract is [`docs/api/openapi.yaml`](docs/api/openapi.yaml). Every change to
an API route, input/output, authentication requirement, or error behavior must update that
contract and its conformance tests. `npm run api:check` validates OpenAPI; `npm run check` also
runs route/response conformance and security regressions.

`worker/native/api.ts` owns native routing, protection, and delegation to the existing player
handlers in `worker/api.ts`; `worker/native/store.ts` owns approvals and device-key persistence;
`worker/native/http.ts` owns bounded JSON parsing and secure v1 errors. `worker/auth.ts` verifies
Clerk sessions. All native pool writes use the same rules and atomic `saveEntry` path as the
website, including opening/deadline database triggers and private pick visibility.

### Login and device provisioning

1. Log in using the **existing Weekly Pools Clerk instance** through a supported native SDK
   or Clerk-supported browser-based desktop flow. Clerk handles passwords, MFA, session
   refresh, and logout. This API does not implement password or token-refresh endpoints.
2. Your configured `ADMIN_CLERK_USER_ID` is implicitly approved and can obtain its first key
   immediately. Other users require approval through the admin endpoints below. Website
   access remains independent of native API approval.
3. Send `POST /v1/keys`, `Authorization: Bearer <Clerk session token>`, and
   `Content-Type: application/json`, with `{"label":"My iPhone"}`. Save the returned `secret`
   in Keychain, Android Keystore-backed storage, or the desktop platform's credential store.
   Keys are **per user/device**, not shared secrets embedded in a publicly distributed app.
4. Send `X-API-Key: <device secret>` for ordinary reads. Add a **matching owner's Clerk bearer
   session** for `/me`, `/entry`, `/picks`, and `/email-settings`. `/entry` supports GET and PUT;
   PUT replaces the complete entry, using internal game IDs and unique confidence numbers.
5. Use `GET /v1/keys` to list your key metadata. `POST /v1/keys/{id}/rotate` with `{}` returns
   a replacement secret once and immediately invalidates the old one. Securely replace the
   locally stored secret; concurrent rotations can return `409`. `DELETE /v1/keys/{id}` revokes
   the key. Keys have no automatic expiry. A lost rotation response requires creating another
   key through Clerk login or rotating again; there is no secret-recovery endpoint.

Key management uses Clerk bearer authentication and account approval; it does not require a
previous key. Only the configured admin may `GET /v1/admin/approvals`,
`PUT /v1/admin/approvals/{userId}` with `{}`, `DELETE /v1/admin/approvals/{userId}`, or
`DELETE /v1/admin/users/{userId}/keys`. Removing approval atomically revokes all keys;
reapproval never restores them. Deleted-account webhook tombstones also block key-only reads. The implicit admin approval cannot be removed through the API.
Admin key revocation alone preserves approval and allows replacement keys. Approval targets
are Clerk user IDs, not email addresses; approval can precede account creation.

The API controls approved accounts and credentials, **not app identity**. An approved user
could reuse their credentials in another client. Native v1 has no app attestation and exposes
no schedule/result administration or Clerk webhook routes. League icon paths refer to assets
on `https://weeklypools.ca`, not the API host.

### Security and errors

Native requests authenticate explicit bearer tokens only; cookies cannot substitute for a
session. Clerk verifies signatures and token lifetimes, and the issuer must match the configured
publishable key. Native tokens without `azp` are accepted; tokens with `azp` must match
`CLERK_NATIVE_AUTHORIZED_PARTIES` (comma-separated origins; production default
`https://weeklypools.ca`). Set development login origins explicitly in `.dev.vars`; never infer
trusted origins from request headers or the API hostname. Optional `CLERK_JWT_KEY` is the
matching Clerk JWT **public** PEM key for networkless verification.

Writes require JSON objects with `Content-Type: application/json`, limited to 64 KiB even
without Content-Length. All v1 responses are JSON with `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, and `X-Request-Id`. Errors are
`{"error":{"code":"...","message":"...","requestId":"..."}}`; clients should branch on status
and code, not message text. Unexpected errors are generic and logs exclude exception messages,
credentials, body contents, and private email addresses. The website also returns generic
unexpected errors. v1 does not enable CORS; native clients do not require CORS.

Cloudflare rate-limit bindings enforce **120 requests/minute/IP**, **120 reads/minute/user**,
**20 mutations/minute/user**, and an additional **5 key/approval operations/minute/user**.
User buckets span all device keys. `429` includes `Retry-After: 60`; clients should wait before
retrying. Missing/failed protection bindings return `503`. These are per-location, eventually
consistent abuse controls, not exact global quotas. Invalid requests still consume applicable
limits; avoid aggressive polling. The API host always runs the Worker before assets and returns
JSON `404` for unknown routes and `405` with `Allow` for unsupported methods.

### Native API rollout (requires separate authorization)

1. Run `npm run format` and `npm run check` using Node 24. Migration
   `0013_native_api.sql` follows the existing migrations and adds only native approvals/keys.
2. Confirm the configured admin Clerk ID, matching production Clerk keys, and trusted native
   login origins. Do not put secrets in browser variables. Keep email enablement unchanged.
3. When explicitly authorized, apply pending migrations remotely, build, and deploy the
   existing Worker. Wrangler adds `api.weeklypools.ca` as a custom domain, the `ASSETS` binding,
   Worker-first routing, and four rate-limit bindings with distinct namespace IDs 1001–1004.
   Verify those IDs do not conflict with other account rate-limit namespaces before deployment.
   All website requests now invoke the Worker, which delegates non-API website paths to ASSETS.
4. Verify DNS/TLS for `api.weeklypools.ca`, website assets and real existing-account login,
   actual native Clerk tokens on each target platform, first-key provisioning, key-only reads,
   matching-session saves/reloads, cross-user rejection, rotation/revocation, and JSON errors
   on `/`, unknown paths, and legacy `/api/*` paths. Verify rate-limit `429` responses and headers.
5. Monitor sanitized request IDs and HTTP status counts, particularly `401`, `403`, `429`, and
   `503`. Do not log Authorization or X-API-Key. No new email sending or schedule cron is added.

Local tests use real SQL migrations, signed test JWTs with real Clerk SDK verification, mocked
Clerk user lookup/feed access, and mock rate-limit bindings. They do not establish real native
login compatibility, DNS/TLS, or production limiter behavior. For local native requests use
`http://127.0.0.1:5173/v1/...`; website production and alternate Worker hosts do not expose v1.

### Native API production deployment — September 30, 2026

The native API is live at **https://api.weeklypools.ca/v1**. Application commit `8842c0e`
was pushed to `main` and deployed as Worker version `d089245b-cb48-4ea7-873e-f71e681f0c67`.
Migration `0013_native_api.sql` was applied to the existing production D1 database. Deployment
used a clean export of the committed source and the existing production Clerk publishable key;
unrelated local logo-concept deletions were excluded. Existing Clerk secrets, the admin account,
D1 identity, retained domains, and the single cron were preserved. Email remains disabled with
an empty launch timestamp. The rate-limit namespace IDs were unused before this deployment.

Node 24 formatting, TypeScript, OpenAPI validation, all 109 regression tests, and the production
build passed. Live verification confirmed API HTTPS, JSON `401` for missing credentials, `404`
for unknown/static/legacy paths, `405` with Allow, secure headers and request IDs, and `429` with
`Retry-After: 60`. Rate-limit verification used a persistent connection to one Cloudflare location;
requests distributed between locations count against separate limits. The website's public
APIs for all three leagues and combined season totals returned successfully. Desktop/mobile
browser rendering and navigation passed without detected browser errors; the production Clerk
sign-in dialog loaded successfully.

Authenticated native provisioning, rotation, and pick saving with actual platform-issued Clerk
sessions still need verification in the native clients. Production verification did not create
keys, alter player entries, or enable email sending; signed test JWTs exercised the real Clerk SDK
verification in the local regression suite.
