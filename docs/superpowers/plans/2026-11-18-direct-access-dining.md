# Direct-access Dining Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** A SQLite-backed dining application with directly accessible operational pages and reliable meal deductions.

**Architecture:** Direct React pages consume a same-origin Node API. SQLite owns transactional redemption state and audit history. Browser state contains only session choice, unverified device label and unresolved request.

**Tech Stack:** React, TypeScript, Vite, Node HTTP, Node built-in SQLite, ZXing, QRCode, SQLite, Playwright, Node test runner.

**Spec:** `docs/spec.md`

## Global constraints

- No staff login, accounts, passwords, roles, authentication middleware or staff sessions in any phase or deliverable.
- Direct routes: `/`, `/participants`, `/participants/:id`, `/scan`, `/settings`, `/reports`.
- Never approve entry without server confirmation.
- Retain server-side validation, parameterized queries, atomic meal deductions, idempotent retries, session/type/total limits and concurrent-scan protection.
- Server timestamps, optional unverified device labels. Never claim history identifies who performed an action.
- Trusted HTTPS for phone cameras; database/printing secrets stay server-side.
- Trusted LAN only; public exposure requires added access controls.

## Review focus

- Response lost after commit: recover the same request after reload without a second deduction (Phases 2, 3, 5).
- Two gates scan final allowance concurrently: exactly one approval (Phases 2, 5).
- Session closure or allowance edit during scan: serialized writer transactions enforce a consistent outcome (Phases 2, 5).
- Camera denied or insecure LAN HTTP: actionable error and keyboard scanning remain available (Phases 3, 5).
- Cancelled print or arbitrary device labels: report attempts and unverified metadata, never verified identity or physical success (Phases 4, 5).

## File responsibilities

| Files | Responsibility |
| --- | --- |
| `server/schema.sql`, `server/db.ts`, `server/migrate.ts` | Schema, constraints, serialized SQLite connection and migration |
| `server/operations.ts` | Transactional registration, redemptions, voids, changes and audit |
| `server/app.ts`, `server/index.ts` | Validated API, deep links and LAN serving |
| `shared/types.ts` | API contracts |
| `src/lib/*` | Requests, device persistence, scan lifecycle |
| `src/pages/Scan.tsx` | Camera/keyboard scanning and retry interface |
| `src/pages/Participants.tsx`, `src/pages/Participant.tsx` | Registration, guest tree, QR printing |
| `src/pages/Dashboard.tsx`, `src/pages/Settings.tsx`, `src/pages/Reports.tsx` | Operational views |
| `src/App.tsx`, `src/components/*`, `src/index.css` | Navigation, direct routes, white canvas |
| `tests/*`, `playwright.config.ts` | Database and direct-route verification |
| `.env.example`, `Caddyfile`, `README.md` | SQLite file location and HTTPS deployment |

## Phase 1: Direct routes and database foundation

**Produces:** direct pages, SQLite schema and validated API errors.

- [ ] Create passes, participants/parents, sessions, redemptions, idempotency results, audit and label-settings tables. Nonnegative allowance constraints and database timestamps.
- [ ] Seed Platinum/Silver at 2 lunches, 2 dinners, total 4, with closed meal sessions; no fake attendance.
- [ ] Implement `createApp(pool): RequestListener` and `migrate(pool): Promise<void>`; SPA deep links without access gates. LAN application binding, local database file.
- [ ] Verify `/scan` immediately renders “Dining scanner” without redirects or access code. Verify every direct route.

## Phase 2: Registration and transaction-safe operations

**Produces:** registration, independent guest QRs, editable allowances, idempotent redemption, reasoned void APIs.

- [ ] Implement `redeem(pool, input): Promise<RedemptionResult>` with one leased connection with BEGIN IMMEDIATE. Reserve the writer before reading request UUID, session, participant and pass; enforce active session, per-person session limit, meal-type and total allowance. Commit result and audit together.
- [ ] Identical UUID retries return original result. Changed payload with same UUID returns 409. Serialized writer transactions protect concurrent scans.
- [ ] Implement validated participant creation/edit, pass allowance/session edits and `voidRedemption`. Audit before/after state. Require void reason; preserve original redemption. Parent links immutable after registration to prevent cycles.
- [ ] Test malformed → 400; unknown QR → denied; duplicate UUID → one redemption/same result; mismatched payload → 409; concurrent final entitlement → exactly one approval. Test independent session/type/total limits, closed sessions, void restoration and repeat void rejection.
- [ ] Run `npm test` against isolated temporary SQLite files. No role or permission-enforcement tests.

## Phase 3: Dedicated direct scanner

**Consumes:** `GET /api/sessions`, `POST /api/redemptions`, `RedemptionResult` contract.

**Produces:** database-backed continuous camera and keyboard scanner at `/scan`.

- [ ] Remember session ID and device label; prominently show selected session and current status. Validate stale/closed selection on the server.
- [ ] Start Camera requests permission; ZXing decodes continuously. Stop tracks on unmount/Stop Camera. Keyboard scanners submit on Enter, including when no field is focused.
- [ ] Suppress repeated detections, allow one unresolved request, persist `{requestId, qrToken, sessionId, deviceLabel}` before network send. Retry the exact object after failure/reload; block scans/session changes until resolved.
- [ ] Large audible confirmed approval/denial with name/pass/remaining lunch, dinner and total. Clear previous result while awaiting a new request. Connection failure is never approval.
- [ ] Browser tests: denied camera visible; keyboard Enter sends one request; repeated detections suppressed; network failure never approves; retry/reload reuses UUID; uncertain outcome blocks new scans.

## Phase 4: Dashboard, settings, reports and printing

**Produces:** database-backed dashboard, management, settings and reports.

- [ ] Actual registration/redemption counts, session progress, recent activity; explicit empty/disconnected states.
- [ ] Registration, edits, independent guest QR/tree, participant allowance overrides.
- [ ] Editable pass/session limits and status, label dimensions; before/after audit.
- [ ] Reports with attendance, audit, reasoned voids and CSV exports that neutralize spreadsheet formulas.
- [ ] Record print attempt before label/dialog request. Label uses database token/name/pass. Never claim verified physical output. No client printing secrets.
- [ ] Verify settings persistence, QR label, attempt history, export and unverified-device copy.

## Phase 5: Verification and event-network deployment

**Produces:** repeatable checks and deployment documentation.

- [ ] Run lint, build, SQLite integration and Playwright direct-route/scanner tests; report actual outcomes and environment limitations.
- [ ] Database outage → disconnected state; no mock approval or local-only allowance state. Verify secrets absent from client bundle.
- [ ] Document SQLite initialization, migrations, environment, backups, LAN binding, private DB, trusted HTTPS and phone certificates.
- [ ] Venue acceptance: real phones/cameras, Wi-Fi coverage, sound and physical label output. Automated checks cannot verify these.

Checkboxes denote verified deliverables, not promises of completion.

## SQLite implementation status

SQLite is the active runtime store. Startup initializes `data/events.db` automatically; no PostgreSQL credentials or Docker service are required. `pg` and `compose.yaml` remain solely for the optional one-time legacy import. Automated checks: 18 passing tests, production build and lint passed. Phone, browser and venue checks remain manual.
