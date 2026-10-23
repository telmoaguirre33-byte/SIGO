import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
const require = createRequire(import.meta.url);
const { JSDOM } = await import(process.env.SIGO_DOM_NODE_MODULES ? pathToFileURL(join(process.env.SIGO_DOM_NODE_MODULES, 'jsdom/lib/api.js')).href : 'jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const [key,value] of Object.entries({ window:dom.window, document:dom.window.document, navigator:dom.window.navigator, HTMLElement:dom.window.HTMLElement, localStorage:dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT:true })) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
const { createRoot } = await import('react-dom/client');
const output = await build({ entryPoints:[new URL('../src/ConfiguracionBalanza.tsx',import.meta.url).pathname], bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'test-dependencies',setup(b){
 b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^\.\/supabase$/},()=>({path:'supabase',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const supabase = { auth: { getUser: (...a) => globalThis.__balanzaAuth.getUser(...a), onAuthStateChange: (...a) => globalThis.__balanzaAuth.onAuthStateChange(...a) } };',loader:'js'}));
}}] });
const { default: Config } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const profile = (empresaId='e1',prefijo='20') => ({version:1,empresaId,habilitado:true,formato:{prefijo,longitudPlu:5,tipo:'peso',divisor:1000},productos:[{plu:'00001',productoId:'p1'}]});
const key = (user,company='e1') => `sigo:balanza:v1:${user}:${company}`;
async function fixture(){
 localStorage.clear(); const pending=[],listeners=new Set(); let unsubscribed=0;
 globalThis.__balanzaAuth={getUser:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),onAuthStateChange:cb=>{listeners.add(cb);return{data:{subscription:{unsubscribe(){listeners.delete(cb);unsubscribed++;}}}}}};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const changes=[];
 const props={empresaId:'e1',productos:[{id:'p1',empresa_id:'e1',nombre:'Carne'},{id:'p2',empresa_id:'e2',nombre:'Ajeno'}],puedeEditar:true,bloqueada:false,onChange:p=>changes.push(p)};
 return{host,root,props,pending,changes,get unsubscribed(){return unsubscribed;},async render(extra={}){await act(async()=>root.render(React.createElement(Config,{...props,...extra})));},async user(id,index=0){await act(async()=>pending[index].resolve({data:{user:id?{id}:null},error:null}));},async auth(id){await act(async()=>{for(const cb of listeners)cb(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);});},async close(){await act(async()=>root.unmount());host.remove();}};
}
const button=(f,label)=>[...f.host.querySelectorAll('button')].find(b=>b.textContent===label);
async function click(el){await act(async()=>el.click());}
async function input(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});}

