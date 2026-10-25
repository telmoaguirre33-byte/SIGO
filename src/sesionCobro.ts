export type SesionCobro = {
  conocida: boolean;
  usuario: string | null;
  cambio: boolean;
  epoca: number;
};

// A missing session is not evidence of a different actor. Only an explicit
// sign-out or a different, known user invalidates an in-flight payment.
export function cambioIdentidadCobro(usuario: string | null, evento: string, siguiente?: string | null): boolean {
  return evento === "SIGNED_OUT" || Boolean(usuario && siguiente && usuario !== siguiente);
}

export function actualizarSesionCobro(actual: SesionCobro, evento: string, usuario?: string | null): SesionCobro {
  const cambio = cambioIdentidadCobro(actual.usuario, evento, usuario);
  if (!usuario && evento !== "SIGNED_OUT") return actual;
  return {
    conocida: true,
    usuario: evento === "SIGNED_OUT" ? null : usuario!,
    // A real change stays invalid for this mounted view, even after A -> B -> A.
    cambio: actual.cambio || cambio,
    epoca: actual.epoca + (cambio ? 1 : 0),
  };
}
