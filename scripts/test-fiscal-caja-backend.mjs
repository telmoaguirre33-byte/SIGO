import assert from 'node:assert/strict';
import legacyEmitir from '../api/arca/cae.js';
import emitir from '../api/arca/cae-v2.js';
import recuperar from '../api/arca/comprobante.js';
import impresion from '../api/arca/impresion.js';
import { validarImpresionEmisor } from '../api/arca/lib/print-config.js';
const E = '11111111-1111-4111-8111-111111111111', V = '22222222-2222-4222-8222-222222222222', P = '33333333-3333-4333-8333-333333333333';
process.env.SUPABASE_URL = 'https://synthetic.invalid'; process.env.SUPABASE_ANON_KEY = 'synthetic-test-not-a-key';
const datosImpresion = { domicilio: 'Calle sintética 123', condicion_iva: 'RESPONSABLE MONOTRIBUTO', ingresos_brutos: 'No contribuyente', inicio_actividades: '2020-01-01', excepcion_inicio: null };
process.env.ARCA_FISCAL_SERVER_WRITE_ENABLED = 'true'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-server-key';
let state;
function reset(extra = {}) { state = { snapshot: true, row: null, issued: 0, last: 0, consult: 0, writes: [], reads: [], timeout: false, name: 'Empresa original', producto: 'Queso original', unidad: 'kg', fiscalDate: '20261021', printConfig: datosImpresion, canConfigure: true, storageSecure: true, saleId: V, ...extra }; }
const response = (x, status = 200) => new Response(JSON.stringify(x), { status });
const oldFetch = globalThis.fetch;
const realNow = performance.now.bind(performance);
let clockOffset = 0;
Object.defineProperty(performance, "now", { configurable: true, value: () => realNow() + clockOffset });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : null;
  if (u.pathname === '/rest/v1/rpc/arca_escritura_fiscal_segura') return response(state.storageSecure);
  if (u.pathname === '/auth/v1/user') { if(state.expireAuth) clockOffset += 27000; return response({ id: 'synthetic-user' }); }
  if (u.pathname === '/rest/v1/rpc/tiene_permiso_empresa') { if(state.slowPermissions) clockOffset += 5800; return response(body.p_permiso === 'arca.configure' ? state.canConfigure : true); }
  if (u.pathname.includes('/storage/v1/object/authenticated/')) return response({ version: 1, service: 'wsfe', ambiente: 'produccion', cuit: '30000000007', token: 'synthetic-token', sign: 'synthetic-sign', generationTime: new Date(Date.now() - 60_000).toISOString(), expirationTime: new Date(Date.now() + 3600_000).toISOString() });
  if (u.pathname.endsWith('/wsfe')) {
    assert.equal(method, 'POST');
    if (body.action === 'FECompUltimoAutorizado') { state.last++; return response({ ok: true, body: state.invalidLast ? '<Unexpected />' : '<CbteNro>41</CbteNro>' }); }
    if (body.action === 'FECAESolicitar') {
      state.issued++; state.issueSignal=init.signal; if(state.issueDeferred) await state.issueDeferred; state.fiscalDate = body.soap.match(/<ar:CbteFch>(\d{8})<\/ar:CbteFch>/)[1]; if(state.delayIssue) await new Promise(r=>setTimeout(r,state.delayIssue)); state.authorized = true; if(state.expireIssue) clockOffset += 25000; assert.match(body.soap, /<ar:CbteDesde>42<\/ar:CbteDesde>/); assert.match(body.soap, /<ar:ImpTotal>10.00<\/ar:ImpTotal>/);
      if (state.rejectConfirmed) {
        state.authorized=false; state.missingArca=!state.rejectConflict;
        return response({ok:true,body:`<FeCabResp><PtoVta>1</PtoVta><CbteTipo>11</CbteTipo><Resultado>R</Resultado></FeCabResp><FECAEDetResponse><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><CbteFch>${state.fiscalDate}</CbteFch><Resultado>R</Resultado><Observaciones><Obs><Code>10008</Code><Msg>Rechazo sintético</Msg></Obs></Observaciones></FECAEDetResponse>`});
      }
      if (state.timeout) { const e = new Error('synthetic timeout'); e.name = 'AbortError'; throw e; }
      return response({ ok: true, body: `<FeCabResp><PtoVta>${state.badIssueIdentity ? 2 : 1}</PtoVta><CbteTipo>11</CbteTipo><Resultado>A</Resultado></FeCabResp><FECAEDetResponse><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><CbteFch>${state.fiscalDate}</CbteFch><Resultado>A</Resultado><CAE>${state.badIssueCae || "12345678901234"}</CAE><CAEFchVto>${state.badIssueExpiry || "20261031"}</CAEFchVto></FECAEDetResponse>` });
    }
    if (body.action === 'FECompConsultar') {
      state.consult++; assert.match(body.soap, /<ar:CbteNro>42<\/ar:CbteNro>/);
      if(state.malformedConsult) return response({ok:true,body:'<html>Unexpected</html>'});
      if(state.authConsultFailure) return response({ok:true,body:'<Errors><Err><Code>601</Code><Msg>CUIT no incluida en token</Msg></Err></Errors>'});
      if (state.missingArca || (state.delayIssue && !state.authorized)) return response({ ok: true, body: '<Errors><Err><Code>602</Code><Msg>No existe</Msg></Err></Errors>' });
      const fields = { Resultado:'A', EmisionTipo:'CAE', PtoVta:1, CbteTipo:11, CbteDesde:42, CbteHasta:42, CodAutorizacion:'12345678901234', FchVto:'20261031', CbteFch:state.fiscalDate, DocTipo:state.docTipo || 99, DocNro:state.docNro || 0, ImpTotal:state.originalTotal || 10, ImpNeto:'10.00', ImpIVA:'0.00', MonId:'PES', MonCotiz:'1.00', ...state.badConsult };
      return response({ok:true,body:'<ResultGet>'+Object.entries(fields).filter(([,value])=>value!==null).map(([tag,value])=>`<${tag}>${value}</${tag}>`).join('')+'</ResultGet>'});
    }
    throw new Error('Unexpected SOAP action ' + body.action);
  }
  if (!u.pathname.startsWith('/rest/v1/')) throw new Error('Unexpected synthetic URL ' + url);
  if (method === 'GET') state.reads.push(u.pathname + u.search); else state.writes.push({ table: u.pathname, method, body });
  const table = u.pathname.split('/').pop();
  if (table === 'arca_impresion_config') { if(state.expirePrintConfig) clockOffset += 27000; if(method === 'POST') { state.printConfig = body; return response([body]); } return response(state.printConfig ? [state.printConfig] : []); }
  if (table === 'arca_config') return response([{ ambiente: 'produccion', cuit_emisor: '30000000007', razon_social: state.name, certificado_ref: 'synthetic', certificado_vence: '2028-12-31', wsaa_service: 'wsfe', wsfe_version: 'WSFEv1', activo: true, ultima_prueba_ok: true }]);
  if (table === 'ventas_sigo') return response([{ id: state.saleId, numero: 99, estado: 'confirmada', total: 10, cliente_id: null, anulada_at: null }]);
  if (table === 'venta_items_sigo') return response([{ producto_id: P, cantidad: .5, unidad_medida: state.unidad, precio_unitario: 20, subtotal: 10 }]);
  if (table === 'productos') return response([{ id: P, nombre: state.producto }]);
  if (table === 'arca_puntos_venta') return response([{ id: 'synthetic-pv', numero: 1 }]);
  if (table === 'arca_comprobantes') {
    if(method !== 'GET') assert.equal(init.headers.Authorization,'Bearer synthetic-test-server-key','receipt mutations must use server transport');
    if (u.searchParams.get('select') === 'impresion_snapshot') return state.snapshot ? response([]) : response({ code: '42703' }, 400);
    if (method === 'GET') { assert.equal(u.searchParams.get('empresa_id'), 'eq.' + E); assert.equal(u.searchParams.get('venta_id'), 'eq.' + state.saleId); return response(state.row && (!state.row.venta_id || state.row.venta_id===state.saleId) ? [state.row] : []); }
    if (method === 'POST') { if(state.row && state.row.numero_cbte != null) return response({code:'23505'},409); state.row = { id: '44444444-4444-4444-8444-444444444444', ...body }; if(state.expireReserve) clockOffset += 27000; return response([state.row]); }
    if (method === 'PATCH') { if(state.failPatch) return response({code:'synthetic'},500); Object.assign(state.row, body); if(state.expirePersist) clockOffset += 27000; return response([state.row]); }
  }
  throw new Error('Unexpected synthetic request ' + method + ' ' + url);
};
async function call(handler, method, body = null) {
  const result = { status: 0, body: null }; const res = { setHeader() { return this; }, status(n) { result.status = n; return this; }, send(s) { result.body = JSON.parse(s); return this; } };
  await handler({ method, headers: { authorization: 'Bearer synthetic-user-token' }, query: { empresaId: E, ventaId: state.saleId, puntoVenta: 1 }, body }, res); return result;
}
const input = { empresaId: E, ventaId: V, puntoVenta: 1, tipoCbte: 11, condicionIvaReceptorId: 5, flujoCaja: true, confirmacion: 'EMITIR_CAE_PRODUCCION' };
try {
  reset();
  let r = await call(emitir, 'POST', input); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(state.issued, 1);
  assert.equal(r.body.comprobanteImprimible.items[0].cantidad, .5); assert.equal(state.row.impresion_snapshot.cae, '12345678901234'); assert.equal(state.row.impresion_snapshot.items[0].unidad, 'kg');
  const snapshot = structuredClone(state.row.impresion_snapshot); state.name = 'Changed business'; state.producto = 'Changed product'; state.unidad = 'l';
  const writes = state.writes.length;
  r = await call(recuperar, 'GET'); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.fuente, 'snapshot'); assert.deepEqual(r.body.comprobante, snapshot);
  assert.equal(state.issued, 1); assert.equal(state.consult, 0); assert.equal(state.writes.length, writes);
  r = await call(emitir, 'POST', input); assert.equal(r.status, 200); assert.equal(r.body.alreadyIssued, true); assert.equal(state.issued, 1);
  console.log('PASS: one sale identity / one CAE; snapshot reprint remains original after catalog changes');
  const legacy = { ...state.row }; delete legacy.impresion_snapshot;
  reset({ snapshot: false });
  r = await call(emitir, 'POST', input); assert.equal(r.status,409); assert.equal(r.body.error,'ARCA_PRINT_SCHEMA_REQUIRED'); assert.equal(state.issued,0); assert.equal(state.writes.length,0);
  state.row = legacy;
  state.name = 'Current label'; state.producto = 'Current label';
  const before = state.writes.length;
  r = await call(recuperar, 'GET'); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.comprobante.fecha, '2026-10-21'); assert.equal(r.body.comprobante.receptorDocumento, '0'); assert.match(r.body.comprobante.advertencia, /catálogo actual/);
  assert.equal(state.issued, 0); assert.equal(state.consult, 1); assert.equal(state.writes.length, before); assert.ok(!state.reads.some(r => r.includes('clientes_sigo')));
  console.log('PASS: legacy canonical fields recover via FECompConsultar only; absent snapshot disclosed');
  reset({ timeout: true });
  r = await call(emitir, 'POST', input); assert.equal(r.status, 504); assert.equal(r.body.error, 'ARCA_TIMEOUT'); assert.equal(state.issued, 1);
  const timeoutWrites = state.writes.length; state.name = 'Changed after timeout'; state.producto = 'Changed after timeout';
  r = await call(recuperar, 'GET'); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.comprobante.cae, '12345678901234'); assert.equal(r.body.comprobante.emisorRazonSocial,'Empresa original'); assert.equal(r.body.comprobante.items[0].nombre,'Queso original'); assert.equal(state.issued, 1); assert.equal(state.writes.length, timeoutWrites);
  console.log('PASS: timeout recovery reads existing authorization without a second CAE or DB mutation');
  state.missingArca = true; r = await call(recuperar, 'GET'); assert.equal(r.status, 409); assert.equal(state.issued, 1);
  r = await call(recuperar, 'POST'); assert.equal(r.status, 405); assert.equal(state.issued, 1);
  assert.ok(state.writes.every(x => x.table.endsWith('/arca_comprobantes')));
  console.log('PASS: no sale/stock/product/config writes; failed recovery never emits');
  reset({ delayIssue: 30 });
  const simultaneous = await Promise.all([call(emitir, 'POST', input), call(emitir, 'POST', input)]);
  assert.equal(state.issued,1); assert.ok(simultaneous.some(x=>x.status===200)); assert.ok(simultaneous.some(x=>x.status===409));
  console.log('PASS: simultaneous backend requests compete for one reservation; one FECAESolicitar');
  reset({ failPatch: true });
  r = await call(emitir,'POST',input); assert.notEqual(r.status,200); assert.equal(state.issued,1); assert.ok(state.row.impresion_snapshot); assert.equal(state.row.cae,undefined);
  state.name='Changed after persistence failure'; state.producto='Changed after persistence failure';
  r = await call(recuperar,'GET'); assert.equal(r.status,200,JSON.stringify(r)); assert.equal(r.body.comprobante.emisorRazonSocial,'Empresa original'); assert.equal(r.body.comprobante.items[0].nombre,'Queso original');
  state.failPatch=false; r = await call(emitir,'POST',input); assert.equal(r.status,200,JSON.stringify(r)); assert.equal(r.body.reconciled,true); assert.equal(state.issued,1);
  console.log('PASS: authorized CAE + failed DB persistence recovers original reserved snapshot, never reissues');
  for (const mismatch of [{ docTipo:80,docNro:'30711111118' },{ originalTotal:99 }]) {
    reset({timeout:true}); await call(emitir,'POST',input); Object.assign(state,mismatch);
    r=await call(recuperar,'GET'); assert.equal(r.status,409,JSON.stringify(r));
    r=await call(emitir,'POST',input); assert.equal(r.status,409,JSON.stringify(r)); assert.equal(state.issued,1); assert.equal(state.row.cae,undefined);
  }
  console.log('PASS: reconciliation rejects unrelated recipient or amount despite same invoice number');
  reset({printConfig:null}); r=await call(emitir,'POST',input); assert.equal(r.status,409); assert.equal(r.body.error,'ARCA_PRINT_EMITTER_DATA_REQUIRED'); assert.equal(state.issued,0); assert.equal(state.writes.length,0);
  r=await call(impresion,'GET'); assert.equal(r.status,200); assert.equal(r.body.config,null); assert.equal(r.body.puedeConfigurar,true);
  state.canConfigure=false; r=await call(impresion,'POST',{empresaId:E,puntoVenta:1,datos:datosImpresion}); assert.equal(r.status,403); assert.equal(state.writes.length,0);
  state.canConfigure=true; r=await call(impresion,'POST',{empresaId:E,puntoVenta:1,datos:{...datosImpresion,cuit_emisor:'39999999999',razon_social:'FORGED'}}); assert.equal(r.status,200); assert.equal(state.printConfig.cuit_emisor,'30000000007'); assert.equal(state.printConfig.razon_social,undefined); assert.equal(state.issued,0);
  assert.deepEqual(validarImpresionEmisor({...datosImpresion,inicio_actividades:null,excepcion_inicio:'servicios_sin_local_atencion'}).faltantes,[]);
  assert.ok(validarImpresionEmisor({...datosImpresion,inicio_actividades:null}).faltantes.length); assert.ok(validarImpresionEmisor({...datosImpresion,inicio_actividades:'2026-02-30'}).faltantes.length);
  console.log('PASS: missing legal header blocks before ARCA; only admin configures print metadata, identity server-bound, explicit date exception');
  reset({storageSecure:false});r=await call(emitir,'POST',input);assert.equal(r.status,409);assert.equal(r.body.error,'ARCA_SECURE_STORAGE_REQUIRED');assert.equal(state.issued,0);assert.equal(state.writes.length,0);
  reset();delete process.env.SUPABASE_SERVICE_ROLE_KEY;r=await call(emitir,'POST',input);assert.equal(r.status,409);assert.equal(state.issued,0);process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-server-key';
  reset({row:{ id:'44444444-4444-4444-8444-444444444444',empresa_id:E,venta_id:V,punto_venta:1,tipo_cbte:11,numero_cbte:42,request_id:`sigo:${E}:${V}:1:11` }});r=await call(legacyEmitir,'POST',input);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.error,'ARCA_LEGACY_RECEIPT_IDENTITY_REQUIRED');assert.equal(r.body.retryable,false);assert.equal(state.issued,0);assert.equal(state.consult,0);
  state.storageSecure=false;r=await call(legacyEmitir,'POST',{...input,flujoCaja:undefined});assert.equal(r.status,409);assert.equal(r.body.error,'ARCA_SECURE_STORAGE_REQUIRED');
  console.log('PASS: missing secure writer/DB hardening blocks before ARCA; legacy uncertain reservation never reissues');
  const V2='55555555-5555-4555-8555-555555555555';
  reset({rejectConfirmed:true});r=await call(emitir,'POST',input);assert.equal(r.status,422,JSON.stringify(r));assert.equal(r.body.error,'ARCA_CAE_REJECTED_FINAL');assert.equal(state.row.numero_cbte,null);assert.equal(state.row.intentos_emision.length,1);assert.equal(state.row.intentos_emision[0].numero_intentado,42);const audit=structuredClone(state.row);
  r=await call(emitir,'POST',input);assert.equal(r.status,409);assert.equal(state.issued,1);assert.equal(state.row.numero_cbte,null);
  state.rejectConfirmed=false;state.saleId=V2;r=await call(emitir,'POST',{...input,ventaId:V2});assert.equal(r.status,200,JSON.stringify(r));assert.equal(state.issued,2);assert.equal(state.row.numero_cbte,42);assert.equal(audit.resultado,'rechazado_definitivo');
  reset({timeout:true});await call(emitir,'POST',input);state.timeout=false;state.saleId=V2;r=await call(emitir,'POST',{...input,ventaId:V2});assert.equal(r.status,409);assert.equal(state.issued,1);assert.equal(state.row.numero_cbte,42);
  reset({rejectConfirmed:true,rejectConflict:true});r=await call(emitir,'POST',input);assert.equal(r.status,422);assert.equal(state.row.numero_cbte,42);assert.notEqual(state.row.resultado,'rechazado_definitivo');
  console.log('PASS: matched definitive R + negative consultation + last-number proof frees only rejected number, retains audit; timeout/conflict never frees it');
  for(const problem of [{malformedConsult:true},{authConsultFailure:true}]) { reset({rejectConfirmed:true,...problem});r=await call(emitir,'POST',input);assert.equal(state.row.numero_cbte,42);assert.notEqual(state.row.resultado,'rechazado_definitivo');assert.equal(state.issued,1); }
  reset({invalidLast:true});r=await call(emitir,'POST',input);assert.notEqual(r.status,200);assert.equal(state.issued,0);assert.equal(state.row,null);
  console.log('PASS: malformed consultation, token error601 and missing last-number never prove absence or release reservations');
  const protocolCases = [
    ...['PtoVta','CbteTipo','CbteDesde','CbteHasta','EmisionTipo','MonId','MonCotiz','ImpTotal','ImpNeto','ImpIVA','CbteFch','FchVto','DocTipo','DocNro','Resultado'].map(tag=>({[tag]:null})),
    {PtoVta:2},{CbteTipo:6},{CbteDesde:41},{CbteHasta:43},{EmisionTipo:'CAEA'},{MonId:'DOL'},{MonCotiz:2},{MonCotiz:1.000001},{Resultado:'R'},
  ];
  for(const badConsult of protocolCases) {
    reset({timeout:true});await call(emitir,'POST',input);state.badConsult=badConsult;const writes=state.writes.length;
    r=await call(recuperar,'GET');assert.notEqual(r.status,200,JSON.stringify(badConsult));assert.equal(state.writes.length,writes);
    r=await call(emitir,'POST',input);assert.notEqual(r.status,200,JSON.stringify(badConsult));assert.equal(state.issued,1);assert.equal(state.row.cae,undefined);assert.equal(state.row.numero_cbte,42);assert.equal(state.writes.length,writes);
  }
  for(const badApproval of [{badIssueIdentity:true},{badIssueExpiry:'20261399'},{badIssueCae:'ABC12345678901234'}]) {
    reset(badApproval);r=await call(emitir,'POST',input);assert.notEqual(r.status,200);assert.equal(state.issued,1);assert.equal(state.row.cae,undefined);assert.equal(state.row.numero_cbte,42);
    r=await call(recuperar,'GET');assert.equal(r.status,200);assert.equal(state.issued,1);
  }
  console.log(`PASS: ${protocolCases.length} incomplete/mismatched SOAP identities, ranges, currency and CAEA responses rejected without writes or another CAE; mismatched approval preserves reservation`);

  reset({expireAuth:true}); r=await call(emitir,'POST',input);
  assert.equal(r.status,504); assert.equal(r.body.error,'ARCA_TIMEOUT'); assert.equal(r.body.retryable,false); assert.equal(r.body.consultaRequerida,false); assert.equal(state.writes.length,0); assert.equal(state.issued,0);
  reset({expirePrintConfig:true}); r=await call(emitir,'POST',input); assert.equal(r.status,504); assert.equal(r.body.error,'ARCA_TIMEOUT'); assert.equal(state.issued,0); assert.equal(state.writes.length,0);
  reset({slowPermissions:true}); r=await call(emitir,'POST',input);
  assert.equal(r.status,504); assert.equal(state.issued,0); assert.equal(state.writes.length,0); assert.equal(state.last,0);
  console.log('PASS: authentication and cumulative preparation consume one deadline; no reserve or CAE when remaining time is insufficient');
  reset({expireReserve:true,missingArca:true}); r=await call(emitir,'POST',input);
  assert.equal(r.status,504); assert.equal(r.body.consultaRequerida,true); assert.equal(r.body.retryable,false); assert.ok(state.row.impresion_snapshot); assert.equal(state.issued,0);
  state.expireReserve=false; r=await call(emitir,'POST',input);
  assert.equal(r.status,409); assert.equal(r.body.error,'ARCA_RECEIPT_PENDING'); assert.equal(state.issued,0); assert.equal(state.consult,1);
  console.log('PASS: response lost after reservation commit remains reserved; next request consults only and never emits');
  reset({expireIssue:true}); r=await call(emitir,'POST',input);
  assert.equal(r.status,504); assert.equal(r.body.retryable,false); assert.equal(r.body.consultaRequerida,true); assert.equal(state.issued,1); assert.equal(state.row.cae,undefined);
  state.expireIssue=false; r=await call(recuperar,'GET'); assert.equal(r.status,200,JSON.stringify(r)); assert.equal(state.issued,1); assert.equal(state.consult,1);
  console.log('PASS: deadline after upstream authorization preserves uncertain reservation; GET recovers canonical original without a second CAE');
  const realSetTimeout = globalThis.setTimeout;
  let releaseLate;
  reset({issueDeferred:new Promise(resolve=>{releaseLate=resolve;})});
  try {
    globalThis.setTimeout = (callback, ms, ...args) => realSetTimeout(callback, ms >= 5000 && ms <= 16000 ? 20 : ms, ...args);
    r=await call(emitir,'POST',input);
    assert.equal(r.status,504); assert.equal(r.body.consultaRequerida,true); assert.equal(r.body.retryable,false); assert.equal(state.issued,1); assert.equal(state.issueSignal.aborted,true);
    const writesBeforeLate=state.writes.length;
    releaseLate(); await new Promise(resolve=>realSetTimeout(resolve,30));
    assert.equal(state.authorized,true); assert.equal(state.row.cae,undefined); assert.equal(state.writes.length,writesBeforeLate); assert.equal(state.issued,1);
  } finally { globalThis.setTimeout = realSetTimeout; releaseLate(); }
  state.issueDeferred=null; r=await call(recuperar,'GET'); assert.equal(r.status,200); assert.equal(state.issued,1); assert.equal(state.consult,1);
  console.log('PASS: upstream authorization after ignored abort causes no late PATCH or second emission; explicit GET alone recovers it');
  reset({expirePersist:true}); r=await call(emitir,'POST',input);
  assert.equal(r.status,504); assert.equal(r.body.stage,'persistencia'); assert.equal(r.body.retryable,false); assert.equal(state.issued,1); assert.ok(state.row.cae);
  state.expirePersist=false; r=await call(recuperar,'GET'); assert.equal(r.status,200); assert.equal(r.body.fuente,'snapshot'); assert.equal(state.issued,1);
  console.log('PASS: response lost after authorized receipt commit is recovered by snapshot without another emission');
  reset({row:{id:'44444444-4444-4444-8444-444444444444',empresa_id:E,venta_id:V,punto_venta:1,tipo_cbte:11,numero_cbte:42,request_id:`sigo:${E}:${V}:1:11`}});
  r=await call(recuperar,'GET'); assert.equal(r.status,409); assert.equal(r.body.error,'ARCA_LEGACY_RECEIPT_IDENTITY_REQUIRED'); assert.equal(r.body.retryable,false); assert.equal(state.consult,0); assert.equal(state.issued,0); assert.equal(state.writes.length,0);
  console.log('PASS: legacy uncertain reservation lacking immutable issuer/environment is explicitly blocked, not reconstructed from current configuration');
} finally { globalThis.fetch = oldFetch; Object.defineProperty(performance, 'now', { configurable:true, value:realNow }); }
