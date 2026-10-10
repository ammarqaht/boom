# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**نبضة (Nabda)**: a live, in-hall team quiz game. Teams play at the same time, each against its own countdown ("pulse"). A correct answer adds time, a wrong one subtracts, and the first team whose clock hits zero ends the round for everyone. Between rounds teams buy cards with their points; the catalogue (10 cards, prices, limits) is `CARDS` in `server/game.js`, and the 3-card table in README.md is outdated. All UI and most code comments are Arabic, and the UI is RTL. README.md (Arabic) is the authoritative product and ops doc.

## Commands

Node >= 24 (`.node-version`). The server will not start without `DATABASE_URL` (PostgreSQL).

```bash
npm run db            # one-time/long-running: downloads a standalone Postgres, runs it on :55432, writes DATABASE_URL to .env
npm install           # server deps (root)
npm run build         # installs client deps and builds client/dist (tsc -b && vite build)
npm start             # server on :3000, serves client/dist
npm run dev           # server with --watch on :3000
npm run dev:client    # Vite on :5173, proxies /api and /socket.io to :3000
npm --prefix client run lint   # oxlint
```

Tests are plain Node scripts in `client/*.mjs` (no test framework; each prints ✅/❌). `npm test` runs them all in order and needs a running server on :3000 (`npm start` in another terminal) for `e2e`, `net` and `grace`. `memory-test` wipes the schema of the DB in `NABDA_TEST_DB` and refuses any DB whose name lacks "test":

```bash
NABDA_TEST_DB=postgres://nabda:nabda@localhost:55432/nabda_test npm test
cd client && node cards-test.mjs        # run a single test (run from client/: some resolve ../server via cwd)
```

`env-test`, `rules-test`, `cards-test`, `cards-rules-test`, `flags-test` import `server/*.js` directly and need no server. `NABDA_TEST_URL` points socket tests elsewhere.

Server source files contain Arabic text that makes grep treat them as binary; use `grep -a`.

## Architecture

- `server/index.js`: Express + Socket.IO in one process. Owns the 250 ms tick loop, all socket handlers (`admin:*`, `team:*`, `display:*`, `session:sync`, `feedback:*`), the owner REST API under `/api/console/*` (guarded by the `owner` middleware, key sent in `x-nabda-key`, matched against `NABDA_OWNER_KEY`), `/api/health`, `/api/live`, and the SPA fallback.
- `server/game.js`: pure game logic (rooms, clocks, scoring, cards, difficulty mix). The `CARDS` comment explains card pricing. Tests drive it directly with a controlled clock.
- `server/store.js`: PostgreSQL persistence (room history, live room snapshots every second for crash recovery, reports, feedback, question stats). Every function is async; a missing `await` silently writes nothing. BIGINT is parsed to Number on purpose.
- `server/banks.js`: question banks. **PostgreSQL is the source of truth**; `server/banks/*.json` are only a seed and a readable backup. `npm run pull-banks` pulls live banks into those files (see README).
- `server/intake.js` / `audit.js`: pending-question import (paste/CSV, templates in `templates/`) and question quality/duplicate checks.
- `server/env.js`: dependency-free `.env` reader, imported first in `index.js`.
- `client/`: React 19 + Vite + Tailwind v4 + react-router. Pages: `/` Home, `/play` (one device per team), `/display` (projector), `/admin` (organiser), `/console` Owner (sub-pages in `pages/console/`). `lib/socket.ts` is the shared socket, `lib/clock.ts` smooths server time locally.

Design invariants (do not break):
- **Server is the only authority for time and scores.** The browser only renders and interpolates.
- **The correct answer never leaves the server before the round ends.**
- **Live rooms live in process memory**, so production must run exactly **one instance** (no autoscaling/replicas) on a platform with persistent processes and WebSockets (not serverless). Idle rooms are swept after two hours.
- The container disk is ephemeral; anything that must persist goes to PostgreSQL.
- The Vite build emits `build.txt`; the server broadcasts it so stale clients reload between rounds.

## Deployment

Hosted on Cranl; **every push to `main` auto-deploys** and restarts the server, pausing any live round. `npm run live` checks whether anyone is playing (and whether more than one instance is running). `npm run hooks` installs `.githooks/pre-push`, which blocks pushes during a live round (`git push --no-verify` overrides).

Env vars: `DATABASE_URL` (required), `NABDA_OWNER_KEY` (owner console; random per boot if unset), `PORT`, `PGSSL=off` (local DB only). See `.env.example`.
