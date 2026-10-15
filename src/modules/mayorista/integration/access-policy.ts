export const MAYORISTA_FEATURE = "mayorista_distribuidora";
export type AccessContext = { empresaId: string; rol: string };
export type CompanyAccessConfig = {
  empresaId: string;
  habilitado: boolean;
  aplicacionDisponible: boolean;
  origenAprobado: string;
  administracionUrl: string;
  vendedorUrl: string;
};
export type AccessDecision = { enabled: boolean; reason: string; adminUrl?: string; sellerUrl?: string };

/** Mismo flag persistente que Matriz. La conexión operativa es un estado separado. */
export function isMayoristaEnabled(context: AccessContext, config?: CompanyAccessConfig | null): boolean {
  return !!context.empresaId && ['owner','admin'].includes(context.rol) &&
    config?.empresaId === context.empresaId && config.habilitado === true;
}

function safeUrl(value: string, approvedOrigin: string): string | null {
  try {
    const origin = new URL(approvedOrigin);
    const url = new URL(value);
    if (origin.protocol !== "https:" || origin.origin !== approvedOrigin ||
        url.protocol !== "https:" || url.origin !== origin.origin || url.username || url.password || url.hash)
      return null;
    // Never forward SIGO credentials or tokens in a URL.
    if ([...url.searchParams.keys()].some(k => /token|key|secret|password|session|jwt/i.test(k))) return null;
    return url.href;
  } catch { return null; }
}
export function resolveMayoristaAccess(context: AccessContext, config?: CompanyAccessConfig | null): AccessDecision {
  if (!context.empresaId || !["owner", "admin"].includes(context.rol))
    return {enabled:false, reason:"Este acceso requiere un administrador de la empresa."};
  if (!config || config.empresaId !== context.empresaId || config.habilitado !== true)
    return {enabled:false, reason:"Mayorista / Distribuidora está desactivado para esta empresa."};
  if (config.aplicacionDisponible !== true)
    return {enabled:false, reason:"La aplicación independiente todavía no está disponible."};
  const adminUrl = safeUrl(config.administracionUrl, config.origenAprobado);
  const sellerUrl = safeUrl(config.vendedorUrl, config.origenAprobado);
  if (!adminUrl || !sellerUrl)
    return {enabled:false, reason:"Los destinos de Mayorista requieren validación."};
  return {enabled:true, reason:"Accesos a la aplicación independiente.", adminUrl, sellerUrl};
}
