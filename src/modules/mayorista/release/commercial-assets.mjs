import {readFile,writeFile,mkdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const stub="export const isQaAccess=()=>false;\nexport const qaAccessFields=()=>'';\nexport async function prepareQaOrder(){throw Error('Operación no disponible');}\n";
const hash=b=>createHash('sha256').update(b).digest('hex');
const forbidden=/distribuidora\.qa\.invalid|30000000-0000-4000-8000-000000000001|mayorista-api-qa-qa\.up\.railway\.app|lapizcito5|PRUEBA P0|QA AISLADO|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bservice_role\s*[:=]\s*['"][^'"]+['"]/i;
/** Construye sólo recursos públicos operativos en un directorio NUEVO.
 * No instala DB, no modifica fuente/QA, no activa perfiles ni crea sesiones. */
export async function prepareCommercialAssets({source,destination}){
 const src=await realpath(source),dst=path.resolve(destination);
 if(dst===src||dst.startsWith(src+path.sep)||src.startsWith(dst+path.sep))throw Error('COMMERCIAL_DESTINATION_MUST_BE_SEPARATE');
 const sw=await readFile(path.join(src,'operational-sw.js'),'utf8');
 const names=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>m[1]);
 if(!names.includes('secure.html')||!names.includes('portal.html')||!names.includes('security/qa-access.mjs'))throw Error('OPERATIONAL_ASSET_MANIFEST_INVALID');
 const allowed=new Set([...names,'operational-sw.js']),records=[];
 await mkdir(dst); // EEXIST rechaza cualquier destino existente, incluso vacío.
 try{
  for(const name of [...allowed].sort()){
   if(!/^[a-zA-Z0-9_./-]+\.(?:html|mjs|js|css|png|webmanifest)$/.test(name)||name.split('/').includes('..')||path.isAbsolute(name))throw Error('COMMERCIAL_ASSET_PATH_INVALID');
   const file=await realpath(path.join(src,name));if(!file.startsWith(src+path.sep))throw Error('COMMERCIAL_ASSET_SYMLINK_REJECTED');
   let bytes=await readFile(file);
   if(/\.(html|mjs|js|css|webmanifest)$/.test(name)){
    let text=bytes.toString('utf8');
    if(name==='security/qa-access.mjs')text=stub;
    else if(name==='secure-config.mjs')text='export const secureConfig=Object.freeze({enabled:false,approvedOrigin:null});\n';
    else text=text.replace(/PRUEBA P0/gi,'Ensayo operativo').replace(/QA AISLADO/gi,'Entorno de prueba');
    if(name==='operational-sw.js')text=text.replace(/sigo-mayorista-operational-v\d+/g,'sigo-mayorista-commercial-v1');
    if(forbidden.test(text))throw Error('COMMERCIAL_ASSET_QA_OR_SECRET_REJECTED:'+name);
    for(const m of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
     const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1]));
     if(!allowed.has(dependency))throw Error('COMMERCIAL_ASSET_DEPENDENCY_MISSING:'+dependency);
    }
    bytes=Buffer.from(text);
   }
   await mkdir(path.dirname(path.join(dst,name)),{recursive:true});
   await writeFile(path.join(dst,name),bytes);records.push({path:name,sha256:hash(bytes)});
  }
  const manifest={format:1,kind:'commercial-public-assets',enabled:false,sourceModified:false,files:records};
  await writeFile(path.join(dst,'commercial-assets-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
 }catch(e){await rm(dst,{recursive:true,force:true});throw e;}
}
