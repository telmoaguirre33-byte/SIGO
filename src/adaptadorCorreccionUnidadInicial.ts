import { ErrorVistaPrevia, CAMPOS, validarPreview, type Alcance, type Intento, type Resultado, type VistaPrevia } from './correccionUnidadInicial.ts';
export const DECLARACION_SERVIDOR = 'CONFIRMO_CARGA_INICIAL_SIN_MOVIMIENTOS_Y_VALORES_YA_EN_KG';
export interface ClienteRpc { rpc(nombre: string, parametros: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const NEGOCIO: Record<string, string> = {
  AUTH_REQUIRED: 'Volvé a iniciar sesión.', FORBIDDEN: 'No tenés permiso para corregir este producto.',
  INITIAL_UNIT_CORRECTION_NOT_ELIGIBLE: 'El producto no es elegible para esta corrección inicial.',
  UNIT_CHANGE_REQUIRES_HISTORY_REVIEW: 'El producto tiene historial; no se puede usar esta corrección inicial.',
  PRODUCT_VALUE_INVALID: 'Hay valores del producto inválidos.', PRODUCT_NOT_FOUND: 'No se encontró el producto.',
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
    async preview(alcance: Alcance): Promise<VistaPrevia> {
      const { data, error } = await client.rpc('previsualizar_correccion_unidad_inicial_sigo', { p_empresa_id: alcance.empresaId, p_producto_id: alcance.productoId });
      if (error) {
        const e = objeto(error);
        if (e.code === 'PGRST202' || e.code === '42883' || e.code === '42501') throw new ErrorVistaPrevia('La corrección inicial todavía no está disponible para esta cuenta. No se realizó ningún cambio.');
        if (e.code === 'P0001' && typeof e.message === 'string' && Object.hasOwn(NEGOCIO, e.message)) throw new ErrorVistaPrevia(NEGOCIO[e.message]);
        throw error;
      }
      return validarPreview(objeto(data) as VistaPrevia, alcance);
    },
    async commit(intento: Intento): Promise<Resultado> {
      const { data, error } = await client.rpc('corregir_unidad_inicial_sigo', {
        p_empresa_id: intento.preview.empresaId, p_producto_id: intento.preview.productoId,
        p_request_id: intento.requestId, p_snapshot: intento.preview.snapshot, p_declaracion: DECLARACION_SERVIDOR,
      });
      if (error) {
        const e = objeto(error);
        // Sólo excepciones PostgreSQL explícitas. Un proxy/HTTP genérico no prueba rechazo.
        if (e.code === '55P03' || e.code === '40P01') return { estado: 'rechazado', mensaje: 'El producto está siendo usado en otra operación. Volvé a verificar antes de corregirlo.' };
        if (e.code === 'P0001' && typeof e.message === 'string' && Object.hasOwn(NEGOCIO, e.message)) return { estado: 'rechazado', mensaje: NEGOCIO[e.message] };
        throw error;
      }
      const r = objeto(data); const values = objeto(r.valores);
      if (r.empresaId !== intento.preview.empresaId || r.productoId !== intento.preview.productoId || r.requestId !== intento.requestId
        || r.snapshot !== intento.preview.snapshot || r.unidad !== 'kg'
        || CAMPOS.some(campo => values[campo] !== intento.preview.valores[campo])) throw Error('Recibo RPC no coincide con la solicitud y sus valores');
      return { estado: 'aplicado', empresaId: r.empresaId as string, productoId: r.productoId as string, requestId: r.requestId as string, snapshot: r.snapshot as string, unidad: 'kg' };
    },
  };
}
