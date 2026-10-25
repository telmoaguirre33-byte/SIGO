export type VerificacionCobroConfirmado = {
  integridad: "ok" | "revisar" | "no_verificada";
  totalVerificado: number | null;
};

/** Sólo se utiliza DESPUÉS de recibir un UUID de venta válido.
 * Un diagnóstico incompleto no convierte esa venta en un cobro pendiente.
 * Tampoco se afirma que el stock esté verificado cuando falta evidencia.
 */
export function avisoCobroConfirmado(
  verificacion: VerificacionCobroConfirmado,
  totalEsperado: number,
): { texto: string; requiereRevision: boolean } {
  const mensajes: string[] = [];
  const diferencia = verificacion.totalVerificado !== null
    && Number.isFinite(verificacion.totalVerificado)
    && Number.isFinite(totalEsperado)
    && Math.abs(verificacion.totalVerificado - totalEsperado) > 0.01;
  if (diferencia) {
    mensajes.push(`El precio cambió mientras confirmabas. SIGO registró $ ${verificacion.totalVerificado!.toLocaleString("es-AR")}. Revisá ese importe.`);
  }
  if (verificacion.integridad === "revisar") {
    mensajes.push("Venta confirmada. La comprobación adicional detectó una diferencia en el comprobante, caja o stock. Revisala en Ventas/Informes; no vuelvas a cobrar esta misma operación.");
  } else if (verificacion.integridad === "no_verificada") {
    mensajes.push("Venta confirmada. La comprobación adicional de caja o stock no está completa. No vuelvas a cobrar esta misma operación.");
  }
  return { texto: mensajes.join(" "), requiereRevision: diferencia || verificacion.integridad === "revisar" };
}
