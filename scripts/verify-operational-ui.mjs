import fs from 'node:fs';

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function requireTokens(file, tokens, label) {
  const content = read(file);
  const missing = tokens.filter((token) => !content.includes(token));
  if (missing.length) {
    console.error(`FAIL ${label}: missing ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${label}`);
  }
  return content;
}

const scanner = requireTokens(
  'src/BarcodeScanner.tsx',
  [
    'ScanSource = "manual" | "wedge" | "camera"',
    '@zxing/browser',
    '📷 Escanear con cámara',
    'Pistola USB/Bluetooth',
    'Consultar precio / stock',
    'Buscar / editar producto',
  ],
  'barcode scanner supports manual/wedge/camera and product-safe actions',
);

for (const misleading of ['Vender producto', 'Ingresar mercadería']) {
  if (scanner.includes(misleading)) {
    console.error(`FAIL product scanner actions: misleading generic action remains: ${misleading}`);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log('PASS product scanner actions: sale/receipt are delegated to their real modules');

requireTokens(
  'src/ComprasOperativas.tsx',
  [
    'BarcodeScanner',
    'agregarProductoEscaneado',
    'action="ingresar"',
    'Escanear mercadería',
    'cada lectura agrega una unidad',
    'cantidad: Number(linea.cantidad || 0) + 1',
  ],
  'purchase receipt accepts repeated barcode scans and consolidates quantity',
);

requireTokens(
  'src/SigoRoot.tsx',
  [
    'sigo-context-actions',
    'MatrizAdmin',
    'ClientesOperativos',
    'ComprasOperativas',
    'InformesOperativos',
  ],
  'root exposes matrix and operational workspaces',
);

requireTokens(
  'src/index.css',
  [
    '@media (max-width: 760px)',
    '.sigo-context-actions { display:flex; overflow-x:auto;',
    '.sigo-context-actions button { flex:0 0 auto;',
    '.menu { display:flex; gap:5px; overflow-x:auto;',
  ],
  'mobile navigation remains usable for company workspaces and operation tabs',
);

if (process.exitCode) process.exit(process.exitCode);
console.log('SIGO_OPERATIONAL_UI_CHECKS_OK');
