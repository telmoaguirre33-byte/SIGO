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
