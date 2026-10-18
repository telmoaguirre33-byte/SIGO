import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {prepareCommercialAssets} from '../release/commercial-assets.mjs';
const temporary=await mkdtemp(path.join(os.tmpdir(),'mayorista-commercial-assets-'));
const source=new URL('../demo/dist/',import.meta.url),destination=path.join(temporary,'commercial');
try{
 const original=await readFile(new URL('security/qa-access.mjs',source),'utf8');
 const manifest=await prepareCommercialAssets({source,destination});
 assert.ok(manifest.files.length>20);assert.equal(manifest.enabled,false);
 assert.equal(await readFile(new URL('security/qa-access.mjs',source),'utf8'),original);
 for(const name of ['sample.mjs','index.html','connected.html','offline-check.html','admin.html','cargas.html','tests','backend'])assert.ok(!manifest.files.some(f=>f.path===name||f.path.startsWith(name+'/')));
 const qa=await import(pathToFileURL(path.join(destination,'security/qa-access.mjs')));
 assert.equal(qa.isQaAccess(),false);assert.equal(qa.qaAccessFields(), '');await assert.rejects(()=>qa.prepareQaOrder(),/Operación no disponible/);
 const config=await import(pathToFileURL(path.join(destination,'secure-config.mjs')));assert.equal(config.secureConfig.enabled,false);
 await assert.rejects(()=>prepareCommercialAssets({source,destination}),e=>e.code==='EEXIST');
 await assert.rejects(()=>prepareCommercialAssets({source,destination:path.join(new URL(source).pathname,'unsafe')}),/MUST_BE_SEPARATE/);
 const mock=path.join(temporary,'mock');await mkdir(path.join(mock,'security'),{recursive:true});
 await writeFile(path.join(mock,'operational-sw.js'),"const ASSETS=['./secure.html','./portal.html','./security/qa-access.mjs'];");
 await writeFile(path.join(mock,'security/qa-access.mjs'),'');await writeFile(path.join(mock,'portal.html'),'');
 await writeFile(path.join(mock,'secure.html'),'30000000-0000-4000-8000-000000000001');
 const bad=path.join(temporary,'rejected');await assert.rejects(()=>prepareCommercialAssets({source:mock,destination:bad}),/QA_OR_SECRET_REJECTED/);
 assert.ok(!(await readdir(temporary)).includes('rejected'));
 console.log('PASS paquete público comercial desde build real: allowlist, dependencias, sin datos/accesos QA, destinos existentes rechazados, origen intacto y configuración inactiva. Sin DB ni despliegue.');
}finally{await rm(temporary,{recursive:true,force:true});}
