import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Reviewed candidates, NOT permission to apply. No SQL execution in this module.
export const REVIEWED_MIGRATIONS = Object.freeze([
  Object.freeze({ version: '20261022024847', name: 'manual_medidas_atomicas', sha256: 'd525682cf0ac327221a389f4668748b40d6fd81e0a31b70c79e5b05a59312c21' }),
]);

function reject(code) { throw new Error(code); }

function validateRows(rows, source) {
  if (!Array.isArray(rows) || rows.length === 0) reject(`${source}_HISTORY_EMPTY_OR_INVALID`);
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.version !== 'string' || !/^\d{14}$/.test(row.version)
        || typeof row.name !== 'string' || !/^[A-Za-z0-9_]+$/.test(row.name)) reject(`${source}_INVALID_ENTRY`);
    if (seen.has(row.version)) reject(`${source}_DUPLICATE_VERSION`);
    seen.add(row.version);
  }
}

export function readLocalMigrations(root) {
  const dir = path.join(root, 'supabase', 'migrations');
  return fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
    const match = /^(\d{14})_([A-Za-z0-9_]+)\.sql$/.exec(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || !match) reject('LOCAL_UNEXPECTED_MIGRATION_FILE');
    return { version: match[1], name: match[2], sha256: createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex') };
  }).sort((a, b) => a.version.localeCompare(b.version));
}

export function assessMigrationHistory(local, envelope) {
  validateRows(local, 'LOCAL');
  if (envelope?.read_only !== true) reject('READ_ONLY_METADATA_REQUIRED');
  const remote = envelope.migrations;
  validateRows(remote, 'REMOTE');
  const localByVersion = new Map(local.map(row => [row.version, row]));
  const remoteByVersion = new Map(remote.map(row => [row.version, row]));
  for (const reviewed of REVIEWED_MIGRATIONS) {
    const actual = localByVersion.get(reviewed.version);
    if (!actual || actual.name !== reviewed.name || actual.sha256 !== reviewed.sha256) reject('REVIEWED_CANDIDATE_HASH_OR_NAME_MISMATCH');
  }
  const safeEntry = ({ version, name }) => ({ version, name });
  const pending = local.filter(row => !remoteByVersion.has(row.version));
  const remoteOnly = remote.filter(row => !localByVersion.has(row.version));
  const nameMismatch = local.filter(row => remoteByVersion.has(row.version) && remoteByVersion.get(row.version).name !== row.name)
    .map(row => ({ version: row.version, localName: row.name, remoteName: remoteByVersion.get(row.version).name }));
  const reviewedVersions = new Set(REVIEWED_MIGRATIONS.map(row => row.version));
  const reviewedPending = pending.filter(row => reviewedVersions.has(row.version));
  const unexpectedPending = pending.filter(row => !reviewedVersions.has(row.version));
  const drift = remoteOnly.length > 0 || nameMismatch.length > 0 || unexpectedPending.length > 0;
  return {
    status: drift ? 'BLOCKED_HISTORY_DRIFT' : pending.length ? 'BLOCKED_PENDING_EXPLICIT_APPLICATION' : 'HISTORY_ALIGNED_ONLY',
    exitCode: drift ? 2 : pending.length ? 3 : 0,
    localCount: local.length, remoteCount: remote.length,
    reviewedPending: reviewedPending.map(safeEntry), unexpectedPending: unexpectedPending.map(safeEntry),
    remoteOnly: remoteOnly.map(safeEntry), nameMismatch,
    productionAuthorized: false,
    note: 'Read-only metadata check. Never applies migrations, repairs history, changes Auth, or certifies backup/schema equivalence/fiscal readiness.',
  };
}

export function runPreflight(historyFile, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(historyFile, 'utf8')); }
  catch { reject('HISTORY_JSON_UNREADABLE_OR_INVALID'); }
  return assessMigrationHistory(readLocalMigrations(root), envelope);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) reject('EXPECTED_ONE_HISTORY_JSON_FILE');
    const result = runPreflight(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (result.exitCode) console.error(`::error title=Production preflight blocked::${result.status}. No automatic application or history repair is permitted.`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'PREFLIGHT_FAILED_CLOSED';
    console.error(`::error title=Production preflight failed closed::${code}`);
    process.exitCode = 1;
  }
}