test('Configuración: usuario y empresa aíslan perfiles; signout anula y cleanup cancela auth',async()=>{
 const f=await fixture();try{
 localStorage.setItem(key('u1'),JSON.stringify(profile()));localStorage.setItem(key('u2'),JSON.stringify(profile('e1','21')));localStorage.setItem(key('u2','e2'),JSON.stringify(profile('e2','22')));
 await f.render();await f.user('u1');assert.equal(f.changes.at(-1).formato.prefijo,'20');assert.doesNotMatch(f.host.querySelector('[aria-label="Producto balanza"]').textContent,/Ajeno/);
 await f.auth('u2');assert.equal(f.changes.at(-1).formato.prefijo,'21');
 await f.render({empresaId:'e2'});assert.equal(f.changes.at(-1),null);await f.user('u2',1);assert.equal(f.changes.at(-1).empresaId,'e2');assert.equal(f.changes.at(-1).formato.prefijo,'22');
 await f.auth(null);assert.equal(f.changes.at(-1),null);assert.equal(f.host.querySelector('fieldset').disabled,true);
 }finally{await f.close();}assert.equal(f.unsubscribed,2);
});
test('Configuración: getUser anterior no sobreescribe evento auth nuevo',async()=>{
 const f=await fixture();try{localStorage.setItem(key('old'),JSON.stringify(profile()));localStorage.setItem(key('new'),JSON.stringify(profile('e1','24')));await f.render();await f.auth('new');await f.user('old');assert.equal(f.changes.at(-1).formato.prefijo,'24');}finally{await f.close();}
});
test('Configuración: habilitación requiere verificación y persiste sólo clave usuario/empresa',async()=>{
 const f=await fixture();try{await f.render();await f.user('u1');await input(f.host.querySelector('[aria-label="PLU balanza"]'),'00001');await act(async()=>{const s=f.host.querySelector('[aria-label="Producto balanza"]');s.value='p1';s.dispatchEvent(new window.Event('change',{bubbles:true}));});await click(button(f,'Vincular PLU'));await click(button(f,'Guardar y habilitar en esta caja'));assert.equal(localStorage.getItem(key('u1')),null);assert.match(f.host.textContent,/Verificá una etiqueta real/);await click(f.host.querySelector('input[type="checkbox"]'));await click(button(f,'Guardar y habilitar en esta caja'));assert.deepEqual(JSON.parse(localStorage.getItem(key('u1'))),profile());assert.equal(localStorage.length,1);assert.equal(f.changes.at(-1).habilitado,true);}finally{await f.close();}
});
test('Configuración: desactivar anula perfil aunque borrador sea inválido',async()=>{
 const f=await fixture();try{localStorage.setItem(key('u1'),JSON.stringify(profile()));await f.render();await f.user('u1');await input(f.host.querySelector('[aria-label="Prefijo balanza"]'),'x');await click(button(f,'Desactivar en esta caja'));assert.equal(f.changes.at(-1),null);assert.equal(localStorage.getItem(key('u1')),null);}finally{await f.close();}
});
test('Configuración: fallo lectura de storage mantiene etiquetas apagadas',async()=>{
 const f=await fixture();const original=window.Storage.prototype.getItem;try{window.Storage.prototype.getItem=()=>{throw new Error('denied');};await f.render();await f.user('u1');assert.equal(f.changes.at(-1),null);assert.match(f.host.textContent,/No se pudo leer/);assert.equal(f.host.querySelector('fieldset').disabled,true);}finally{window.Storage.prototype.getItem=original;await f.close();}
});
test('Configuración: fallo borrar storage desactiva sesión y advierte persistencia',async()=>{
 const f=await fixture();const original=window.Storage.prototype.removeItem;try{localStorage.setItem(key('u1'),JSON.stringify(profile()));await f.render();await f.user('u1');window.Storage.prototype.removeItem=()=>{throw new Error('denied');};await click(button(f,'Desactivar en esta caja'));assert.equal(f.changes.at(-1),null);assert.match(f.host.textContent,/Desactivada en esta sesión/);}finally{window.Storage.prototype.removeItem=original;await f.close();}
});
test('Configuración: getUser tardío después de desmontar no notifica',async()=>{
 const f=await fixture();await f.render();await f.close();const before=f.changes.length;await f.user('u1');await f.auth('u2');assert.equal(f.changes.length,before);assert.equal(f.unsubscribed,1);
});
test('Configuración: fallo guardar no publica borrador como perfil activo',async()=>{
 const f=await fixture();const original=window.Storage.prototype.setItem;try{localStorage.setItem(key('u1'),JSON.stringify(profile()));await f.render();await f.user('u1');await input(f.host.querySelector('[aria-label="Prefijo balanza"]'),'24');await click(f.host.querySelector('input[type="checkbox"]'));window.Storage.prototype.setItem=()=>{throw new Error('storage write denied');};await click(button(f,'Guardar y habilitar en esta caja'));assert.equal(f.changes.at(-1).formato.prefijo,'20');assert.equal(JSON.parse(localStorage.getItem(key('u1'))).formato.prefijo,'20');assert.match(f.host.textContent,/storage write denied/);}finally{window.Storage.prototype.setItem=original;await f.close();}
});
