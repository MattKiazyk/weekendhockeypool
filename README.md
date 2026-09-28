# Weekend Hockey Pool

An NHL regular-season confidence pool for Friday–Sunday games. The site is built with React, Vite, a Cloudflare Worker, D1, and the existing Clerk **Hockey** application. Production is served at [hockey.mattkiazyk.com](https://hockey.mattkiazyk.com).

## Local preview

```sh
npm install
npm run db:migrate:local
npm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). Without Clerk keys, development mode shows a clearly marked interactive preview using the real October 2–4, 2026 NHL schedule. Demo picks are saved in that browser only. The yellow bar switches between open, locked, and final views. The live Worker API and local D1 are still available at `/api/*`.

To test the real Clerk flow locally, copy `.env.example` to `.env` and `.dev.vars.example` to `.dev.vars`, then set the development keys from the **hockey** Clerk application and the owner's Clerk user ID. The production Clerk Hockey instance requires a username during sign-up; enable the same setting in a separate development instance if needed. Existing accounts created before this setting was enabled can still set a username from the pick sheet. The publishable key may be in Vite; the secret key must remain only in Worker secrets. If the Clerk production instance uses a subdomain allowlist, add `hockey.mattkiazyk.com` before launch.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The NHL schedule and scores come from `api-web.nhle.com` using the endpoints listed in [Zmalski's NHL API reference](https://github.com/Zmalski/NHL-API-Reference). The Worker stores only regular-season (`gameType: 2`) matchups whose start times fall on Friday, Saturday, or Sunday in Eastern time. A 15-minute scheduled trigger refreshes results and finalizes a weekend when every frozen game is final or void. The admin page can add/remove games before lock and correct/void results.

## Production setup

The `hockey-pool` D1 database, Worker custom domain, 15-minute cron trigger, and Clerk production instance are configured. The Worker stores `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `ADMIN_CLERK_USER_ID` as secrets. The owner's verified production Clerk account has admin access. Future builds must set `VITE_CLERK_PUBLISHABLE_KEY` to the matching production publishable key before running `npm run build`, then run `wrangler deploy`. Do not commit Clerk secrets.
