// Actual Productos/POS/products API, synthetic service boundaries only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const artifact='artifacts/catalogo121'; await fs.mkdir(artifact,{recursive:true});
const origin='https://sigo-catalogo121.invalid/';
const mocks={
 './supabase': `export const supabase={auth:{onAuthStateChange(cb){cb('INITIAL_SESSION',{user:{id:'qa-operator'}});return {data:{subscription:{unsubscribe(){}}}}}},
 rpc(name,args){let signal;const q={abortSignal(s){signal=s;return q},then(ok,fail){return window.__qa.rpc(name,args,signal).then(ok,fail)}};return q},from(){throw Error('Unexpected DB read')}};`,
 './clientes': 'export const listarClientesSigo=async()=>[];',
 './modulosEmpresa': 'export const listarModulosEmpresa=async()=>[];',
 './ofertasProductos': 'export const listarOfertasProductos=async()=>[];export const ofertaVigente=()=>null;export const precioConOferta=p=>p;export const guardarOfertasProductos=async()=>{throw Error("Forbidden")};export const hoyArgentina=()=>"2026-11-12";',
 './GuardarCompraIA': 'export default function GuardarCompraIA(){return null}',
 './ventas': `export class VentaRechazadaSinCambiosError extends Error{};export const listarVentasRecientesSigo=async()=>[];
 export async function confirmarVentaSigo(input){window.__qa.confirms.push(structuredClone(input));for(const i of input.items)window.__qa.products.find(p=>p.id===i.productoId).stock_actual-=i.cantidad;return {ventaId:'22222222-2222-4222-8222-222222222222',verificacion:Promise.resolve({integridad:'ok',totalVerificado:input.items.reduce((s,i)=>s+Math.round(i.cantidad*window.__qa.products.find(p=>p.id===i.productoId).precio_venta*100),0)/100})}}`,
 './ticketVenta': 'export const imprimirTicketVenta=async(...args)=>window.__qa.prints.push(args);',
};
function fixture(){
 const E='11111111-1111-4111-8111-111111111111',O='33333333-3333-4333-8333-333333333333';
 const normal=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const examples={19001:['TORNILLO acero galvanizado','Ferretería','unidad'],19002:['ARROZ integral bolsa','Supermercado','unidad'],19003:['CUADERNO rayado A4','Librería','unidad'],19004:['CARNE picada especial','Carnicería','kg'],19005:['TOMATE perita fresco','Verdulería','kg'],19006:['QUESO cremoso feteado','Fiambrería','kg'],19007:['DETERGENTE limón','Limpieza','l']};
 const qa=window.__qa={E,O,empresa:E,requests:[],confirms:[],prints:[],fiscal:[],forbidden:[],failNext:false,delay:0,products:[]};
 for(const empresa_id of [E,O])for(let i=1;i<=20000;i++)qa.products.push({id:empresa_id+':'+i,empresa_id,nombre:i===14999?'ACOPLE RÁPIDO PROFESIONAL':i>=14000&&i<14120?'ENCHUFE '+i:'Producto '+String(i).padStart(5,'0'),marca:'MARCAQA',codigo_interno:'INT-'+i,codigo_barras:'779'+String(i).padStart(10,'0'),precio_venta:i===19997?1.99:i===19996?4.95:100,stock_actual:1000,unidad_medida:i===14999?'kg':i===14998?'m':i===19997?'g':i===19996?'l':'unidad',costo_actual:10,costo_ultima_compra:10,categoria:null});
 for(const p of qa.products){const n=Number(p.codigo_interno.slice(4));if(examples[n]){p.nombre=examples[n][0];p.categoria=examples[n][1];p.unidad_medida=examples[n][2]}if([19990,19991].includes(n))p.codigo_barras='7799999999999'}
 qa.rpc=async(name,args,signal)=>{
  qa.requests.push({name,args:structuredClone(args)});
  if(name==='listar_modulos_empresa_sigo')return {data:[],error:null};
  if(name!=='consultar_productos_sigo')throw Error('Bulk or unexpected RPC forbidden: '+name);
  assertBound(args.p_limite<=501);
  const delay=qa.delay; await new Promise(r=>setTimeout(r,delay));
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(qa.failNext){const kind=qa.failNext;qa.failNext=false;if(kind==='connection')throw new TypeError('Failed to fetch');return {data:null,error:kind==='permission'?{code:'42501',message:'FORBIDDEN'}:kind==='server'?{code:'XX000',message:'INTERNAL_ERROR'}:{code:'57014',message:'statement timeout sintético'}}}
  let rows=qa.products.filter(p=>p.empresa_id===args.p_empresa_id);
  if(args.p_ids)rows=rows.filter(p=>args.p_ids.includes(p.id));
  else if(args.p_solo_codigo)rows=rows.filter(p=>p.codigo_interno===args.p_busqueda||p.codigo_barras===args.p_busqueda);
  else rows=rows.filter(p=>{
    const q=normal(args.p_busqueda).trim();
    return q.split(/\s+/).every(t=>normal([p.nombre,p.marca,p.categoria].join(' ')).includes(t))||normal(p.codigo_interno).includes(q)||normal(p.codigo_barras).includes(q);
  });
  rows.sort((a,b)=>a.nombre.localeCompare(b.nombre)||a.id.localeCompare(b.id));
  qa.lastCompleted={q:args.p_busqueda,empresa:args.p_empresa_id};
  return {data:structuredClone(rows.slice(args.p_offset??0,(args.p_offset??0)+(args.p_limite??51))),error:null};
 };
 function assertBound(v){if(!v)throw Error('Unbounded request')}
 for(const name of ['sigo:arca:venta','sigo:fiscal:caja'])window.addEventListener(name,e=>qa.fiscal.push({name,detail:e.detail}));
 window.fetch=window.open=window.print=(...args)=>{qa.forbidden.push(args);throw Error('External access forbidden')};
}
const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import POS from './src/VentaRapidaOperativa';import {Productos} from './src/SigoApp';import {leerProductosPorIdsSigo} from './src/productos';(${fixture.toString()})();const root=createRoot(document.getElementById('root'));window.__qa.readIds=leerProductosPorIdsSigo;window.__qa.render=(modo,empresa=window.__qa.E)=>{window.__qa.empresa=empresa;root.render(modo==='productos'?<Productos key={empresa} empresaId={empresa} puedeEditar={false}/>:<POS empresaId={empresa}/>)};window.__qa.render('pos');`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'synthetic',setup(b){b.onResolve({filter:/^\.\//},a=>mocks[a.path]?{path:a.path,namespace:'qa'}:null);b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:mocks[a.path],loader:'tsx'}));b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'text'}));}}]});
const css=(await Promise.all(['src/index.css','src/caja-ventas.css','src/barcode-scanner.css'].map(f=>fs.readFile(f,'utf8')))).join('\n');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
const unexpected=[];await context.route('**/*',r=>{if(r.request().url()===origin)return r.fulfill({contentType:'text/html',body:`<html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="root"></div></body></html>`});unexpected.push(r.request().url());return r.abort()});
const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cases=[];const timings=[];
const input=()=>page.locator('.barcode-entry-row input');
const suggestions=()=>page.locator('[data-pos-suggestion]');
const cart=()=>page.locator('.sigo-pos-cart tbody tr');
async function check(name,run){await run();cases.push(name);console.log('PASS:',name)}
async function search(q,n=1){const start=Date.now();await input().fill(q);await page.waitForFunction(({q,n})=>window.__qa.lastCompleted?.q===q&&!document.body.textContent.includes('Buscando productos…')&&document.querySelectorAll('[data-pos-suggestion]').length===n,{q,n});timings.push({q,ms:Date.now()-start})}
try{
 const opened=Date.now();await page.goto(origin);await page.addScriptTag({content:built.outputFiles[0].text});await input().waitFor();const cajaOpenMs=Date.now()-opened;assert.ok(cajaOpenMs<3000);
 await check('Caja starts without downloading products or units',async()=>{assert.equal(await page.evaluate(()=>window.__qa.requests.length),0)});
 await check('ENCHUFE: 120 matches, pages 50/50/20 and keyboard selects 120th',async()=>{
  await search('ENCHUFE',50);await page.getByRole('button',{name:'Más resultados',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Páginas de resultados de Caja"]').textContent.includes('Página 2')&&document.querySelectorAll('[data-pos-suggestion]').length===50);
  await page.getByRole('button',{name:'Más resultados',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-pos-suggestion]').length===20);
  await input().focus();for(let i=0;i<19;i++)await input().press('ArrowDown');await input().press('Enter');await cart().waitFor();assert.match(await cart().innerText(),/ENCHUFE 14119/);
  await page.keyboard.press('F9');await page.waitForFunction(()=>window.__qa.confirms.length===1);await page.waitForFunction(()=>document.querySelectorAll('.sigo-pos-cart tbody tr').length===0);
 });
 await check('Full and partial name, accents, brand, internal code and EAN',async()=>{
  for(const q of ['ACOPLE RÁPIDO PROFESIONAL','acople rapido profesion','profesion ACOPLE rapido','INT-14999','7790000014999'])await search(q);
  await search('marcaqa',50);
 });
 await check('Weight, meters, cart totals, F10 ticket and F11 fiscal event are synthetic',async()=>{
  await search('acople rapido profesion');await input().press('Enter');await page.locator('#sigo-cantidad-medida').fill('625');await page.getByRole('button',{name:'Agregar · Enter',exact:true}).click();
  await search('INT-14998');await input().press('Enter');await page.locator('#sigo-cantidad-medida').fill('1.125');await page.getByRole('button',{name:'Agregar · Enter',exact:true}).click();
  assert.equal(await cart().count(),2);assert.match(await page.locator('.sigo-pos-total').innerText(),/175/);
  await page.screenshot({path:artifact+'/caja.png',fullPage:true});
  await page.keyboard.press('F10');await page.waitForFunction(()=>window.__qa.confirms.length===2&&window.__qa.prints.length===1);await page.waitForFunction(()=>document.querySelectorAll('.sigo-pos-cart tbody tr').length===0);
  await search('ENCHUFE 14001');await input().press('Enter');await page.keyboard.press('F11');await page.waitForFunction(()=>window.__qa.confirms.length===3&&window.__qa.fiscal.length===1);
  const items=await page.evaluate(()=>window.__qa.confirms[1].items);assert.deepEqual(items.map(i=>[i.cantidad,i.unidadMedida]),[[0.625,'kg'],[1.125,'m']]);
 });
 await check('Repeated barcode Enter/Tab adds units, clears and focuses scanner',async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('.sigo-pos-cart tbody tr').length===0);
  for(const key of ['Enter','Tab']){await input().fill('7790000014001');await input().press(key);await page.waitForFunction(()=>document.querySelector('.barcode-entry-row input')?.value==='')}
  await page.waitForFunction(()=>document.querySelector('.sigo-pos-cart tbody')?.textContent.includes('2 unidad'));
  assert.equal(await cart().count(),1);assert.match(await cart().innerText(),/2 unidad/);assert.equal(await input().evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('F9');await page.waitForFunction(()=>window.__qa.confirms.length===4);
 });
 await check('All trades and first/middle/last items selectable by mouse with quantity editing',async()=>{
  for(const q of ['ferreteria','supermercado','libreria','carniceria','verduleria','fiambreria','limpieza'])await search(q);
  for(const n of [1,10000,20000]){
    await search('Producto '+String(n).padStart(5,'0'));await suggestions().first().click();await cart().waitFor();
    await page.getByRole('button',{name:'Editar cantidad de Producto '+String(n).padStart(5,'0'),exact:true}).click();
    await page.locator('#sigo-cantidad-medida').fill('2');await page.getByRole('button',{name:'Actualizar · Enter',exact:true}).click();
    assert.match(await cart().innerText(),/2 unidad/);await page.locator('.sigo-pos-remove').click();
  }
 });
 await check('Grams/liters preserve cents and decimals with the 20000-product catalog',async()=>{
  await search('INT-19997');await input().press('Enter');await page.locator('#sigo-cantidad-medida').fill('125');await page.getByRole('button',{name:'Agregar · Enter',exact:true}).click();
  await search('INT-19996');await input().press('Enter');await page.locator('#sigo-cantidad-medida').fill('0.375');await page.getByRole('button',{name:'Agregar · Enter',exact:true}).click();
  assert.match(await page.locator('.sigo-pos-total').innerText(),/250,61/);await page.screenshot({path:artifact+'/centavos.png',fullPage:true});await page.keyboard.press('F9');await page.waitForFunction(()=>window.__qa.confirms.length===5);
  const items=await page.evaluate(()=>window.__qa.confirms[4].items);assert.deepEqual(items.map(i=>[i.cantidad,i.unidadMedida]),[[125,'g'],[0.375,'l']]);
 });
 await check('Duplicate scanned code blocks selection instead of choosing a product',async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('.sigo-pos-cart tbody tr').length===0);
  await input().fill('7799999999999');await input().press('Enter');await page.getByText('El código está duplicado dentro de esta empresa.',{exact:false}).waitFor();assert.equal(await cart().count(),0);
  await input().fill('');await input().pressSequentially('INT-20000',{delay:1});await input().press('Enter');
  await cart().waitFor();assert.match(await cart().innerText(),/Producto 20000/);await page.locator('.sigo-pos-remove').click();
  await input().fill('7799999999998');await input().press('Enter');await page.getByText('No se encontró un producto con el código 7799999999998.',{exact:true}).waitFor();
 });
 await check('Connection, permission and server failures remain distinct from zero matches',async()=>{
  for(const [kind,message] of [['connection','No se pudo conectar'],['permission','No tenés permiso'],['server','El servidor no pudo completar']]){
    await page.evaluate(k=>window.__qa.failNext=k,kind);await input().fill(kind+' consulta');await page.getByText(message,{exact:false}).waitFor();
    assert.equal(await page.getByText('No encontré productos.',{exact:false}).count(),0);
  }
  await input().fill('SIN-COINCIDENCIA-REAL');await page.getByText('No encontré productos.',{exact:false}).waitFor();
 });
 await check('Timeout displays error, retry succeeds without false empty result',async()=>{
  await page.evaluate(()=>window.__qa.failNext=true);await input().fill('acople');await page.getByRole('button',{name:'Reintentar búsqueda'}).waitFor();assert.equal(await page.getByText('No encontré productos.',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Reintentar búsqueda'}).click();await suggestions().waitFor();
 });
 await check('Aborted old query and tenant change never show former tenant rows',async()=>{
  await page.evaluate(()=>window.__qa.delay=500);await input().fill('ENCHUFE');await page.waitForTimeout(220);await page.evaluate(()=>window.__qa.render('pos',window.__qa.O));
  await input().fill('acople');await suggestions().waitFor();await page.waitForTimeout(550);assert.equal(await suggestions().count(),1);assert.equal(await suggestions().getAttribute('data-product-id'),await page.evaluate(()=>window.__qa.O+':14999'));
  await page.evaluate(()=>window.__qa.delay=0);
 });
 await check('Products initial page and server search reach beyond 14000, next page works',async()=>{
  await page.evaluate(()=>window.__qa.render('productos'));await page.waitForFunction(()=>document.querySelectorAll('.products-table tbody tr').length===50);
  await page.getByRole('button',{name:'Más productos',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Páginas de productos"]').textContent.includes('Página 2')&&document.querySelectorAll('.products-table tbody tr').length===50);
  await input().fill('acople rapido profesion');await page.waitForFunction(()=>document.querySelectorAll('.products-table tbody tr').length===1);assert.match(await page.locator('.products-table').innerText(),/ACOPLE RÁPIDO PROFESIONAL/);
 });
 await check('Readback requests only selected IDs and all RPCs stay bounded',async()=>{
  const result=await page.evaluate(async()=>{const q=window.__qa;const rows=await q.readIds(q.E,[q.E+':14999']);return {rows,request:q.requests.at(-1)}});assert.equal(result.rows.length,1);assert.equal(result.request.args.p_ids.length,1);
  assert.equal((await page.evaluate(()=>window.__qa.requests)).every(r=>r.name==='consultar_productos_sigo'||r.name==='listar_modulos_empresa_sigo'),true);
 });
 await page.screenshot({path:artifact+'/productos.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(await page.evaluate(()=>window.__qa.forbidden),[]);
 await fs.writeFile(artifact+'/browser.json',JSON.stringify({status:'PASS',syntheticProductsPerTenant:20000,tenants:2,cajaOpenMs,cases,timings,limitations:['Synthetic DB/payment/ticket/fiscal boundaries; no real sale, CAE, printer, physical scanner or production validation']},null,2));
}finally{await browser.close()}
