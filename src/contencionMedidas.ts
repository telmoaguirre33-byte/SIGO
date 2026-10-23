/** Variante local de contención. No es un interruptor remoto ni bloquea otras pestañas. */
export const CONTENER_NUEVAS_VENTAS_MEDIDAS = true;
/** Conservador: sólo pieza/unidad conocida queda habilitada; no degrada unidades. */
export function bloqueaNuevaVentaMedida(activa: boolean, items: readonly { unidad: unknown }[]): boolean {
  return activa && items.some((item) => item.unidad !== "unidad");
}
