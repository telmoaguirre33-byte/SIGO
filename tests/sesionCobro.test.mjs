import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actualizarSesionCobro, cambioIdentidadCobro } from '../src/sesionCobro.ts';

const inicial = () => ({ conocida: false, usuario: null, cambio: false, epoca: 0 });

test('un evento sin sesión no inventa una identidad ni habilita el cobro', () => {
  for (const evento of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED']) {
    assert.deepEqual(actualizarSesionCobro(inicial(), evento, null), inicial());
  }
});

test('la primera identidad conocida puede llegar asincrónicamente por SIGNED_IN', () => {
  let sesion = actualizarSesionCobro(inicial(), 'INITIAL_SESSION', null);
  sesion = actualizarSesionCobro(sesion, 'SIGNED_IN', 'A');
  assert.deepEqual(sesion, { conocida: true, usuario: 'A', cambio: false, epoca: 0 });
});

test('refresh null y regreso del mismo usuario preservan contexto y época de cobro', () => {
  const original = actualizarSesionCobro(inicial(), 'INITIAL_SESSION', 'A');
  for (const evento of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
    const transitoria = actualizarSesionCobro(original, evento, null);
    assert.deepEqual(transitoria, original);
    assert.deepEqual(actualizarSesionCobro(transitoria, 'TOKEN_REFRESHED', 'A'), original);
    assert.equal(cambioIdentidadCobro('A', evento, null), false);
  }
});

test('cierre explícito y cambio real de usuario invalidan incluso con regreso a A', () => {
  const original = actualizarSesionCobro(inicial(), 'INITIAL_SESSION', 'A');
  for (const [evento, usuario] of [['SIGNED_OUT', null], ['SIGNED_IN', 'B']]) {
    const invalidada = actualizarSesionCobro(original, evento, usuario);
    assert.equal(invalidada.cambio, true);
    assert.equal(invalidada.epoca, 1);
    assert.equal(cambioIdentidadCobro('A', evento, usuario), true);
    assert.equal(actualizarSesionCobro(invalidada, 'SIGNED_IN', 'A').cambio, true);
  }
});
