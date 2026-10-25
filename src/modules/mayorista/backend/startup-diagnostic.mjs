/** Diagnóstico de arranque QA: solo nombres y códigos públicos, nunca valores ni errores crudos. */
export const REQUIRED_RUNTIME_VARIABLES=Object.freeze(['MAYORISTA_QA_ENABLED','MAYORISTA_BUDGET_VERIFIED','MAYORISTA_MONTHLY_BUDGET_USD','RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','MAYORISTA_DATABASE_SERVICE_ID','DATABASE_URL','MAYORISTA_DB_CA_PEM','MAYORISTA_PUBLIC_ORIGIN','MAYORISTA_AUTH_PRIVATE_KEY']);
const reasons=new Map([
 ['Mayorista QA está desactivado','QA_DISABLED'],
 ['Presupuesto Railway pendiente de verificar','BUDGET_NOT_VERIFIED'],
 ['Entorno Railway no autorizado','QA_ENVIRONMENT_INVALID'],
 ['Instancia PostgreSQL no autorizada','QA_DATABASE_INVALID'],
 ['Conexión PostgreSQL no configurada','DATABASE_CONFIG_MISSING'],
 ['Destino PostgreSQL fuera del QA privado','PRIVATE_DATABASE_REQUIRED'],
 ['Opciones TLS del DSN no autorizadas','TLS_OPTIONS_INVALID'],
 ['Certificado CA verificado obligatorio','TLS_CA_REQUIRED'],
 ['Origen HTTPS independiente obligatorio','HTTPS_ORIGIN_REQUIRED'],
 ['Clave de autenticación Ed25519 no configurada','AUTH_KEY_INVALID'],
 ['Base no instalada para este QA independiente','QA_SCHEMA_BINDING_INVALID']
]);
const codes=new Map([['42P01','QA_SCHEMA_NOT_INSTALLED'],['28P01','DATABASE_AUTH_FAILED'],['ENOTFOUND','PRIVATE_DNS_FAILED'],['ECONNREFUSED','DATABASE_UNREACHABLE'],['ETIMEDOUT','DATABASE_TIMEOUT'],['ERR_TLS_CERT_ALTNAME_INVALID','TLS_HOSTNAME_INVALID'],['SELF_SIGNED_CERT_IN_CHAIN','TLS_CA_UNTRUSTED'],['DEPTH_ZERO_SELF_SIGNED_CERT','TLS_CA_UNTRUSTED'],['CERT_HAS_EXPIRED','TLS_CERT_EXPIRED']]);
export function startupDiagnostic(error,env={}){
 return {event:'MAYORISTA_QA_STARTUP_BLOCKED',reason:reasons.get(error?.message)??codes.get(error?.code)??'STARTUP_FAILURE',missingVariables:REQUIRED_RUNTIME_VARIABLES.filter(name=>typeof env[name]!=='string'||!env[name].trim())};
}
