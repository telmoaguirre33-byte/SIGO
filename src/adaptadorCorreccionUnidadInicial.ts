import { ErrorVistaPrevia, validarPreview, validarIntento, reciboCoincide, type Alcance, type Intento, type Resultado, type Unidad, type VistaPrevia } from './correccionUnidadInicial.ts';
export const DECLARACION_SERVIDOR = 'CONFIRMO_CARGA_INICIAL_SIN_MOVIMIENTOS_Y_VALORES_YA_EN_UNIDAD_DESTINO';
export interface ClienteRpc { rpc(nombre: string, parametros: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const NEGOCIO: Record<string, string> = {
  AUTH_REQUIRED: 'Volvé a iniciar sesión.', FORBIDDEN: 'No tenés permiso para corregir este producto.',
  INITIAL_UNIT_CORRECTION_NOT_ELIGIBLE: 'El producto no es elegible para esta corrección inicial.',
  UNIT_CHANGE_REQUIRES_HISTORY_REVIEW: 'El producto tiene historial; no se puede usar esta corrección inicial. La conversión con historial no está disponible en esta etapa.',
  PRODUCT_VALUE_INVALID: 'Hay valores del producto inválidos.', PRODUCT_NOT_FOUND: 'No se encontró el producto.',
  UNIT_INVALID: 'La unidad de origen o destino no está soportada.', UNIT_UNCHANGED: 'Elegí una unidad de destino diferente de la actual.',
  PRODUCT_VALUE_NOT_REPRESENTABLE: 'Uno de los seis valores no es representable en la unidad de destino. Las unidades enteras (unidad, g, ml, etc.) no admiten fracciones. Esta corrección no convierte, redondea ni fuerza una equivalencia 1:1.',
  INITIAL_UNIT_CORRECTION_CONFIRMATION_REQUIRED: 'Falta la confirmación específica de carga inicial.',
  INITIAL_UNIT_CORRECTION_NOT_ENABLED: 'Esta corrección todavía no está habilitada.',
  PRODUCT_CHANGED_RELOAD: 'El producto cambió. Volvé a verificar los valores.',
  IDEMPOTENCY_CONFLICT: 'El identificador de solicitud no coincide con su contenido. Revisá la recuperación.',
};
function objeto(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Respuesta RPC no verificable');
  return value as Record<string, unknown>;
}
export function crearAdaptadorCorreccionUnidadInicial(client: ClienteRpc) {
  return {
    async preview(alcance: Alcance, destino: Unidad): Promise<VistaPrevia> {
      const { data, error } = await client.rpc('previsualizar_correccion_unidad_inicial_sigo', { p_empresa_id: alcance.empresaId, p_producto_id: alcance.productoId, p_unidad_destino: destino });
      if (error) {
        const e = objeto(error);
        if (e.code === 'PGRST202' || e.code === '42883' || e.code === '42501') throw new ErrorVistaPrevia('La corrección inicial todavía no está disponible para esta cuenta. No se realizó ningún cambio.');
        if (e.code === 'P0001' && typeof e.message === 'string' && Object.hasOwn(NEGOCIO, e.message)) throw new ErrorVistaPrevia(NEGOCIO[e.message]);
        throw error;
      }
      return validarPreview(objeto(data) as VistaPrevia, alcance, destino);
    },
    async commit(intento: Intento): Promise<Resultado> {
      const validado = validarIntento(intento, intento.preview);
      const { data, error } = await client.rpc('corregir_unidad_inicial_sigo', {
        p_empresa_id: validado.preview.empresaId, p_producto_id: validado.preview.productoId,
        p_request_id: validado.requestId, p_snapshot: validado.preview.snapshot, p_declaracion: DECLARACION_SERVIDOR,
        p_unidad_destino: validado.destino,
      });
      if (error) {
        const e = objeto(error);
        // Sólo excepciones PostgreSQL explícitas. Un proxy/HTTP genérico no prueba rechazo.
        if (e.code === '55P03' || e.code === '40P01') return { estado: 'rechazado', mensaje: 'El producto está siendo usado en otra operación. Volvé a verificar antes de corregirlo.' };
        if (e.code === 'P0001' && typeof e.message === 'string' && Object.hasOwn(NEGOCIO, e.message)) return { estado: 'rechazado', mensaje: NEGOCIO[e.message] };
        throw error;
      }
      const r = objeto(data);
      const receipt = { ...r, estado: 'aplicado', valores: objeto(r.valores) } as Extract<Resultado, { estado: 'aplicado' }>;
      if (!reciboCoincide(receipt, validado)) throw Error('Recibo RPC no coincide con la solicitud, la revisión y sus seis valores');
      return Object.freeze({ estado: 'aplicado', empresaId: receipt.empresaId, productoId: receipt.productoId, requestId: receipt.requestId,
        snapshot: receipt.snapshot, unidad: receipt.unidad, revision: receipt.revision, valores: Object.freeze({ ...receipt.valores }) });
    },
  };
}
