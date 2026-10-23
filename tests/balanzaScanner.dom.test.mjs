import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
test('lector usa perfil vigente, cola repetida, exacto ordinario, error y cambio de contexto',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,k,{configurable:true,value:v});
 globalThis.lookup=async()=>[];
 const out=await build({entryPoints:['src/BarcodeScanner.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'test',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));b.onLoad({filter:/\/barcode\.ts$/},()=>({contents:`export const buscarProductoPorCodigo=(...a)=>globalThis.lookup(...a); export const normalizeBarcode=s=>s.trim(); export const isLegacyDuplicateProduct=()=>false;export const isLikelyScannerSubmit=k=>k==='Enter'||k==='Tab';`,loader:'ts'}));}}]});
 const {default:Scanner}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));let tags=[],ordinary=[];
 const base={empresaId:'e1',action:'vender',onProduct:p=>ordinary.push(p.id)};
 async function render(extra={}){await act(async()=>root.render(React.createElement(Scanner,{...base,...extra})));}
 async function scan(value){const input=document.querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});const btn=[...document.querySelectorAll('button')].find(b=>/Buscar/i.test(b.textContent));await act(async()=>btn.click());}
 try{
 await render(); await render({onUnknownCode:c=>{tags.push(c);return {handled:true};},resolutionContextKey:1});
 await scan('2000002007505');await scan('2000002007505');assert.equal(tags.length,2);
 globalThis.lookup=async()=>[{id:'p1',empresa_id:'e1',nombre:'normal',precio_venta:2,stock_actual:3}];await scan('2000002007505');assert.deepEqual(ordinary,['p1']);assert.equal(tags.length,2);
 await render({onMatchedCode:()=> 'Colisión', onUnknownCode:c=>{tags.push(c);return {handled:true};},resolutionContextKey:1});await scan('2000002007505');assert.equal(ordinary.length,1);assert.match(document.body.textContent,/Colisión/);
 globalThis.lookup=async()=>{const e=new Error('offline');e.stack='offline (expected synthetic)';throw e;};await scan('2000002007505');assert.equal(tags.length,2);
 let resolve;globalThis.lookup=()=>new Promise(r=>resolve=r);await scan('2000002007505');await render({onUnknownCode:()=>{throw Error('must not run');},resolutionContextKey:2});await act(async()=>resolve([]));assert.equal(tags.length,2);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
