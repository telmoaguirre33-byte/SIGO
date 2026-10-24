# Initial unit correction, bidirectional candidate

Not installed in production. Supersedes the one-way PR103 candidate. Do not apply with db push.

## Included stage

Correct initial unit labeling between supported units, only when no retained sale, purchase, return, stock movement, purchase audit or AI confirmation history exists. Same product ID, unchanged stock and six numeric values. Operator explicitly confirms the numbers already mean the destination unit. There is no physical conversion or assumption that one unit equals one kilogram. Destination precision is enforced; fractional kg cannot become whole units by rounding.

A product may be corrected again while it still has no history. Each correction increments protected bigint unidad_revision. Audit is append-only per request and product revision. Exact request retry returns its original receipt even after another initial correction. Company, actor permissions, full-row snapshot, declaration, idempotency and history are checked transactionally. Archived products are not eligible.

Sales, manual purchases and ordinary product edits capture unit revision when selected/opened, not when submitting. Old or missing revision on a corrected product rejects, including unit→kg→unit ABA. Uncorrected legacy calls retain existing behavior. Returns and purchase reversals use the protected final historical unit: any commercial history prevents further initial correction. Existing seven RPC ACL remain unchanged.

## Explicit approval required before installation

- productos.unidad_revision bigint default 0, protected from ordinary update.
- Private schema with configuration, immutable audit and transaction-scoped capabilities. No client table/schema access.
- Four new public RPC: correction preview, correction commit, revision catalog and revision-aware product save wrapper. Candidates revoke client execution until approved. Catalog checks products.read; edit wrapper checks products.write plus existing underlying permissions; correction checks product/stock write and cost/price visibility.
- Seven existing function bodies adapted, same signatures and existing execute ACL. Original body hashes/ACL pinned for drift rejection.
- Product/history guards and transient-capability cleanup; no existing RLS policy or credential change.

Install all four candidate SQL parts atomically and grant/activate only after verification. Never merge visible UI with unavailable backend. Installation does not relabel a commercial product. Any actual product correction requires its exact identity, preview values and confirmation.

## Explicitly not included

Physical conversion with a factor, relabeling products with history, stock transfers, new/duplicate SKUs, fiscal changes, automatic real product edits. Historical conversion needs a separately designed versioned-unit flow and remains a proposal. AI purchase lacking a unit/revision contract rejects corrected products rather than guessing. No claim of live authenticated Supabase validation is made from synthetic tests.

## Rollback

Disable new corrections while retaining audit, revision and writer compatibility. After any correction do not remove guards or restore old RPCs that interpret stale units. Reversing initial labeling is another audited correction only if history is still absent, not deletion of the audit. No destructive automatic rollback.
