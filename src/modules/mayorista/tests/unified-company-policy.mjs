import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';import os from 'node:os';import path from 'node:path';
const tmp=await mkdtemp(path.join(os.tmpdir(),'sigo-unified-policy-'));
try{
 for(const name of ['access-policy','company-config']){const ts=await readFile(new URL('../integration/'+name+'.ts',import.meta.url),'utf8');await writeFile(path.join(tmp,name+'.mjs'),stripTypeScriptTypes(ts,{mode:'transform'}).replace("'./access-policy'","'./access-policy.mjs'"));}
 const {createCompanyConfigProvider}=await import(pathToFileURL(path.join(tmp,'company-config.mjs'))),{isMayoristaEnabled,resolveMayoristaAccess}=await import(pathToFileURL(path.join(tmp,'access-policy.mjs')));
 const id='10000000-0000-4000-8000-000000000001',signal=new AbortController().signal,ctx={empresaId:id,rol:'owner'};
 let enabled=true,type='minorista',connections=0,types=0;
 const provider=createCompanyConfigProvider(async empresaId=>{connections++;return[{empresa_id:empresaId,habilitado:true,aplicacion_disponible:true,origen_aprobado:'https://mayorista.sigo.test',administracion_url:'https://mayorista.sigo.test/portal.html',vendedor_url:'https://mayorista.sigo.test/secure.html'}]},async()=>[{clave:'mayorista_distribuidora',habilitado:enabled}],async()=>{types++;return type});
 assert.equal(await provider(id,signal),null);assert.equal(connections,0); // Minorista incluso con flag administrativo encendido.
 for(type of ['mayorista','mixto']){const config=await provider(id,signal);assert.equal(config.tipoNegocio,type);assert.equal(isMayoristaEnabled(ctx,config),true);assert.equal(resolveMayoristaAccess(ctx,config).enabled,true);assert.equal(isMayoristaEnabled({...ctx,empresaId:'otra'},config),false);}
 enabled=false;const n=types;assert.equal(await provider(id,signal),null);assert.equal(types,n); // Flag apagado no agrega lectura a operación Minorista.
 enabled=true;type='desconocido';await assert.rejects(()=>provider(id,signal),/Tipo de negocio no verificado/);
 const bad=createCompanyConfigProvider(async()=>null,async()=>[{clave:'mayorista_distribuidora',habilitado:true}],async()=>{throw Error('RPC sin conexión')});await assert.rejects(()=>bad(id,signal),/RPC sin conexión/);
 const controller=new AbortController();controller.abort();assert.equal(await provider(id,controller.signal),null);
 console.log('PASS integración unificada: Minorista sin menú ni consultas operativas adicionales, Mayorista/Mixto por tipo canónico y flag, override apagado, aislamiento, fallo cerrado y cancelación. Sin DB/red.');
}finally{await rm(tmp,{recursive:true,force:true});}
