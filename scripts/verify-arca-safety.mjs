import fs from 'node:fs';

const checks = [
  {
    file: 'api/arca/preflight.js',
    required: [
      'arca.configure',
      'tiene_permiso_empresa',
      'arca_config',
      'arca_puntos_venta',
      'certificado_ref',
      'WSFEv1',
      'wsaa_service === "wsfe"',
      'wsaahomo.afip.gov.ar',
      'wsaa.afip.gov.ar',
      'wswhomo.afip.gov.ar/wsfev1',
      'servicios1.afip.gov.ar/wsfev1',
      'autenticacionRealValidada',
      'autenticacionRealEstado',
      'emisionHabilitable',
      'AUTH_REAL_MAX_AGE_MS',
      'no habilita CAE por sí sola',
      'cuitArgentinoValido',
      'configuracionActiva',
      'ambienteValido',
      'puntosVentaValidos',
    ],
    forbidden: [
      'SUPABASE_SERVICE_ROLE_KEY',
      'process.env.ARCA_PRIVATE_KEY',
      'process.env.CLAVE_FISCAL',
    ],
    label: 'ARCA backend preflight is tenant-scoped, freshness-aware and secret-safe',
  },
  {
    file: 'src/ArcaPreflight.tsx',
    required: [
      '/api/arca/preflight',
      'data.session?.access_token',
      'empresaId',
      'Autenticación WSAA real',
      'autenticacionRealEstado',
      'emisionHabilitable',
      'Emisión todavía bloqueada hasta tener WSAA vigente',
      'Validar preparación ARCA',
    ],
    label: 'ARCA preflight UI distinguishes technical readiness from fresh WSAA validation',
  },
  {
    file: 'src/ArcaFacturacion.tsx',
    required: [
      'ArcaPreflight',
      'wsaa_service: "wsfe"',
      'wsfe_version: "WSFEv1"',
      'disabled={!config?.activo || !config?.ultima_prueba_ok}',
      'autenticación WSAA real',
      'ws-factura-electronica.asp',
    ],
    label: 'ARCA UI keeps CAE issuance blocked until real WSAA validation',
  },
  {
    file: 'supabase/migrations/20260910021200_arca_config_segura.sql',
    required: [
      'arca_config',
      'arca_puntos_venta',
      'arca_comprobantes',
      "tiene_permiso_empresa(empresa_id, 'arca.configure')",
      "tiene_permiso_empresa(empresa_id, 'invoices.issue')",
      'Nunca almacenar clave fiscal',
    ],
    label: 'ARCA persistence is tenant isolated and does not store fiscal password',
  },
];

let failed = false;
for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    console.error(`FAIL ${check.label}: missing ${check.file}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(check.file, 'utf8');
  const missing = check.required.filter((token) => !content.includes(token));
  const forbidden = (check.forbidden ?? []).filter((token) => content.includes(token));
  if (missing.length) {
    console.error(`FAIL ${check.label}: missing ${missing.join(', ')}`);
    failed = true;
  }
  if (forbidden.length) {
    console.error(`FAIL ${check.label}: forbidden ${forbidden.join(', ')}`);
    failed = true;
  }
  if (!missing.length && !forbidden.length) console.log(`PASS ${check.label}`);
}

const preflight = fs.readFileSync('api/arca/preflight.js', 'utf8');
if (!preflight.includes('config.activo === true')) {
  console.error('FAIL ARCA active config guard: inactive configuration must never pass preflight');
  failed = true;
}
if (!preflight.includes('Number.isInteger(numero) && numero >= 1 && numero <= 99999')) {
  console.error('FAIL ARCA point-of-sale guard: PV must be a valid unique operational number');
  failed = true;
}
if (!preflight.includes('cuitArgentinoValido(config.cuit_emisor)')) {
  console.error('FAIL ARCA CUIT guard: issuer CUIT must validate its check digit');
  failed = true;
}
if (!preflight.includes('12 * 60 * 60 * 1000')) {
  console.error('FAIL ARCA WSAA freshness guard: a previous real authentication must expire after 12 hours');
  failed = true;
}
if (!preflight.includes('Boolean(ok && autenticacionReal.ok)')) {
  console.error('FAIL ARCA emission gate: technical preflight alone must not mark issuance as habilitable');
  failed = true;
}

if (failed) process.exit(1);
console.log('SIGO_ARCA_SAFETY_CHECKS_OK');
