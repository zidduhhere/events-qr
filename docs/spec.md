# Dining operations requirements

Trusted local event network. All operational routes open directly. No staff authentication, accounts, passwords, roles, permission middleware, or staff sessions.

- Routes: `/` dashboard; `/participants` registration; `/participants/:id` details and guest tree; `/scan` dedicated scanner; `/settings` allowances, meal sessions and printing; `/reports` attendance, audit and exports.
- Every participant and guest has one opaque QR, name, phone, Platinum/Silver pass and optional parent. Editable pass lunch, dinner and total allowances; optional participant overrides. Independent guest allowances.
- Scanner: actual database sessions, remembered device selection, prominent selected session, explicit Start Camera, continuous phone camera, keyboard scanners, large audible results, name/pass/remaining allowance, duplicate suppression and clear connection failures. Never approve without server confirmation.
- Retries reuse request UUIDs. Uncertain outcomes block new scans. Concurrent requests cannot exceed session/type/total limits.
- Audit redemptions, allowance/participant changes, voids with reasons, and print attempts. Server timestamps and optional browser-stored device labels. Labels are unverified metadata, not staff identity.
- Preserve validation, parameterized SQL, atomic deductions and idempotency. Trusted HTTPS for phone cameras. Server-only secrets. Bind app for LAN, keep DB private, document no public exposure without access controls.
- OS print-dialog QR labels; no unsupported claims about silent printing or verified physical completion. Unattended printing needs a private server-side printer integration.
