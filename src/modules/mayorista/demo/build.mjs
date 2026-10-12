import { stripTypeScriptTypes } from 'node:module';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sources = ['offline/pedidos-locales', 'offline/pedidos-indexeddb', 'offline/catalogo-indexeddb', 'sync/contrato-pedidos', 'sync/validacion-pedidos', 'integration/access-policy'];
for (const source of sources) {
  const ts = await readFile(path.join(root, '..', source + '.ts'), 'utf8');
  const js = stripTypeScriptTypes(ts, { mode: 'transform' }).replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, '$1$2.js$3');
  await mkdir(path.dirname(path.join(out, source)), { recursive: true });
  await writeFile(path.join(out, source + '.js'), js);
}
for (const name of ['index.html', 'offline-check.html', 'offline-check.mjs', 'admin.html', 'admin.mjs', 'app.mjs', 'storage.mjs', 'sample.mjs', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']) await cp(path.join(root, name), path.join(out, name));

await cp(path.join(root,'../admin'),path.join(out,'admin'),{recursive:true});
console.log('Build Mayorista aislado: 6 módulos TypeScript transformados, App Vendedor y administración demo generadas; sin chequeo tsc.');
