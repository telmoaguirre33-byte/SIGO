import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REVIEWED_MIGRATIONS, readLocalMigrations, assessMigrationHistory } from './check-production-migrations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = readLocalMigrations(root);
const rows = value => value.map(({ version, name }) => ({ version, name }));
const envelope = migrations => ({ read_only: true, migrations });
const reviewedVersions = new Set(REVIEWED_MIGRATIONS.map(row => row.version));
const prior = rows(local.filter(row => !reviewedVersions.has(row.version)));
const drift = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/production-migration-drift.json'), 'utf8'));
const pending = new Set(drift.pending.map(row => row.version));
const observedRemote = [...rows(local.filter(row => !pending.has(row.version))), ...drift.remoteOnly];
const cli = path.join(root, 'scripts/check-production-migrations.mjs');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/supabase-production.yml'), 'utf8');
const verifier = path.join(root, 'scripts/verify-production-readiness.mjs');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigo-migration-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runCLI(t, value, raw = false) {
  const file = path.join(temporary(t), 'history.json');
  fs.writeFileSync(file, raw ? value : JSON.stringify(value));
  return spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
}

function verifierFixture(t, content) {
  const dir = temporary(t);
  for (const relative of [
    '.github/workflows/supabase-production.yml',
    'supabase/migrations/20260913012500_operational_readiness_stock_cost_guard.sql',
    'supabase/migrations/20260913183000_tenant_diagnostico_lint_fix.sql',
  ]) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, relative.endsWith('.yml') ? content : fs.readFileSync(path.join(root, relative)));
  }
  return spawnSync(process.execPath, [verifier], { cwd: dir, encoding: 'utf8' });
}

test('reviewed files match the immutable V4 hash; aligned history is not production authorization', () => {
  assert.equal(REVIEWED_MIGRATIONS.length, 1);
  const result = assessMigrationHistory(local, envelope(rows(local)));
  assert.equal(result.status, 'HISTORY_ALIGNED_ONLY');
  assert.equal(result.exitCode, 0);
  assert.equal(result.productionAuthorized, false);
});

test('only the reviewed V4 pending migration still block automatic activation', () => {
  const result = assessMigrationHistory(local, envelope(prior));
  assert.equal(result.exitCode, 3);
  assert.equal(result.status, 'BLOCKED_PENDING_EXPLICIT_APPLICATION');
  assert.equal(result.reviewedPending.length, 1);
  assert.deepEqual(result.unexpectedPending, []);
});

test('observed 99 local /107 remote metadata fails closed with 14 historical pending and 23 remote-only', () => {
  assert.equal(local.length, drift.localCount);
  assert.equal(observedRemote.length, drift.liveCount);
  const result = assessMigrationHistory(local, envelope(observedRemote));
  assert.equal(result.exitCode, 2);
  assert.equal(result.unexpectedPending.length, 14);
  assert.equal(result.remoteOnly.length, 23);
  assert.equal(result.reviewedPending.length, 1);
});

test('recording the new V4 ID cannot hide the remaining historical discrepancies', () => {
  const result = assessMigrationHistory(local, envelope([...observedRemote, ...rows(REVIEWED_MIGRATIONS)]));
  assert.equal(result.exitCode, 2);
  assert.equal(result.reviewedPending.length, 0);
  assert.equal(result.unexpectedPending.length, 14);
  assert.equal(result.remoteOnly.length, 23);
});

test('same migration name with a different timestamp is not proof of equivalence', () => {
  const remote = rows(local);
  remote[0] = { ...remote[0], version: '19990101000000' };
  const result = assessMigrationHistory(local, envelope(remote));
  assert.equal(result.exitCode, 2);
  assert.equal(result.remoteOnly.length, 1);
  assert.equal(result.unexpectedPending.length, 1);
});

test('same timestamp with a different name is rejected', () => {
  const remote = rows(local);
  remote[0].name += '_changed';
  assert.equal(assessMigrationHistory(local, envelope(remote)).nameMismatch.length, 1);
  assert.equal(assessMigrationHistory(local, envelope(remote)).exitCode, 2);
});

test('new unrelated local migration and unexpected remote migration are both rejected', () => {
  const extra = { version: '20270101000000', name: 'unreviewed' };
  assert.equal(assessMigrationHistory([...local, extra], envelope(rows(local))).exitCode, 2);
  assert.equal(assessMigrationHistory(local, envelope([...rows(local), extra])).exitCode, 2);
});

for (const candidate of REVIEWED_MIGRATIONS) {
  test(`changed bytes, missing file or changed name rejects reviewed ${candidate.version}`, () => {
    for (const replacement of [null, { ...candidate, sha256: '0'.repeat(64) }, { ...candidate, name: 'changed' }]) {
      const altered = local.filter(row => row.version !== candidate.version);
      if (replacement) altered.push(replacement);
      assert.throws(() => assessMigrationHistory(altered, envelope(rows(local))), /REVIEWED_CANDIDATE_HASH_OR_NAME_MISMATCH/);
    }
  });
}

for (const input of [null, {}, { read_only: false, migrations: rows(local) }, { read_only: 'true', migrations: rows(local) }, envelope(null), envelope([]), envelope({})]) {
  test(`missing or invalid read-only metadata fails: ${JSON.stringify(input)?.slice(0,70)}`, () => {
    assert.throws(() => assessMigrationHistory(local, input), /READ_ONLY_METADATA_REQUIRED|REMOTE_HISTORY_EMPTY_OR_INVALID/);
  });
}

