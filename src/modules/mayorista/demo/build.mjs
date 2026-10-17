import { stripTypeScriptTypes } from 'node:module';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sources = ['offline/pedidos-locales', 'offline/pedidos-indexeddb', 'offline/catalogo-indexeddb', 'sync/contrato-pedidos', 'sync/validacion-pedidos', 'integration/access-policy', 'integration/company-config', 'integration/preview-qa-config'];
for (const source of sources) {
  const ts = await readFile(path.join(root, '..', source + '.ts'), 'utf8');
  const js = stripTypeScriptTypes(ts, { mode: 'transform' }).replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, '$1$2.js$3');
  await mkdir(path.dirname(path.join(out, source)), { recursive: true });
  await writeFile(path.join(out, source + '.js'), js);
}
for (const name of ['index.html', 'offline-check.html', 'offline-check.mjs', 'admin.html', 'admin.mjs', 'cargas.html', 'cargas.mjs', 'connected.html', 'secure.html', 'portal.html', 'operational-sw.js', 'secure-config.mjs', 'secure.webmanifest', 'app.mjs', 'storage.mjs', 'sample.mjs', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'favicon-32.png', 'apple-touch-icon.png', 'installation.mjs', 'seller-entry.mjs']) await cp(path.join(root, name), path.join(out, name));

await cp(path.join(root,'../sync/http-client.mjs'),path.join(out,'sync/http-client.mjs'));
await cp(path.join(root,'../integration/workspace.css'),path.join(out,'integration/workspace.css'));
await cp(path.join(root,'../integration/navigation.mjs'),path.join(out,'integration/navigation.mjs'));
await cp(path.join(root,'../integration/shared-commerce.mjs'),path.join(out,'integration/shared-commerce.mjs'));
await cp(path.join(root,'../admin'),path.join(out,'admin'),{recursive:true});
await cp(path.join(root,'../cargas'),path.join(out,'cargas'),{recursive:true,filter:p=>!p.endsWith('postgres.mjs')&&!p.endsWith('.sql')});
await mkdir(path.join(out,'vendedor'),{recursive:true});
await cp(path.join(root,'../vendedor/connected.mjs'),path.join(out,'vendedor/connected.mjs'));
await cp(path.join(root,'../vendedor/secure.mjs'),path.join(out,'vendedor/secure.mjs'));
await cp(path.join(root,'../vendedor/route-map.mjs'),path.join(out,'vendedor/route-map.mjs'));
for(const name of ['product-search.mjs','product-picker.mjs','seller-model.mjs'])await cp(path.join(root,'../vendedor',name),path.join(out,'vendedor',name));
await mkdir(path.join(out,'security'),{recursive:true});
await cp(path.join(root,'../security/encrypted-workspace.mjs'),path.join(out,'security/encrypted-workspace.mjs'));
await cp(path.join(root,'../offline/encrypted-orders.mjs'),path.join(out,'offline/encrypted-orders.mjs'));
await cp(path.join(root,'../offline/encrypted-collections.mjs'),path.join(out,'offline/encrypted-collections.mjs'));
await cp(path.join(root,'../offline/encrypted-visits.mjs'),path.join(out,'offline/encrypted-visits.mjs'));
console.log('Build Mayorista aislado: 7 módulos TypeScript transformados, App Vendedor y administración demo generadas; sin chequeo tsc.');



await cp(path.join(root,'../security/qa-access.mjs'),path.join(out,'security/qa-access.mjs'));

await mkdir(path.join(out,'commercial'),{recursive:true});
await cp(path.join(root,'../commercial/launch-model.mjs'),path.join(out,'commercial/launch-model.mjs'));
for(const name of ['launch-panel','reports-panel']){const source=await readFile(path.join(root,'../admin',name+'.mjs'),'utf8');await writeFile(path.join(out,'admin',name+'.mjs'),source.replace(/(from ['"]\.\/[^'"]+)\.ts(['"])/g,'$1.mjs$2'));}
const reader=await readFile(path.join(root,'../admin/import-reader.ts'),'utf8');
await writeFile(path.join(out,'admin/import-reader.mjs'),stripTypeScriptTypes(reader,{mode:'transform'}));

const excel=await readFile(path.join(root,'../admin/report-excel.ts'),'utf8');
await writeFile(path.join(out,'admin/report-excel.mjs'),stripTypeScriptTypes(excel,{mode:'transform'}));
