import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const repo = new URL('../src/', import.meta.url);
let Host;
async function loadHost() {
  if (Host) return Host;
  const temp = await mkdtemp(new URL('./.host-build-', import.meta.url).pathname);
  try {
    await build({ stdin: { contents: `import React from 'react'; import { useCorreccionUnidadInicial } from './useCorreccionUnidadInicial'; import Dialog from './DialogoCorreccionUnidadInicial'; export default function Host({ config, unit }) { const c = useCorreccionUnidadInicial(config); return <><button onClick={() => c.abrir('p')}>{c.pendiente('p') ? 'Recuperar pendiente' : unit ? 'Corregir unidad de carga inicial' : 'Sin acción'}</button>{c.error && <p role='alert'>{c.error}</p>}{c.controller && <Dialog controller={c.controller} onClose={c.cerrar}/>}</>; }`, resolveDir: repo.pathname, loader: 'tsx' }, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', outfile: temp+'/host.mjs' });
    Host = (await import(temp+'/host.mjs')).default; return Host;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
async function mountTest(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost/' });
  const oldWindow=globalThis.window, oldDocument=globalThis.document;
  globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const root=createRoot(document.getElementById('root'));
  try { await run({ root, dom, Host: await loadHost() }); }
  finally { await act(async()=>root.unmount()); dom.window.close(); globalThis.window=oldWindow; globalThis.document=oldDocument; delete globalThis.IS_REACT_ACT_ENVIRONMENT; }
}
const preview = { empresaId:'e', productoId:'p', nombre:'Producto', unidad:'unidad', unidadDestino:'kg', revision:'0', elegible:true, snapshot:'a'.repeat(64), valores:{stock_actual:10,stock_minimo:0,stock_maximo:null,precio_venta:50,costo_actual:40,costo_ultima_compra:40} };
const buttons=()=>[...document.querySelectorAll('button')];
const click=async text=>act(async()=>buttons().find(b=>b.textContent.includes(text)).click());
const choose=async()=>{ await act(async()=>{ const select=document.querySelector('select'); select.value='kg'; select.dispatchEvent(new window.Event('change',{bubbles:true})); }); await click('Verificar valores'); };
test('host + diálogo + RPC: recibo verificado refresca una vez y cierre libera navegación', async()=>mountTest(async({root,dom,Host})=>{
  const calls=[]; const blocks=[]; let refresh=0;
  const config={empresaId:'e',usuarioId:'u',permitido:true,storage:()=>dom.window.sessionStorage,onUpdated:()=>refresh++,onBlocked:b=>blocks.push(b),cliente:{rpc:async(name,args)=>{
    calls.push([name,args]); return {error:null,data:name.startsWith('previsualizar')?preview:{empresaId:'e',productoId:'p',requestId:args.p_request_id,snapshot:args.p_snapshot,unidad:'kg',revision:'1',valores:preview.valores}};
  }}};
  await act(async()=>root.render(React.createElement(Host,{config,unit:'unidad'})));
  await click('Corregir unidad'); await choose(); assert.equal(calls.length,1); assert.deepEqual(blocks,[true]);
  await act(async()=>document.querySelector('input').click()); await click('Corregir solamente');
  assert.equal(calls.length,2); assert.equal(refresh,1); assert.equal(dom.window.sessionStorage.length,0);
  assert.match(document.querySelector('[role="status"]').textContent,/Unidad corregida/);
  await click('Listo'); assert.deepEqual(blocks,[true,false]);
}));
test('host recarga incierta, aunque catálogo diga kg, recupera mismo payload sin preview/commit automático', async()=>mountTest(async({root,dom,Host})=>{
  const calls=[]; let fail=true;
  const config={empresaId:'e',usuarioId:'u',permitido:true,storage:()=>dom.window.sessionStorage,onUpdated:()=>{},onBlocked:()=>{},cliente:{rpc:async(name,args)=>{
    calls.push([name,args]); if(name.startsWith('previsualizar'))return {data:preview,error:null};
    if(fail)throw Error('timeout'); return {error:null,data:{empresaId:'e',productoId:'p',requestId:args.p_request_id,snapshot:args.p_snapshot,unidad:'kg',revision:'1',valores:preview.valores}};
  }}};
  await act(async()=>root.render(React.createElement(Host,{config,unit:'unidad',key:'before'})));
  await click('Corregir unidad'); await choose(); await act(async()=>document.querySelector('input').click()); await click('Corregir solamente');
  assert.equal(calls.length,2); assert.equal(dom.window.sessionStorage.length,1);
  await act(async()=>root.render(React.createElement(Host,{config,unit:'kg',key:'after'})));
  assert.equal(buttons()[0].textContent,'Recuperar pendiente'); assert.equal(calls.length,2);
  await click('Recuperar pendiente'); assert.equal(calls.length,2); fail=false;
  await click('Recuperar resultado'); assert.equal(calls.length,3); assert.deepEqual(calls[1],calls[2]);
}));
test('host guard de permiso revocado invalida diálogo antes de enviar', async()=>mountTest(async({root,dom,Host})=>{
  let calls=0; const config={empresaId:'e',usuarioId:'u',permitido:true,storage:()=>dom.window.sessionStorage,onUpdated:()=>{},onBlocked:()=>{},cliente:{rpc:async()=>{calls++;return {data:preview,error:null};}}};
  await act(async()=>root.render(React.createElement(Host,{config,unit:'unidad'}))); await click('Corregir unidad'); await choose();
  await act(async()=>root.render(React.createElement(Host,{config:{...config,permitido:false},unit:'unidad'})));
  assert.equal(document.querySelector('input'),null); assert.equal(calls,1); assert.match(document.querySelector('[role="alert"]').textContent,/Cambió la empresa/);
}));
test('SigoApp integra acción separada con permisos, key empresa y con guardado normal versionado', async()=>{
  const source=await readFile(new URL('SigoApp.tsx',repo),'utf8');
  assert.match(source,/key=\{empresa\.empresa_id\}/); assert.match(source,/can\(empresa\.rol, "costs.read"\)/);
  assert.match(source,/can\(empresa\.rol, "stock.write"\)/); assert.match(source,/supabase.auth.getUser\(\)/);
  assert.match(source,/Corregir unidad de carga inicial/); assert.match(source,/Recuperar corrección pendiente/);
  assert.match(source,/guardarProductoSigo\(/); assert.match(source,/onUpdated: \(\) => \{ setScanResult\(null\); void cargar\(\); \}/);
});
test('RPC no disponible muestra mensaje claro sin habilitar confirmación ni commit', async()=>mountTest(async({root,dom,Host})=>{
  let calls=0; const config={empresaId:'e',usuarioId:'u',permitido:true,storage:()=>dom.window.sessionStorage,onUpdated:()=>{},onBlocked:()=>{},cliente:{rpc:async()=>{calls++;return {data:null,error:{code:'PGRST202',message:'function missing'}};}}};
  await act(async()=>root.render(React.createElement(Host,{config,unit:'unidad'}))); await click('Corregir unidad'); await choose();
  assert.equal(calls,1); assert.equal(document.querySelector('input'),null);
  assert.match(document.querySelector('[role="alert"]').textContent,/todavía no está disponible/);
}));
