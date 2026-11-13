export type TipoErrorCatalogo = "timeout" | "conexion" | "permiso" | "servidor";

export class ErrorCatalogo extends Error {
  readonly tipo: TipoErrorCatalogo;
  constructor(tipo: TipoErrorCatalogo, mensaje: string) {
    super(mensaje);
    this.name = "ErrorCatalogo";
    this.tipo = tipo;
  }
}

export function errorCatalogo(causa: unknown): ErrorCatalogo {
  if (causa instanceof ErrorCatalogo) return causa;
  const dato = causa && typeof causa === "object" ? causa as { message?: unknown; code?: unknown } : {};
  const texto = String(dato.message ?? causa ?? "");
  const codigo = String(dato.code ?? "");
  if (codigo === "57014" || /statement timeout|timed?\s*out|timeout|demoró demasiado/i.test(texto)) {
    return new ErrorCatalogo("timeout", "La búsqueda superó el tiempo de espera. Reintentá; no se pudo determinar si hay coincidencias.");
  }
  if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(codigo) || /FORBIDDEN|AUTH_REQUIRED|TENANT_PRODUCT_MISMATCH|permission denied|JWT.*expired/i.test(texto)) {
    return new ErrorCatalogo("permiso", "No tenés permiso o una sesión válida para consultar productos de esta empresa. Revisá la sesión y la empresa activa.");
  }
  if (/fetch|network|conexi[oó]n|offline|ECONN|ENOTFOUND|Failed to send/i.test(texto)) {
    return new ErrorCatalogo("conexion", "No se pudo conectar para buscar productos. Revisá la conexión y reintentá.");
  }
  return new ErrorCatalogo("servidor", "El servidor no pudo completar la búsqueda. Reintentá; no se pudo determinar si hay coincidencias.");
}
