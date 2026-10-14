/** Chromium → HTTPS → backend real → PostgreSQL CI. Sin conexión a datos productivos. */
import {createServer} from 'node:https';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from '../backend/node_modules/pg/lib/index.js';
import forge from '../backend/node_modules/node-forge/lib/index.js';
import {acceptanceNamespace,installAcceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {schemaPackage} from '../railway/schema-package.mjs';
import {QA_RAILWAY} from '../railway/database-policy.mjs';
import {verifyBusinessTypeSQL} from './business-type-sql.mjs';
import {verifySharedCommerceSQL} from './shared-commerce-sql.mjs';
import {prepareSharedBackendFixture} from './shared-backend.mjs';
import {verifySharedFiscal} from './shared-fiscal.mjs';
const origin='https://localhost:4178',base=new pg.Pool({host:'127.0.0.1',port:55471,database:'mayorista_qa',user:'postgres',password:'mayorista_ci_only',max:2});
const pool=acceptanceNamespace(new pg.Pool({...base.options,max:2}),'mayorista_acceptance_000000000002');
let server,browser,socket,fixture,invoiceCall,created=false,seq=0;const pending=new Map(),errors=[],results=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp('/tmp/mayorista-ui-');
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout UI '+method));},20000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await delay(50);}throw Error('UI no alcanzó condición: '+expression+' / '+await evaluate('document.body.innerText.slice(-1000)'));}
async function submit(selector,values){await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});if(!f)throw Error('Formulario ausente');for(const [k,v] of Object.entries(${JSON.stringify(values)}))f.elements[k].value=String(v);f.requestSubmit();})()`);await wait("!document.querySelector('[aria-busy=true]')");}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);await delay(80);await wait("!document.querySelector('[aria-busy=true]')");}
async function passed(name){results.push({name,status:'pass'});console.log('PASS UI '+name);}
async function openPortal(role='gerencia',page='panel'){
 await evaluate(`(async()=>{document.body.innerHTML='<main id="ui" class="sigo-mayorista-workspace"></main>';const {mountOperationalPortal}=await import('./admin/operational-portal.mjs');window.portal=mountOperationalPortal(document.querySelector('#ui'),{enabled:true,baseUrl:location.origin+'/',integrated:true,expectedEmpresaId:${JSON.stringify(fixture.E)},initialPage:${JSON.stringify(page)},sharedCommerce:{invoice:async input=>{const r=await fetch('/__invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(!r.ok)throw Error(d.error??'Factura no confirmada');return d;}}});})()`);
 await submit('[data-form=login]',fixture.creds[role]);await wait("!!document.querySelector('nav')");
}
try{
 await installAcceptanceNamespace(pool,await schemaPackage(),[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);created=true;
 await verifyBusinessTypeSQL(pool);await verifySharedCommerceSQL(pool);fixture=await prepareSharedBackendFixture(pool,{origin});
 const backend=fixture.make();
 const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);cert.setSubject([{name:'commonName',value:'localhost'}]);cert.setIssuer(cert.subject.attributes);cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:'localhost'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());
 server=createServer({key:forge.pki.privateKeyToPem(keys.privateKey),cert:forge.pki.certificateToPem(cert)},async(req,res)=>{
  try{
   const pathname=new URL(req.url,origin).pathname;
   if(pathname==='/__invoice'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);if(!invoiceCall)throw Error('Simulación aún no preparada');const output=await invoiceCall(input);res.writeHead(output.status,{'Content-Type':'application/json'});res.end(JSON.stringify(output.body));return;}
   if(pathname==='/'||/\.(html|css|mjs|js|png|webmanifest)$/.test(pathname)){
    const file=pathname==='/'?'portal.html':pathname.slice(1);if(file.includes('..'))throw Error('Ruta inválida');const body=await readFile(new URL('../demo/dist/'+file,import.meta.url));res.writeHead(200,{'Content-Type':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(body);return;
   }
   const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const response=await backend(new Request(origin+req.url,{method:req.method,headers:{...req.headers,origin},...(['GET','HEAD'].includes(req.method)?{}:{body})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4178,'127.0.0.1',resolve);});
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors','--remote-debugging-port=9226','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','ignore']});
 let pages;for(let i=0;i<100;i++){try{pages=await(await fetch('http://127.0.0.1:9226/json')).json();break;}catch{await delay(100);}}
 if(!pages)throw Error('Chromium no inició');socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 await command('Runtime.enable');await command('Page.enable');await command('Page.navigate',{url:origin+'/'});await wait("document.readyState==='complete' && location.protocol==='https:'");
 await openPortal();assert.equal(await evaluate("document.querySelectorAll('nav button').length"),15);await passed('Login gerencia y diez páginas operativas');
 await click('[data-tab=vendedores]');await submit('[data-form=seller]',{id:'new',nombre:'Vendedor UI',zona:'Centro',activo:'true'});await wait("document.body.innerText.includes('Vendedor UI')");await passed('Alta vendedor desde formulario');
 await click('[data-tab=clientes]');await submit('[data-form=route]',{id:'new',nombre:'Ruta UI',zona:'Centro'});
 await submit('[data-form=customer]',{id:fixture.C,vendedorId:fixture.V,rutaId:fixture.R,habilitado:'true'});assert.equal((await pool.query('SELECT nombre FROM public.clientes_sigo WHERE id=$1',[fixture.C])).rows[0].nombre,'Cliente SIGO compartido');await passed('Asignación cliente y ruta conserva ficha SIGO');
 await click('[data-tab=objetivos]');const day=new Date().toISOString().slice(0,10);await submit('[data-form=management-goal]',{vendedorId:fixture.V,metrica:'vendido',periodo:'diario',desde:day,hasta:day,objetivo:10,activa:'true'});await wait("!!document.querySelector('[data-goal-edit]')");await passed('Objetivo por vendedor y período');
 await evaluate(`(async()=>{await window.portal.destroy();document.body.innerHTML='<main id="seller"></main>';const {mountSecureSeller}=await import('./vendedor/secure.mjs');mountSecureSeller(document.querySelector('#seller'),{enabled:true,baseUrl:location.origin+'/'});})()`);
 await submit('#login',{...fixture.creds.vendedor,localPassword:'ClaveLocalUI2026!'});await wait("!!document.querySelector('#line')");
 await evaluate(`(()=>{const input=document.querySelector('#product-picker input');input.value='Producto';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait("!!document.querySelector('#product-picker [role=option]')");await click('#product-picker [role=option]');await submit('#line',{clienteId:fixture.C,cantidad:1});await wait("document.body.innerText.includes('1 líneas')");await click('#save');await wait("!!document.querySelector('[data-order-id]')");await click('#sync');await wait("document.body.innerText.includes('sincronizado')");await passed('App Vendedor: búsqueda, pedido cifrado y sincronización');
 await openPortal('gerencia','pedidos');await wait("!!document.querySelector('[data-approve]')");await click('[data-approve]');await click('[data-tab=cargas]');
 await submit('[data-form=barcode]',{productoId:fixture.P,codigo:'UI-UNIT-001',unidadesBase:1});
 await submit('[data-form=create-load]',{camion:'UI-001',ruta:fixture.R,modo:'individual',chofer:'Chofer UI',responsable:'Armador UI'});
 await submit('[data-form=assign-load]',{});await submit('[data-form=publish-load]',{armadorUserId:fixture.actors.armador,choferUserId:fixture.actors.chofer});await passed('Pedido recibido, aprobación y carga con equipo');
 await openPortal('armador','deposito');assert.equal(await evaluate("!!document.querySelector('[data-tab=cuentas]')"),false);await click('[data-step=iniciar]');await submit('[data-form=scan]',{codigo:'UI-UNIT-001',modo:'picking',cantidad:1});await click('[data-step=verificar]');await passed('Depósito: picking con lectura y preparado; permisos armador');
 await openPortal('gerencia','cargas');await click('[data-step=salir]');await openPortal('chofer','entregas');await submit('[data-form=delivery]',{entregado0:1,devuelto0:0,nota:'Entrega UI comprobada'});await passed('Despacho y entrega por chofer');
 await openPortal('gerencia','entregas');await submit('[data-form=shared-delivery]',{medioPago:'cuenta_corriente'});await wait("!!document.querySelector('[data-form=shared-credit]')");await submit('[data-form=shared-credit]',{aprobar:'true',motivo:'Crédito UI por pedido'});await submit('[data-form=shared-delivery]',{});assert.equal(Number((await pool.query('SELECT stock_actual FROM public.productos WHERE id=$1',[fixture.P])).rows[0].stock_actual),6);await passed('Entrega → venta compartida; crédito por pedido y stock una vez');
 await click('[data-tab=cuentas]');await submit('[data-form=collection]',{clienteId:fixture.C,importe:10,comprobante:'UI-Cobro-001',medio:'efectivo'});assert.equal(Number((await pool.query('SELECT saldo_actual FROM public.clientes_sigo WHERE id=$1',[fixture.C])).rows[0].saldo_actual),20);await passed('Cobranza UI → cuenta corriente y Caja compartidas');
 await click('[data-tab=rendiciones]');await submit('[data-form=settlement]',{importe:10,nota:'Rendición UI cobro compartido'});await click('[data-review]');await click('[data-step=cerrar]');await passed('Rendición revisada y cierre de carga');
 await verifySharedFiscal(pool,{exercise:async({call,request})=>{
  invoiceCall=input=>call({...request,puntoVenta:input.puntoVenta,tipoCbte:input.tipoCbte,condicionIvaReceptorId:input.condicionIvaReceptorId});
  await click('[data-tab=entregas]');await submit('[data-form=shared-invoice]',{puntoVenta:1,tipoCbte:11,condicionIvaReceptorId:6});await wait("document.body.innerText.includes('CAE 12345678901234')");await passed('Factura UI con emisor existente y WSFE simulado, un comprobante persistido');
 }});
 await click('[data-tab=panel]');await wait("document.body.innerText.includes('PANEL MAYORISTA')");assert.equal(Number((await pool.query('SELECT count(*) FROM public.ventas_sigo')).rows[0].count),3);assert.equal(Number((await pool.query('SELECT count(*) FROM public.arca_comprobantes')).rows[0].count),1);await passed('Métricas actualizadas; tres ventas de fixture y una factura sin duplicados');
 for(const width of [390,1280]){await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);await passed('Panel sin desborde horizontal '+width+'px');}
 assert.deepEqual(errors,[]);await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/operational-ui.json',import.meta.url),JSON.stringify({scope:'Chromium HTTPS y PostgreSQL CI; WSFE simulado',results},null,2));console.log(results.length+' controles UI operativos aprobados. No ejecución contra Railway ni empresas productivas.');
}finally{
 if(socket?.readyState===1)await command('Browser.close').catch(()=>{});socket?.close();browser?.kill('SIGTERM');if(server)await new Promise(r=>server.close(r));await pool.end();if(created)for(const schema of Object.values(pool.schemas))await base.query('DROP SCHEMA '+schema+' CASCADE');await base.end();await rm(profile,{recursive:true,force:true});
}