test('duplicate versions on either side and malformed names/versions are rejected', () => {
  assert.throws(() => assessMigrationHistory([...local, local[0]], envelope(rows(local))), /LOCAL_DUPLICATE_VERSION/);
  assert.throws(() => assessMigrationHistory(local, envelope([...rows(local), rows(local)[0]])), /REMOTE_DUPLICATE_VERSION/);
  for (const invalid of [{ version: 20261022024847, name: 'x' }, { version: '20261022', name: 'x' }, { version: '20261022024847', name: null }, { version: '20261022024847', name: '\n::error' }]) {
    assert.throws(() => assessMigrationHistory(local, envelope([invalid])), /REMOTE_INVALID_ENTRY/);
  }
});

test('unrecognized filenames, subdirectories and symlinks cannot silently disappear from local inventory', t => {
  for (const kind of ['filename', 'directory', 'symlink']) {
    const dir = temporary(t);
    const migrations = path.join(dir, 'supabase/migrations');
    fs.mkdirSync(migrations, { recursive: true });
    if (kind === 'filename') fs.writeFileSync(path.join(migrations, 'ignored.sql'), '');
    if (kind === 'directory') fs.mkdirSync(path.join(migrations, 'nested'));
    if (kind === 'symlink') fs.symlinkSync('/does-not-exist', path.join(migrations, '20261022024847_link.sql'));
    assert.throws(() => readLocalMigrations(dir), /LOCAL_UNEXPECTED_MIGRATION_FILE/);
  }
});

test('actual CLI exits 0/2/3 and reports no production authorization', t => {
  for (const [remote, expected] of [[rows(local), 0], [observedRemote, 2], [prior, 3]]) {
    const result = runCLI(t, envelope(remote));
    assert.equal(result.status, expected, result.stderr);
    assert.equal(JSON.parse(result.stdout).productionAuthorized, false);
  }
});

test('malformed/truncated input and missing argv fail without echoing potentially sensitive content', t => {
  for (const raw of ['', '{', 'postgresql://not-a-real-secret@fixture.invalid']) {
    const result = runCLI(t, raw, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HISTORY_JSON_UNREADABLE_OR_INVALID/);
    assert.doesNotMatch(result.stdout + result.stderr, /not-a-real-secret/);
  }
  assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 1);
});

test('production verifier preserves read-only pipeline and all historical certification safeguards', t => {
  const result = verifierFixture(t, workflow);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate] of [
  ['db push', value => value + '\n# supabase db push --include-all\n'],
  ['history repair', value => value + '\n# supabase migration repair --status applied\n'],
  ['Auth write', value => value + '\n# curl -X PATCH /config/auth\n'],
  ['ignore failure', value => value + '\ncontinue-on-error: true\n'],
  ['remove explicit read-only transaction', value => value.replace('BEGIN READ ONLY;', 'BEGIN;')],
  ['remove server read-only default', value => value.replace('PGOPTIONS: -c default_transaction_read_only=on', 'PGOPTIONS: -c default_transaction_read_only=off')],
  ['remove full-history gate', value => value.replace('node scripts/check-production-migrations.mjs', 'echo no-check')],
  ['remove lint failure detection', value => value.replace('"level"[[:space:]]*:[[:space:]]*"error"', 'nothing')],
]) {
  test(`negative workflow mutation is rejected: ${name}`, t => {
    assert.notEqual(verifierFixture(t, mutate(workflow)).status, 0);
  });
}

test('connection shell reads only the fixed metadata query, and failure cannot leak a URL or use another configured endpoint', t => {
  const section = workflow.split('      - name: Resolve production database connection and read migration metadata\n')[1].split('\n      - name:')[0];
  const shell = section.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  for (const failure of [false, true]) {
    const dir = temporary(t);
    const bin = path.join(dir, 'psql');
    fs.writeFileSync(bin, `#!${process.execPath}\nconst fs = require('node:fs'); const sql=fs.readFileSync(0,'utf8');fs.writeFileSync(process.env.CAPTURE,JSON.stringify({sql,args:process.argv.slice(2),options:process.env.PGOPTIONS,url:process.env.PGDATABASE}));if(process.env.FAIL==='1'){console.error(process.env.PGDATABASE);process.exit(1)};console.log(JSON.stringify({read_only:true,migrations:[]}));\n`, { mode: 0o700 });
    const result = spawnSync('bash', ['-c', shell], { encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, GITHUB_ENV: path.join(dir,'env'), SIGO_DB_URL: 'postgresql://synthetic:do-not-log@db.fixture.invalid/postgres', SIGO_DB_URL_SOURCE: 'configured', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000', CAPTURE: path.join(dir,'capture.json'), FAIL: failure ? '1' : '0' } });
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /do-not-log/);
    const capture = JSON.parse(fs.readFileSync(path.join(dir,'capture.json'),'utf8'));
    assert.match(capture.sql, /^BEGIN READ ONLY;/);
    assert.match(capture.sql, /FROM supabase_migrations\.schema_migrations;/);
    assert.match(capture.sql, /ROLLBACK;/);
    assert.doesNotMatch(capture.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i);
    assert.match(capture.options, /default_transaction_read_only=on/);
    assert.ok(capture.args.includes('-X') && capture.args.includes('ON_ERROR_STOP=1'));
    assert.ok(!fs.existsSync(path.join(dir,'env')));
  }
});
