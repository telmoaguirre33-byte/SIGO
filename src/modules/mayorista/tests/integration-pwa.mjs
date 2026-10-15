import './pwa-brand.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveMayoristaAccess,MAYORISTA_FEATURE} from '../demo/dist/integration/access-policy.js';
const context={empresaId:'empresa-a',rol:'owner'};
const config={empresaId:'empresa-a',habilitado:true,aplicacionDisponible:true,origenAprobado:'https://demo.example.test',administracionUrl:'https://demo.example.test/admin.html',vendedorUrl:'https://demo.example.test/index.html'};
test('Mayorista independiente usa una clave distinta del preset legacy',()=>assert.equal(MAYORISTA_FEATURE,'mayorista_distribuidora'));
test('sin configuración queda desactivado',()=>assert.equal(resolveMayoristaAccess(context).enabled,false));
test('flag y disponibilidad deben ser booleanos true',()=>{for(const change of [{habilitado:false},{habilitado:'true'},{aplicacionDisponible:false}])assert.equal(resolveMayoristaAccess(context,{...config,...change}).enabled,false);});
test('no se comparte habilitación entre empresas',()=>assert.equal(resolveMayoristaAccess({...context,empresaId:'empresa-b'},config).enabled,false));
test('solo owner y admin acceden al lanzador administrativo',()=>{for(const rol of ['seller','warehouse','client','superadmin',''])assert.equal(resolveMayoristaAccess({...context,rol},config).enabled,false);for(const rol of ['owner','admin'])assert.equal(resolveMayoristaAccess({...context,rol},config).enabled,true);});
test('destinos requieren HTTPS y origen aprobado',()=>{for(const administracionUrl of ['http://demo.example.test/admin','javascript:alert(1)','https://otro.example/admin','https://user:pass@demo.example.test/admin'])assert.equal(resolveMayoristaAccess(context,{...config,administracionUrl}).enabled,false);});
test('no se transfieren tokens o claves en URLs',()=>{for(const key of ['access_token','key','session','jwt','password'])assert.equal(resolveMayoristaAccess(context,{...config,vendedorUrl:config.vendedorUrl+'?'+key+'=dato'}).enabled,false);});
test('rollback del flag retira los destinos',()=>{const result=resolveMayoristaAccess(context,{...config,habilitado:false});assert.equal(result.enabled,false);assert.equal(result.adminUrl,undefined);assert.equal(result.sellerUrl,undefined);});
test('Administrar conserva exactamente el código previo salvo acceso nuevo',async()=>{
  const text=await readFile(new URL('../../../ModulosControlPanel.tsx',import.meta.url),'utf8');
  const cleaned=text.replace(/^import MayoristaBusinessType.*\n/m,'').replace(/^import \{createCompanyConfigProvider\}.*\n/m,'').replace(/^import \{supabase\}.*\n/m,'').replace(/const (?:getSigoTokenMayorista|sharedCommerceRpc|obtenerConfigMayorista)=[\s\S]*?(?=const PRESETS:)/,'').replace(/      \{puedeEditar && <MayoristaBusinessType[^\n]*\n\n/m,'').replace(/      \{modulos\.some\(m =>[\s\S]*?obtenerConfig=\{obtenerConfigMayorista\}(?: sharedRpc=\{sharedCommerceRpc\})?(?: getSigoToken=\{getSigoTokenMayorista\})? \/>\}\n\n/m,'');
  const old=cleaned.replace('import MayoristaAdministrarAccess from "./modules/mayorista/integration/MayoristaAdministrarAccess";\n','').replace('      <MayoristaAdministrarAccess key={empresa.empresa_id} empresaId={empresa.empresa_id} rol={empresa.rol} />\n\n','').trimEnd();
  assert.equal(createHash('sha256').update(old).digest('hex'),'f23b7dd6fc208564c9d9fb21ba13efb38241a54e3ce6e4c4f26870db7119f695');
});
test('entrada Mayorista obtiene configuración autenticada y permanece oculta sin flag',async()=>{
  const text=await readFile(new URL('../../../ModulosControlPanel.tsx',import.meta.url),'utf8');
  assert.match(text,/modulos\.some\(m => m\.clave === \"mayorista_distribuidora\" && m\.habilitado\)/);
  assert.match(text,/obtenerConfig=\{obtenerConfigMayorista\}/);
  assert.match(text,/supabase\.rpc\('obtener_acceso_mayorista_sigo'/);
  assert.ok(!text.includes('mayorista-api-qa-qa.up.railway.app'));
});
test('manifest PWA mantiene alcance independiente',async()=>{const manifest=JSON.parse(await readFile(new URL('../demo/manifest.webmanifest',import.meta.url),'utf8'));assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.display,'standalone');});
test('iconos PNG de Android tienen dimensiones reales 192 y 512',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../demo/manifest.webmanifest',import.meta.url),'utf8'));
  for(const size of [192,512]){const icon=manifest.icons.find(i=>i.sizes===size+'x'+size);assert.equal(icon?.type,'image/png');const bytes=await readFile(new URL('../demo/'+icon.src.split('?')[0].slice(2),import.meta.url));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
});
test('shell offline incluye los iconos PNG propios',async()=>{const sw=await readFile(new URL('../demo/sw.js',import.meta.url),'utf8');assert.ok(sw.includes("'./icon-192.png'"));assert.ok(sw.includes("'./icon-512.png'"));});
test('paquete operativo publica y cachea todos los imports de sus módulos, incluido comercio compartido',async()=>{
 const root=new URL('../demo/dist/',import.meta.url),sw=await readFile(new URL('operational-sw.js',root),'utf8');
 const assets=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>new URL(m[1],root)),names=new Set(assets.map(u=>u.href));
 for(const asset of assets){const content=await readFile(asset,'utf8');if(!/\.(mjs|js)$/.test(asset.pathname))continue;
  for(const [, , path] of content.matchAll(/\b(?:from\s*|import\s*)(['"])(\.[^'"]+)\1/g))assert.ok(names.has(new URL(path,asset).href),'Import no servido/offline: '+path+' desde '+asset.pathname);
 }
 assert.ok(names.has(new URL('integration/shared-commerce.mjs',root).href));
});

import {allowedPages,mayoristaPages} from '../integration/navigation.mjs';
test('Diez páginas Mayorista reales con accesos propios de cada rol',()=>{
 assert.equal(mayoristaPages.length,10);assert.ok(allowedPages('gerencia').includes('vendedores'));assert.deepEqual(allowedPages('armador'),['deposito','cargas']);assert.deepEqual(allowedPages('chofer'),['reparto','entregas','rendiciones']);assert.deepEqual(allowedPages('minorista'),[]);
});
test('Integración de menú es aditiva; entrada SIGO anterior permanece idéntica',async()=>{
 const text=await readFile(new URL('../../../main.tsx',import.meta.url),'utf8');
 const original=text.replace('import MayoristaLauncher from "./modules/mayorista/integration/MayoristaLauncher";\n','').replace('        <MayoristaLauncher />\n','');
 assert.equal(createHash('sha256').update(original).digest('hex'),'61b48d95c56d78f8934ffbf83e48d0ef3ccf766a082ab82ecae466cefeb12361');
 const launcher=await readFile(new URL('../integration/MayoristaLauncher.tsx',import.meta.url),'utf8');assert.match(launcher,/if\(!company\|\|!config\)return null/);assert.match(launcher,/sigo:empresa-activa-cambiada/);
});
