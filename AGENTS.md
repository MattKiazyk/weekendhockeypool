# Maintenance guidance

## Project map

This is a React/Vite frontend with a Cloudflare Worker, D1, and Clerk. Read `README.md` for setup, API behavior, and deployment details. No application router, state-management library, or ORM is needed for the current size of the project.

- Keep `src/App.tsx` focused on composing pages and handling navigation/feedback. Put view-specific state in `src/components/` and data loading/saving in `src/hooks/usePool.ts`.
- Keep the first-visit Picks guide and its browser-local dismissal in `src/components/PicksIntro.tsx`; keep it mounted across navigation so dismissal also works when storage is blocked.
- Put domain types and pure rules in `src/lib/pool.ts`; both browser and Worker import it. Keep it free of React, browser APIs, and Cloudflare bindings.
- Keep supported league IDs and display metadata in `src/lib/leagues.ts`. Each new league needs a Worker feed adapter registered in `worker/feeds.ts`.
- Keep demo fixtures/storage in `src/lib/demo.ts` and render preview and live data through the same components. Preview is development-only and must never write to the API.
- Reuse the request helpers in `src/lib/api.ts`, date formatting in `src/lib/format.ts`, and view metadata in `src/lib/views.ts`.
- Keep Worker lifecycle handlers in `worker/index.ts`, routing in `api.ts`/`admin.ts`, Clerk verification in `auth.ts`, persistence helpers in `db.ts`, feed mapping in `nhl.ts` and `pwhl.ts`, adapter selection in `feeds.ts`, syncing in `sync.ts`, and finalization in `standings.ts`.
- Use `upsertGame` for schedule/manual game writes and `saveEntry` for atomic entry replacement. Preserve existing API response field names unless deliberately migrating both sides.

## Invariants to preserve

- Weekend membership and display dates use Eastern time, including UTC dates that have already moved to Monday. NHL eligibility requires `gameType: 2`; PWHL eligibility requires a discovered regular season. The PWHL offset-aware game time takes precedence over its misleading UTC-suffixed time.
- Every weekend, entry, standing, exclusion, and manual correction is scoped to a league. Game feed IDs can overlap across leagues; picks use internal game IDs. One Clerk user may have one entry per league per weekend.
- A valid entry has every game exactly once and each confidence number 1–N exactly once. Confidence swaps preserve team selections.
- The earliest retained game determines lock time. A manual game override must determine its own start time even if the NHL feed still reports a different time for that ID.
- Enforce entry deadlines in both application logic and database triggers. Do not bypass or remove the triggers when refactoring writes.
- Public entrants contain usernames only. Revealed picks require authentication and `hasEntryDeadlinePassed`; a status label alone is insufficient.
- Admin authorization is checked in `worker/api.ts` before dispatching to `admin.ts`. Client visibility checks are not authorization.
- Frozen schedules cannot change. Feed refreshes must preserve manual overrides and exclusions and reject transient empty replacement slates.
- Finalization requires at least one game, every game final/void, and a passed deadline. Incomplete entries are excluded, ties share ranks, and recalculation replaces previous standings atomically. Combined season totals use only finalized league weekends and include players who entered either league.

## Editing and verification

Use the configured Prettier style: two-space indentation, single quotes, no semicolons, 100-character print width. Prefer small named helpers for repeated domain behavior; avoid generic layers for one-off markup or SQL. Remove obsolete code and CSS when replacing a path. Preserve CSS cascade order and check mobile layouts when changing selectors or breakpoints.

Run `npm run format` and `npm run check` before handing off changes. Use Node 24 from `.nvmrc`; tests rely on `node:sqlite`. Add focused regressions when changing pool rules, privacy, timing, persistence, or feed handling. `tests/helpers/database.ts` adapts only the D1 methods used by these tests; it runs the actual numbered SQL migrations. Mock Clerk/NHL calls rather than reaching external services from tests.

For UI changes, verify picks, confidence swapping, saving/reloading, open/locked/final states, guest access, and navigation in a local browser at desktop and mobile widths. Keep real Clerk integration limitations explicit when testing only preview mode or mocked authentication.

Do not modify applied migrations, generated build files, dependency directories, credential files, or unrelated user changes. Add new numbered migrations when needed. Keep `.env.example` and `.dev.vars.example` as placeholders; never put a Clerk secret in a `VITE_` variable. Deployment and remote database changes require an explicit request.

Update this file and the README whenever module ownership, setup, commands, or pool behavior changes.
