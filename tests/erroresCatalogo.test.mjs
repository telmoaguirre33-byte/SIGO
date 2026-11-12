import assert from 'node:assert/strict';
import test from 'node:test';
import { errorCatalogo } from '../src/erroresCatalogo.ts';

test('search transport errors preserve the distinction between timeout, permissions, connection and server',()=>{
  for(const [cause,kind,message] of [
    [{code:'57014',message:'canceling statement due to statement timeout'},'timeout',/tiempo de espera/],
    [{code:'42501',message:'permission denied'},'permiso',/No tenés permiso/],
    [{code:'P0001',message:'FORBIDDEN'},'permiso',/empresa activa/],
    [new TypeError('Failed to fetch'),'conexion',/conexión/],
    [{code:'XX000',message:'database internal error'},'servidor',/servidor/],
  ]){const e=errorCatalogo(cause);assert.equal(e.tipo,kind);assert.match(e.message,message);assert.doesNotMatch(e.message,/no encontré|no existe/i);assert.equal(errorCatalogo(e),e);}
});
