export type IntegridadComprobacion = "ok" | "revisar" | "no_verificada";

export type VerificacionCobroConfirmado = {
  integridad: IntegridadComprobacion;
  totalVerificado: number | null;
  integridadCabecera?: IntegridadComprobacion;
  integridadCaja?: IntegridadComprobacion;
  integridadDetalle?: IntegridadComprobacion;
  integridadStock?: IntegridadComprobacion;
};

/** Una RPC con UUID confirma la venta. Las lecturas posteriores son independientes.
 * La ausencia de foto PREVIA del stock impide verificar el delta, pero no
 * debe generar un cartel permanente si cabecera, caja y detalle sí coinciden.
 * No se informa stock verificado en ese caso y toda diferencia real sigue visible.
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

  const componentes = [
    verificacion.integridadCabecera,
    verificacion.integridadCaja,
    verificacion.integridadDetalle,
    verificacion.integridadStock,
  ];
  const requiereRevision = verificacion.integridad === "revisar"
    || componentes.some((estado) => estado === "revisar");

  if (requiereRevision) {
    mensajes.push("Venta confirmada. La comprobación adicional detectó una diferencia en el comprobante, caja o stock. Revisala en Ventas/Informes; no vuelvas a cobrar esta misma operación.");
  } else if (verificacion.integridad === "no_verificada") {
    // Tras #114, sin preflight de catálogo, la comprobación del delta de
    // stock es por definición no_verificada. Eso NO invalida comprobante,
    // movimiento de caja ni detalle cuando los tres están verificados.
    const comprobacionContableCompleta =
      verificacion.integridadCabecera === "ok"
      && verificacion.integridadCaja === "ok"
      && verificacion.integridadDetalle === "ok";
    const soloStockSinReferencia = comprobacionContableCompleta
      && verificacion.integridadStock === "no_verificada";
    if (!soloStockSinReferencia) {
      mensajes.push("Venta confirmada. La comprobación adicional del comprobante, caja o detalle no está completa. No vuelvas a cobrar esta misma operación.");
    }
  }

  return { texto: mensajes.join(" "), requiereRevision: diferencia || requiereRevision };
}
