// Issue 104: real post-build POS + ventas.ts in Chromium. Only service boundaries are synthetic.
// Run npm run build first. No credentials, production URLs, ARCA calls, or physical printing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = process.cwd();
const artifacts = process.env.COBRO104_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'sigo-cobro104-'));
await fs.mkdir(artifacts, { recursive: true });
await fs.access('dist/index.html'); // Explicitly requires the full production transforms/build first.
const E = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const origin = 'https://sigo-cobro104-qa.invalid/';
const mocks = {
  './supabase': 'export const supabase={auth:{onAuthStateChange(cb){window.__qa.authListeners.push(cb);cb("INITIAL_SESSION",{user:{id:"browser-synthetic-user"}});return {data:{subscription:{unsubscribe(){window.__qa.authListeners=window.__qa.authListeners.filter(listener=>listener!==cb)}}}};}},from:t=>window.__qa.query(t),rpc:(...a)=>{const p=window.__qa.rpc(...a);p.abortSignal=signal=>{window.__qa.signals.push({kind:"rpc",signal});return p};return p}};',
  './ticketVenta': 'export const imprimirTicketVenta=async(...a)=>window.__qa.prints.push(a);',
  './clientes': 'export const listarClientesSigo=async()=>[];',
  './productos': 'export const listarProductosSigo=async(e,signal)=>{if(signal){window.__qa.signals.push({kind:"stock",signal});if(window.__qa.mode==="stock"){window.__qa.mode="ok";return new Promise(resolve=>window.__qa.pending.push({resolve:()=>resolve(window.__qa.products(e))}));}}return window.__qa.products(e)};export const listarUnidadesProductoSigo=async(e)=>Object.fromEntries(window.__qa.products(e).map(p=>[p.id,p.unidad_medida]));export const guardarProductoSigo=async()=>{throw new Error("Product writes prohibited")};',
  './ofertasProductos': 'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;export const precioConOferta=(p,d)=>Math.round(p*(1-d/100)*100)/100;',
};
// This function is serialized into Chromium, not executed in Node/JSDOM.
function fixture() {
  const E = '11111111-1111-4111-8111-111111111111';
  const s = window.__qa = { calls:[], rows:[], prints:[], fiscal:[], blocked:[], pending:[], signals:[], authListeners:[], mode:'lost', empresa:E };
  s.products = empresa => ['unidad','kg','g','l','m'].map((u,i)=>({ id:`p-${u}`,empresa_id:empresa,nombre:`Sintetico ${u}`,codigo_interno:`QA${i}`,codigo_barras:`QA${i}`,precio_venta:20,stock_actual:1000-s.rows.filter(r=>r.empresa_id===empresa).flatMap(r=>r.items).filter(i=>i.producto_id===`p-${u}`).reduce((sum,i)=>sum+i.cantidad,0),activo:true,unidad_medida:u }));
  s.query = table => {
    const filters={}; let single=false;
    const q=new Proxy({}, {get(_t,name){
      if(name==='then') return (resolve,reject)=>Promise.resolve().then(()=>{
        if(table==='ventas_sigo'&&filters.idempotency_key&&s.mode==='preflight'){s.mode='ok';return new Promise(resolve=>s.pending.push({resolve:()=>resolve({data:[],error:null})}));}
        const rows=s.rows.filter(r=>r.empresa_id===filters.empresa_id);
        let data=[];
        if(table==='ventas_sigo') data=rows.filter(r=>(!filters.id||r.id===filters.id)&&(!filters.idempotency_key||r.idempotency_key===filters.idempotency_key));
        else if(table==='venta_items_sigo') data=rows.filter(r=>r.id===filters.venta_id).flatMap(r=>r.items);
        else if(table==='caja_movimientos_sigo') data=rows.map(r=>({venta_id:r.id,medio_pago:r.medio_pago,importe:r.total}));
        else if(table!=='cliente_movimientos_sigo') throw new Error('Unexpected table '+table);
        return {data:single?data[0]??null:data,error:null};
      }).then(resolve,reject);
      return (...a)=>{if(name==='abortSignal')s.signals.push({kind:'query',signal:a[0]});if(name==='eq')filters[a[0]]=a[1];if(name==='single'||name==='maybeSingle')single=true;return q;};
    }});return q;
  };
  s.rpc=async(name,p)=>{
    if(name==='buscar_producto_codigo_sigo') return {data:s.products(p.p_empresa_id).filter(x=>x.codigo_barras===p.p_codigo),error:null};
    if(name!=='confirmar_venta_sigo_v2')throw new Error('Unexpected RPC '+name);
    const saved=JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+p.p_empresa_id));
    if(saved?.estado!=='pendiente'||saved.payload.idempotencyKey!==p.p_idempotency_key)throw new Error('RPC without durable pending intent');
    s.calls.push(structuredClone(p));
    let row=s.rows.find(r=>r.empresa_id===p.p_empresa_id&&r.idempotency_key===p.p_idempotency_key);
    if(row&&row.fingerprint!==JSON.stringify(p))return {data:null,error:{code:'P0001',message:'IDEMPOTENCY_CONFLICT'}};
    if(!row){row={id:`22222222-2222-4222-8222-${String(s.rows.length+1).padStart(12,'0')}`,empresa_id:p.p_empresa_id,idempotency_key:p.p_idempotency_key,fingerprint:JSON.stringify(p),items:p.p_items.map(i=>({...i,precio_unitario:20,subtotal:Math.round(i.cantidad*20*100)/100})),numero:s.rows.length+1,medio_pago:p.p_medio_pago,cliente_id:p.p_cliente_id,created_at:'2026-10-24T00:00:00Z'};row.total=row.items.reduce((a,i)=>a+i.subtotal,0);s.rows.push(row);}
    const mode=s.mode;s.mode='ok';
    if(mode==='lost')throw new Error('Synthetic lost response AFTER COMMIT');
    if(mode==='hang')return new Promise((resolve,reject)=>s.pending.push({resolve:()=>resolve({data:row.id,error:null}),reject:()=>reject(new Error('Synthetic late rejection'))}));
    return {data:row.id,error:null};
  };
  window.fetch=async(...a)=>{s.blocked.push(['fetch',String(a[0])]);throw new Error('Network prohibited');};
  window.open=window.print=()=>{s.blocked.push(['external']);throw new Error('External/print prohibited');};
  for(const name of ['sigo:arca:venta','sigo:fiscal:caja'])window.addEventListener(name,e=>s.fiscal.push({name,detail:e.detail}));
}
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import POS from './src/VentaRapidaOperativa';(${fixture.toString()})();const root=createRoot(document.getElementById('root'));window.__qa.render=(empresa)=>{window.__qa.empresa=empresa;root.render(<React.StrictMode><POS empresaId={empresa}/></React.StrictMode>)};window.__qa.render('${E}');`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'synthetic'}:null);b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:mocks[a.path],resolveDir:root}));}}]});
const css=(await Promise.all(['index.css','caja-ventas.css','barcode-scanner.css'].map(f=>fs.readFile('src/'+f,'utf8')))).join('\n');
const html=`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="root"></div></body></html>`;
const sources={};for(const f of ['src/VentaRapidaOperativa.tsx','src/ventas.ts','src/intentoCobro.ts','src/esperaCobro.ts','src/productos.ts','dist/index.html'])sources[f]=createHash('sha256').update(await fs.readFile(f)).digest('hex');
const results=[];let browser,failure;const network=[],errors=[];
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:950},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    await context.route('**/*',route=>{if(route.request().url()===origin&&route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});network.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
    const snapshot=()=>page.evaluate(()=>({calls:__qa.calls,rows:__qa.rows,prints:__qa.prints,fiscal:__qa.fiscal,blocked:__qa.blocked,pending:__qa.pending.length,signals:__qa.signals.map(x=>({kind:x.kind,aborted:x.signal.aborted}))}));
    const attempt=()=>page.evaluate(e=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e)),E);
    async function start(mode='lost') {await page.goto(origin);await page.evaluate(()=>sessionStorage.clear());await page.addScriptTag({content:bundle.outputFiles[0].text});await page.locator('.barcode-entry-row input').waitFor();await page.evaluate(m=>__qa.mode=m,mode);}
    async function add(unit='kg',value='750'){
      const search=page.locator('.barcode-entry-row input');await search.fill('Sintetico '+unit);await page.locator('[data-pos-suggestion]').first().waitFor();await search.press('Enter');
      if(unit!=='unidad'){const qty=page.locator('#sigo-cantidad-medida');await qty.waitFor();await qty.fill(value);await qty.press('Enter');await qty.waitFor({state:'hidden'});}
      await page.locator('.sigo-pos-cart tbody tr').first().waitFor();
    }
    async function recover(){await page.locator('[data-recuperar-cobro]').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-recuperar-cobro]').disabled);await page.locator('[data-recuperar-cobro]').evaluate(el=>{el.click();el.click();el.click();});await page.waitForFunction(e=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e))?.estado==='confirmado',E);}
    async function check(name,run){try{await run();assert.deepEqual((await snapshot()).blocked,[]);}catch(e){await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-failure.png`),fullPage:true}).catch(()=>{});throw e;}results.push(`${mobile?'mobile':'desktop'}: ${name}`);console.log('PASS',results.at(-1));}
    await check('lost response, double click and F9–F12 preserve one intent; explicit recovery creates no duplicate or output',async()=>{
      await start();await add();await page.locator('.sigo-pos-action.cobrar').evaluate(el=>{el.click();el.click();});await page.waitForFunction(()=>__qa.calls.length===1);await page.waitForFunction(()=>!document.querySelector('[data-recuperar-cobro]').disabled);
      for(const key of ['F9','F10','F11','F12'])await page.keyboard.press(key);
      const before=await snapshot();assert.equal(before.calls.length,1);assert.equal(before.rows.length,1);assert.equal(before.prints.length+before.fiscal.length,0);
      const pending=await attempt();
      assert.equal(pending.estado,'pendiente');
      const reference=page.locator('details[data-referencia-cobro]');
      await reference.locator('summary').click();
      assert.equal(await reference.getAttribute('open'),'');
      const referenceText=await reference.innerText();
      assert.deepEqual(await reference.locator('dd').allTextContents(),[E,pending.payload.idempotencyKey,pending.fase,pending.creadoEn,String(pending.version)],'Reference exposes only company, original key, phase, creation time and record version');
      assert.ok(referenceText.includes(E),'Reference must identify the original company');
      assert.ok(referenceText.includes(pending.payload.idempotencyKey),'Reference must show the original idempotency key');
      assert.doesNotMatch(referenceText,/Sintetico|p-kg|efectivo|medioPago|clienteId|precio|subtotal|totalEsperado|payload|huella/i,'Technical reference must not expose commercial fields or the full saved payload');
      assert.equal(await reference.locator('input,textarea,button,a').count(),0,'Reference must be read-only, without mutation or external-sharing controls');
      assert.deepEqual(await attempt(),pending,'Opening reference must not change persisted intent');
      assert.deepEqual(await snapshot(),before,'Opening reference must not trigger RPC, writes, printing or fiscal output');
      await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-pending.png`),fullPage:true});await recover();
      const after=await snapshot();assert.equal(after.rows.length,1);assert.deepEqual(after.calls[1],before.calls[0]);assert.equal(after.prints.length+after.fiscal.length,0);
      await page.keyboard.press('F12');await page.waitForFunction(()=>__qa.prints.length===1);await page.keyboard.press('F11');await page.waitForFunction(()=>__qa.fiscal.length===1);const explicit=await snapshot();assert.equal(explicit.calls.length,2);assert.equal(explicit.fiscal[0].name,'sigo:arca:venta');assert.equal(explicit.fiscal[0].detail.empresaId,E);assert.equal(explicit.fiscal[0].detail.ventaId,after.rows[0].id);
    });
    await check('reload retains uncertain key and requires explicit recovery without automatic RPC',async()=>{
      await start();await add();await page.keyboard.press('F10');await page.waitForFunction(()=>__qa.calls.length===1);await page.waitForFunction(()=>!document.querySelector('[data-recuperar-cobro]').disabled);const before=await snapshot();const saved=await attempt();
      await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(s=>{__qa.rows=s.rows;__qa.calls=s.calls;__qa.mode='ok'},before);await page.locator('[data-recuperar-cobro]').waitFor();assert.deepEqual(await attempt(),saved);assert.equal((await snapshot()).calls.length,1);await recover();const after=await snapshot();assert.equal(after.rows.length,1);assert.deepEqual(after.calls[0],after.calls[1]);assert.equal(after.prints.length+after.fiscal.length,0);
    });
    for(const mode of ['preflight','stock'])await check(`${mode} timeout sends zero RPC and late completion cannot secretly charge`,async()=>{
      await start(mode);await add();await page.keyboard.press('F11');await page.waitForFunction(()=>__qa.pending.length===1);const original=(await attempt()).payload;
      await page.clock.fastForward(13000);await page.clock.resume();await page.waitForFunction(()=>!document.querySelector('[data-recuperar-cobro]').disabled);const blocked=await snapshot();assert.equal(blocked.calls.length,0);assert.equal(blocked.rows.length,0);assert.ok(blocked.signals.some(x=>x.kind===(mode==='stock'?'stock':'query')&&x.aborted));assert.equal((await attempt()).fase,'preparacion');
      await page.evaluate(()=>__qa.pending[0].resolve());await page.waitForTimeout(100);assert.equal((await snapshot()).calls.length,0);assert.deepEqual((await attempt()).payload,original);await recover();const after=await snapshot();assert.equal(after.calls.length,1);assert.equal(after.rows.length,1);assert.equal(after.calls[0].p_idempotency_key,original.idempotencyKey);assert.equal(after.prints.length+after.fiscal.length,0);
    });
    for(const [unit,input,expected] of [['unidad',null,1],['kg','750',.75],['g','750',750],['l','0.75',.75],['m','0.75',.75]])await check(`${unit}: exact base-unit payload survives lost response and recovery`,async()=>{
      await start();await add(unit,input);await page.keyboard.press('F9');await page.waitForFunction(()=>__qa.calls.length===1);await recover();const s=await snapshot();assert.equal(s.rows.length,1);assert.deepEqual(s.calls[0],s.calls[1]);assert.equal(s.calls[0].p_items[0].cantidad,expected);assert.equal(s.calls[0].p_items[0].unidad_medida,unit);assert.equal(s.fiscal.length+s.prints.length,0);
    });
    for(const late of ['resolve','reject'])await check(`timeout with late ${late} never auto emits/prints or overwrites recovered result`,async()=>{
      await start('hang');await add();await page.keyboard.press('F11');await page.waitForFunction(()=>__qa.pending.length===1);
      await page.clock.fastForward(120_000);await page.clock.resume();assert.ok((await snapshot()).signals.some(x=>x.kind==='rpc'&&x.aborted));await recover();const saved=await attempt();await page.evaluate(l=>__qa.pending[0][l](),late);await page.waitForTimeout(100);const s=await snapshot();assert.equal(s.rows.length,1);assert.deepEqual(await attempt(),saved);assert.equal(s.fiscal.length+s.prints.length,0);assert.deepEqual(s.calls[0],s.calls[1]);
    });
    await check('switch company during unresolved charge never applies old result or output to new tenant',async()=>{
      await start('hang');
      await add();
      await page.keyboard.press('F10');
      await page.waitForFunction(()=>__qa.pending.length===1);
      const previousKey=(await attempt()).payload.idempotencyKey;
      await page.evaluate(e=>__qa.render(e),OTHER);
      // The company effect clears the old cart and intent, but the shared busy
      // guard intentionally keeps the scanner hidden until the request settles.
      await page.waitForFunction(()=>document.querySelectorAll('.sigo-pos-cart tbody tr').length===0&&!document.querySelector('[data-recuperar-cobro]'));
      assert.equal(await page.locator('details[data-referencia-cobro]').count(),0,'Reference from the previous company must disappear');
      assert.ok(!(await page.locator('body').innerText()).includes(previousKey),'Old company key must not leak into the new company UI');
      assert.equal(await page.locator('.barcode-entry-row input').count(),0);
      assert.equal(await page.evaluate(e=>sessionStorage.getItem('sigo:intento-cobro:'+e),OTHER),null);
      await page.evaluate(()=>__qa.pending[0].resolve());
      await page.locator('.barcode-entry-row input').waitFor();
      const s=await snapshot();
      assert.equal(s.rows.length,1);
      assert.equal(s.prints.length+s.fiscal.length,0);
      assert.equal(await page.evaluate(e=>sessionStorage.getItem('sigo:intento-cobro:'+e),OTHER),null);
      assert.equal(await page.locator('.sigo-pos-action.reprint').isDisabled(),true);
      await page.evaluate(e=>__qa.render(e),E);
      // Wait for the original company's confirmed UUID to reach the rendered UI.
      await page.waitForFunction(()=>!document.querySelector('.sigo-pos-action.reprint').disabled);
      await page.keyboard.press('F12');
      await page.waitForFunction(()=>__qa.prints.length===1);
      assert.equal((await snapshot()).prints[0][0],E);
    });
    await check('transient null auth refresh preserves a confirmed ACK and allows the next sale',async()=>{
      await start('hang');await add();await page.keyboard.press('F9');await page.waitForFunction(()=>__qa.pending.length===1);
      await page.evaluate(()=>{for(const cb of __qa.authListeners.slice())cb('TOKEN_REFRESHED',null);for(const cb of __qa.authListeners.slice())cb('SIGNED_IN',{user:{id:'browser-synthetic-user'}});});
      await page.evaluate(()=>__qa.pending[0].resolve());
      await page.waitForFunction(e=>JSON.parse(sessionStorage.getItem('sigo:intento-cobro:'+e))?.estado==='confirmado',E);
      await page.waitForFunction(()=>!document.querySelector('[data-cobro-pendiente]'));
      await add();await page.keyboard.press('F9');await page.waitForFunction(()=>__qa.calls.length===2&&__qa.rows.length===2);
      const s=await snapshot();assert.equal(s.calls.length,2);assert.equal(s.rows.length,2);assert.notEqual(s.calls[0].p_idempotency_key,s.calls[1].p_idempotency_key);assert.deepEqual(s.blocked,[]);
    });
    assert.deepEqual((await snapshot()).blocked,[]);await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-recovered.png`),fullPage:true});await context.close();
  }
  assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
}catch(error){failure=error;}finally{await browser?.close();const summary={status:failure?(browser?'FAIL':'BLOCKED'):'PASS',syntheticOnly:true,realBrowser:Boolean(browser),mobileEmulation:true,physicalDevicesValidated:false,physicalPrinterValidated:false,productionValidated:false,sources,network,errors,cases:results,error:failure?.stack,artifacts};await fs.writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
if(failure)throw failure;
