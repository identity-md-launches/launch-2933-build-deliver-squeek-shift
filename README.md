# Squeek Shift

**Tiny hamster. Big adventure.** A Canvas platform arcade for the Squeekchain community. Live wheel telemetry changes the world and physics. Practice works without the API. English only; no account, wallet, contract or real payment.

## Install, run and export

Use Node.js 22 or newer and npm. From the repository root:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

To check and rebuild the production site:

```sh
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

`dist/` is the complete static playable export, supplied alongside the source and lockfile. Serve it over HTTP(S), rather than opening `index.html` as a file. Vite uses `base: './'`; runtime assets and share imagery use relative URLs, including under an IPFS gateway subpath. No backend or external font/image assets are needed. The only runtime service is the optional public live status API.

IMD assigns the public playable/IPFS URL, canonical job URL, source repository URL and submission commit after review/publication. These identifiers have not been supplied here and are intentionally not invented. This revision supplies the code artifact and rebuilt `dist/` for that handoff; it does not claim an existing public deployment or community approval.

## Play

- A run lasts **75 active seconds**, or until three hearts are lost. Difficulty rises every 15 seconds through five levels.
- **Space, Up or W** jumps; press again in the air to double-jump. **P** pauses/resumes. On touch screens, tap the scene or the large **Jump** button. Buttons and links retain normal keyboard activation.
- Avoid orange/red spikes, crates and dream-world floating orbs. A hit grants 1.8 seconds of invulnerability. Sound is optional and starts off.
- A gold pickup is worth **100 test coins**. Consecutive pickups build a score combo; score and test coins are different counters. Results retain the engine's best combo.
- Hidden pages and browser stalls over 250 ms pause the run. Help and Coin shop also pause a running game; closing a dialog leaves it paused until you explicitly resume. Pausing never charges an entry fee.
- Reduced motion freezes the ready-screen illustration, including parallax scrolling. Starting a run deliberately enables necessary gameplay movement.

## Test coins and device-local records

**Test coins only. No real payment.** There are no real-money prices, signatures, redemption, earnings promises or NFT rewards.

The first visit offers a deliberate **Claim 5,000 free coins** button. Claiming grants the gift once and does not start a run. The next action reads **Start run · 1,000 coins**. Each paid entry debits exactly 1,000 once. Insufficient funds open the shop, where **Simulate purchase** adds a 5,000 / 15,000 / 50,000 pack. A finished run credits its pickups once and updates its mode's records once. Live and Practice records stay separate; there is no global leaderboard.

The ledger uses `localStorage` key `squeek-shift:ledger:v1`. Stored JSON is untrusted and sanitized; this is not a secure paid economy or an authenticated balance. Claims, entries, purchase operations, finishes and transfers have guards against repeated calls. Balance, claim state and records survive reload when storage works. Clearing/editing browser data can reset/change them.

If the initial storage probe **or a later read/write fails**, the page uses its latest in-memory snapshot for the remainder of that tab. It never rereads an older stored balance after the failure. The Wallet notice says coins and records last only while that tab is open. Temporary changes are neither synchronized to other tabs nor restored after closing/reloading; previously persisted data remains unchanged on disk. Storage recovery does not silently replace the temporary snapshot.

### Reload, closed tabs and live-to-practice transfer

Every loaded page owns its run records through a fresh owner ID. Opening or closing another tab does not forfeit your run. On a normal reload/navigation/close, `pagehide` abandons **only that page's** unfinished runs: the entry remains spent, unfinished pickups are discarded and no record is saved. A page held in the browser's back/forward cache retains its paused run. If a crash prevents `pagehide`, its ledger record may remain marked active, but another page has a different owner and cannot finish or refund it. There is no unfinished-run restore or replay-credit path. Old ownerless active records likewise cannot be claimed by a new page.

When a live signal fails mid-run, gameplay pauses. A fresh reading plus an explicit Resume is required. Alternatively, **Switch to practice** atomically marks that live entry refunded once, discards its unfinished earnings and charges exactly one new practice entry. Balance is unchanged by the switch, so there is no additional net fee. The new practice run begins paused. Refunded/finished/abandoned or foreign-owned entries cannot be refunded again. If finishing is refused, results explicitly show **Coins not credited** and explain that no coins or personal bests were added.

## Official telemetry

The implementation follows the current [official API documentation](https://docs.squeekchain.com/developers/api/) and [v1 JSON Schema](https://docs.squeekchain.com/assets/api/status.json), checked against actual JSON on 2026-11-03. It fetches [GET /v1/status](https://api.squeekchain.com/v1/status) every 15 seconds with an 8-second timeout, without credentials or an API key. The data describes the official Sepolia installation.

`measurement.coreStatus` ACTIVE selects the faster day lab with normal gravity; IDLE selects the slower dream world with low gravity and different obstacles. COUNTER_FAULT is a failure, never a resting hamster. Speed is `measurement.rpmMilli / 1000`. Both `observedAt` and `receivedAt` must be valid date-time strings, no more than five seconds in the future. Schema v1 requires `staleAfterSeconds: 120`; a missing/different value is rejected. Freshness is evaluated from `receivedAt`, as documented, with `freshness: online`, `provenance: hardware` and `oracle.state: accepted` required for live readiness.

Only `builder.anchor.blockHeight` and `blockProgress / 1e9` are settled data; projections do not award bonuses. During uninterrupted live play, an observed height above the highest already seen grants a six-second coin magnet. Initial load, rollback/recovery to an already seen height, simulated/stale data, pauses and reconnect gaps do not award one. The first valid poll after a reset establishes the baseline.

HTTP-200 unavailable responses, malformed/unknown wheel data, stale/unvalidated readings, faults, timeouts and network errors disable live entry or pause an ongoing live run. The secondary telemetry card retains the last validated reading as clearly labelled history. **Practice · simulated** needs no API and swaps day/dream every 20 active seconds.

## Reproduce browser QA

The browser suite serves the actual `dist/` at a `/preview/` subpath and mocks the API per scenario. Playwright is deliberately an external QA tool, not a shipped dependency or vendored registry:

```sh
npm install --prefix /tmp/squeek-qa-tools playwright@1.64.1
PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-qa-browsers \
  /tmp/squeek-qa-tools/node_modules/.bin/playwright install chromium
