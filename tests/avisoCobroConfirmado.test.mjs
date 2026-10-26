import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avisoCobroConfirmado } from '../src/avisoCobroConfirmado.ts';

test('un diagnóstico sin evidencia no convierte un ACK confirmado en pendiente', () => {
  const aviso = avisoCobroConfirmado({ integridad: 'no_verificada', totalVerificado: null }, 100);
  assert.match(aviso.texto, /Venta confirmada/);
  assert.match(aviso.texto, /no está completa/);
  assert.doesNotMatch(aviso.texto, /pendiente|hasta revisar|stock verificado|caja bloqueada/i);
  assert.equal(aviso.requiereRevision, false);
});

test('una diferencia demostrada sigue siendo advertencia y no habilita repetir cobro', () => {
  const aviso = avisoCobroConfirmado({ integridad: 'revisar', totalVerificado: 100 }, 100);
  assert.equal(aviso.requiereRevision, true);
  assert.match(aviso.texto, /detectó una diferencia/);
  assert.match(aviso.texto, /no vuelvas a cobrar esta misma operación/);
});

test('total confirmado diferente se conserva y requiere revisión', () => {
  const aviso = avisoCobroConfirmado({ integridad: 'ok', totalVerificado: 120 }, 100);
  assert.equal(aviso.requiereRevision, true);
  assert.match(aviso.texto, /120/);
});

test('comprobación completa y total idéntico no producen cartel', () => {
  assert.deepEqual(avisoCobroConfirmado({ integridad: 'ok', totalVerificado: 100 }, 100), { texto: '', requiereRevision: false });
});

test('falta de total no fabrica una diferencia monetaria', () => {
  const aviso = avisoCobroConfirmado({ integridad: 'no_verificada', totalVerificado: null }, 19000);
  assert.equal(aviso.requiereRevision, false);
  assert.doesNotMatch(aviso.texto, /El precio cambió/);
});


test('comprobante caja y detalle verificados no generan un cartel por faltar el stock anterior', () => {
  const aviso = avisoCobroConfirmado({
    integridad: 'no_verificada', totalVerificado: 12000,
    integridadCabecera: 'ok', integridadCaja: 'ok', integridadDetalle: 'ok', integridadStock: 'no_verificada',
  }, 12000);
  assert.deepEqual(aviso, { texto: '', requiereRevision: false });
});

test('no se oculta un fallo al comprobar la caja', () => {
  const aviso = avisoCobroConfirmado({
    integridad: 'no_verificada', totalVerificado: 100,
    integridadCabecera: 'ok', integridadCaja: 'no_verificada', integridadDetalle: 'ok', integridadStock: 'no_verificada',
  }, 100);
  assert.match(aviso.texto, /comprobación adicional/);
  assert.equal(aviso.requiereRevision, false);
});

test('diferencia real del detalle o del stock conserva aviso de revisión', () => {
  for (const campo of ['integridadDetalle', 'integridadStock']) {
    const estados = { integridadCabecera: 'ok', integridadCaja: 'ok', integridadDetalle: 'ok', integridadStock: 'no_verificada' };
    estados[campo] = 'revisar';
    const aviso = avisoCobroConfirmado({
      integridad: 'revisar', totalVerificado: 100, ...estados,
    }, 100);
    assert.equal(aviso.requiereRevision, true);
    assert.match(aviso.texto, /detectó una diferencia/);
    assert.match(aviso.texto, /no vuelvas a cobrar/);
  }
});

test('una diferencia de total nunca se oculta aunque falte sólo la referencia de stock', () => {
  const aviso = avisoCobroConfirmado({
    integridad: 'no_verificada', totalVerificado: 125,
    integridadCabecera: 'ok', integridadCaja: 'ok', integridadDetalle: 'ok', integridadStock: 'no_verificada',
  }, 100);
  assert.equal(aviso.requiereRevision, true);
  assert.match(aviso.texto, /125/);
});
