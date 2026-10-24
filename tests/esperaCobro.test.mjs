import assert from 'node:assert/strict';
import test from 'node:test';
import { esperarCobro, TiempoEsperaCobroError } from '../src/esperaCobro.ts';

test('deadline aborts the transport and settles even when work ignores abort', async () => {
  let signal;
  await assert.rejects(esperarCobro('preparacion', 5, s => {
    signal = s;
    return new Promise(() => {});
  }), e => e instanceof TiempoEsperaCobroError && e.fase === 'preparacion');
  assert.equal(signal.aborted, true);
});

test('a thenable request is consumed exactly once', async () => {
  let executions = 0;
  const result = await esperarCobro('envio', 1000, () => ({ then(resolve) { executions++; resolve('uuid'); } }));
  assert.equal(result, 'uuid'); assert.equal(executions, 1);
});

test('suspended timer cannot accept late success after wall-clock deadline', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let release, signal;
  try {
    const result = esperarCobro('envio', 25000, s => {
      signal = s;
      return new Promise(resolve => { release = resolve; });
    });
    await Promise.resolve();
    now += 25001;
    release('late-uuid');
    await assert.rejects(result, e => e instanceof TiempoEsperaCobroError && e.fase === 'envio');
    assert.equal(signal.aborted, true);
  } finally { Date.now = originalNow; }
});

test('expired work does not even begin if scheduling was delayed', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let calls = 0;
  try {
    const result = esperarCobro('envio', 25000, async () => { calls++; return 'uuid'; });
    now += 25001;
    await assert.rejects(result, TiempoEsperaCobroError);
    assert.equal(calls, 0);
  } finally { Date.now = originalNow; }
});