npm run build
IMD_PLAYWRIGHT=/tmp/squeek-qa-tools/node_modules/playwright/index.mjs \
  PLAYWRIGHT_BROWSERS_PATH=/tmp/squeek-qa-browsers \
  node tests/e2e/browser.mjs
```

Optionally create a screenshot directory and pass its path as `SHOTS`. `BROWSER=webkit` runs the same suite in WebKit when that browser and its host libraries are available. The script closes its own server and browser when done. Tests may advance engine state through `window.__squeek` for deterministic finish/error scenarios; normal play does not use that hook. This is local game data, not an anti-cheat boundary.

## Actual revision results

Validated on 2026-11-03 against the rebuilt export:

| Check | Result |
| --- | --- |
| Production build and standalone TypeScript check | Passed |
| Unit tests (`npm test`) | **72/72 passed**, including 10 FPS timer/substeps, five levels, collision/invulnerability, seeded fairness, ledger and telemetry regressions |
| Chromium production browser suite | **138/138 passed** at 320×640, 390×844 touch and 1440×900 |
| Pinned taste@1 design probe | **16/16 passed**; no horizontal overflow, script errors or missing local resources at 320, 390 and 1440 |
| Actual official API in the browser | Fresh hardware IDLE accepted; dream scenery/physics, keyboard double-jump and pause checked; no console errors |
| WebKit | Attempted; launch blocked by missing system libraries, so its interaction checks were **not performed** |

The unit tests are in `tests/`; browser checks cover the primary controls, claim/debit/purchases, results/replay, mode-specific records, reload, late storage denial, two-tab ownership, rejected finishes, malformed/future telemetry, rollback/reconnect bonuses, offline transfer, modal pausing and reduced-motion canvas pixels. The seeded fairness bot is useful evidence for generated patterns, not a proof of every possible human input sequence.

In this restricted revision run, package installation/build/unit checks ran in a temporary mirror outside the repository to avoid touching its `node_modules/`; the resulting export was copied back and byte-checked. Browser/taste checks exercised that same export. No package cache or dependency directory is delivered. See [validation and limitations](artifacts/validation.md), [design system](DESIGN.md), [finding responses](.imd-responses.json) and [QA evidence](artifacts/qa/).
