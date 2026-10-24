import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const source=await readFile(new URL('../src/SigoApp.tsx',import.meta.url),'utf8');
// Execute the actual Productos component, stubbing unrelated screen modules only.
const component=source.slice(source.indexOf('function Productos('),source.indexOf('\nfunction Stock('));
const form=source.slice(source.indexOf('type ProductoForm'),source.indexOf('export default function SigoApp'));
const code=`import React,{useState,useEffect,useMemo,useRef} from 'react';
import {motivoBloqueoBaja} from './bajaProducto';
import {cantidadEscaladaMedida,formatoStockMedida,pasoCantidadMedida,UNIDADES_VENTA} from './ventaPorMedidas';
const listarProductosSigo=(...a)=>globalThis.__bajaUi.list(...a);
const eliminarProductoSigo=(...a)=>globalThis.__bajaUi.remove(...a);
const listarUnidadesProductoSigo=async()=>({p1:'unidad',p2:'kg'});
const listarModulosEmpresa=async()=>[];
const BarcodeScanner=()=>null; const StockImportAssistant=()=>null;
const supabase={}; const guardarProductoSigo=async()=>{}; class ProductoGuardadoSinVerificarError extends Error {};
${form}\n${component}\nexport default Productos;`;
const out=await build({stdin:{contents:code,resolveDir:new URL('../src',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {default:Productos}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const product=(stock=100)=>({id:'p1',empresa_id:'e1',nombre:'Pulpa',stock_actual:stock,unidad_medida:'unidad',precio_venta:13000,activo:true});
async function fixture({stock=100,remove=async()=>{},confirm=true}={}){
 const calls=[];let items=[product(stock)];globalThis.__bajaUi={list:async empresa=>{calls.push(['list',empresa]);return items;},remove:async(...args)=>{calls.push(['remove',...args]);await remove();items=[];}};
 window.confirm=()=>{calls.push(['confirm']);return confirm;};window.alert=()=>{throw Error('No usar alert descartable');};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(React.createElement(Productos,{empresaId:'e1',puedeEditar:true})));
 return {calls,host,root,button:()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Dar de baja'),close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
async function click(button){await act(async()=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));}
test('Stock100: click no abre confirmación ni llama RPC, deja motivo visible',async()=>{const f=await fixture();try{await click(f.button());assert.match(f.host.querySelector('[role=alert]').textContent,/100 unidad.*Sigue activo/);assert.equal(f.calls.some(c=>c[0]==='confirm'||c[0]==='remove'),false);assert.ok(f.button());}finally{await f.close();}});
test('Cero stock y cancelación: no baja ni éxito',async()=>{const f=await fixture({stock:0,confirm:false});try{await click(f.button());assert.equal(f.calls.filter(c=>c[0]==='confirm').length,1);assert.equal(f.calls.some(c=>c[0]==='remove'),false);assert.equal(f.host.querySelector('[role=status]'),null);}finally{await f.close();}});
test('Baja confirmada y verificada: desaparece fila, conserva mensaje',async()=>{const f=await fixture({stock:0});try{await click(f.button());assert.equal(f.button(),undefined);assert.match(f.host.querySelector('[role=status]').textContent,/baja verificada/);assert.deepEqual(f.calls.find(c=>c[0]==='remove'),['remove','e1','p1']);}finally{await f.close();}});
test('Rechazo servidor/resultado incierto: conserva producto y error persistente',async()=>{const f=await fixture({stock:0,remove:async()=>{throw Error('No se pudo verificar la baja');}});try{await click(f.button());assert.match(f.host.querySelector('[role=alert]').textContent,/No se pudo verificar/);assert.ok(f.button());assert.equal(f.host.querySelector('[role=status]'),null);}finally{await f.close();}});
test('Doble click: una sola confirmación y solicitud mientras está pendiente',async()=>{let resolve;const f=await fixture({stock:0,remove:()=>new Promise(r=>resolve=r)});try{const b=f.button();await click(b);await click(b);assert.equal(f.calls.filter(c=>c[0]==='remove').length,1);assert.equal(f.calls.filter(c=>c[0]==='confirm').length,1);await act(async()=>resolve());}finally{await f.close();}});
test('Productos se remonta por empresa para aislar respuestas de baja anteriores',()=>assert.match(source,/<Productos key=\{empresa.empresa_id\} empresaId=\{empresa.empresa_id\}/));
test('Cambio empresa durante baja pendiente: respuesta anterior no contamina nueva empresa',async()=>{
 let resolve;const f=await fixture({stock:0,remove:()=>new Promise(r=>resolve=r)});
 try{
  await click(f.button());
  globalThis.__bajaUi.list=async empresa=>empresa==='e2'?[{...product(0),id:'p2',empresa_id:'e2',nombre:'Otra empresa'}]:[];
  await act(async()=>f.root.render(React.createElement(Productos,{key:'e2',empresaId:'e2',puedeEditar:true})));
  await act(async()=>resolve());
  assert.match(f.host.textContent,/Otra empresa/);assert.doesNotMatch(f.host.textContent,/Pulpa|baja verificada/);
 }finally{await f.close();}
});
