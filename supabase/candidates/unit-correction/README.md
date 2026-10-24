# Initial unit correction candidate

Draft only. These files are NOT production migrations, and CI never connects to a real Supabase project. Do not run `supabase db push` or apply this directory automatically.

## Scope

One-time `unidad` → `kg` correction of an active product with no recorded commercial history. Same product ID and unchanged numeric stock, minimum, maximum, price and costs. The operator explicitly confirms all displayed values already meant kilograms / currency per kilogram. This is not a physical conversion and does not assume one item weighs one kilogram.

The correction, immutable private audit and receipt are one transaction. Tenant/permissions, exact current-row snapshot, history and row lock are server-enforced. Existing ordinary unit-change guards remain. Sales, purchases and returns after a correction preserve kg. Legacy requests lacking an expected unit are rejected only for corrected products. A previous successful request is recovered by the same UUID and payload before checking the activation flag.

Private transaction-scoped capabilities are inaccessible to client roles. They are cleared before each adapted RPC returns and by a deferred cleanup safety net. No user-controlled session variable authorizes writes. History guards also serialize old writers waiting on a correction. `TRUNCATE` is rejected when corrections exist because it would erase the entire protected history without row triggers; it is not a general RLS/permission cleanup.

Two existing derived-price RPCs retain their formulas and authorization checks. They operate on current server-side costs/prices, not client per-unit replacement values. Their internal capability avoids breaking margin/rounding for corrected products.

## Explicit installation approval still required

- New private schema `sigo_correccion_inicial`, three private tables (configuration, audit, transient capabilities), RLS enabled with no client grants.
- Two public RPCs: preview and dedicated correction. Candidate revokes client execution; enabling requires narrowly granting `authenticated`, with product/stock/cost/price permissions checked internally. No anonymous access.
- Seven existing RPC bodies gain narrowly scoped checks: measured product save, sale V4, return, purchase confirmation/change, derived margin and rounding. Exact live body hashes and existing anon/authenticated execute bits are pinned and must remain unchanged. Two preexisting anonymous execute grants are deliberately preserved; auth.uid checks still reject unauthenticated callers. This PR does not perform unrelated permission cleanup.
- Row guards on products, five item/movement tables and two purchase audit/cache tables. Statement guards prevent wholesale truncation of protected data.
- No credentials, Auth configuration, existing table RLS policies, exports, backfills or commercial-record correction during installation.

A reviewed installer must verify exact live function bodies/ACLs and required schema first, bound lock/statement time, and install all parts atomically before granting/activating the new RPC. The current SQL files deliberately leave activation false. Never publish a working-looking UI before the backend is approved, installed and verified.

## Important limits

- The synthetic PostgreSQL fixture models roles and RLS with synthetic users. It is not a test of real Supabase Auth sessions or production data.
- Historical absence means no retained reference in items, movements, edited-purchase snapshots or AI confirmation records. Prior deletion before these guards existed cannot be disproved retroactively; operator declaration and targeted state review remain necessary.
- The AI purchase path does not yet carry an explicit unit contract and therefore rejects corrected products atomically rather than guessing a unit. Manual purchase is supported. No AI/scanner behavior is silently inferred or changed.
- SessionStorage preserves uncertain attempts across reloads of the same tab, not after every possible browser-storage loss. Server uniqueness prevents a second correction. A missing local receipt must be reconciled against the server, never worked around by changing stock or deleting the audit.
- No fiscal emission, physical print, production sale or commercial-row mutation is part of verification.

## Rollback

Before any correction, disable the new action/flag; do not leave UI enabled without its backend. After a correction or subsequent movement, keep audit, immutable-unit guards and writer compatibility. Never restore old SQL that reinterprets kg as units. Reversal of a mistaken correction requires a separately approved compensating operation and fresh absence-of-history review; there is no automatic destructive rollback.
