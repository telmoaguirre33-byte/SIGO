import { crearCorreccionUnidadInicial, type Alcance } from './correccionUnidadInicial.ts';
import { crearAdaptadorCorreccionUnidadInicial, type ClienteRpc } from './adaptadorCorreccionUnidadInicial.ts';
import { crearPersistenciaCorreccionUnidadInicial, type AlmacenSesion } from './persistenciaCorreccionUnidadInicial.ts';
/** Punto de entrada para integrar: requiere journal v2 y usuario autenticado explícitos; los registros v1 bloquean nuevas solicitudes. */
export function prepararCorreccionUnidadInicial(config: {
  cliente: ClienteRpc; sessionStorage: AlmacenSesion; usuarioId: string; alcance: Alcance;
  contextoActual: () => Alcance & { usuarioId: string };
}) {
  const persistencia = crearPersistenciaCorreccionUnidadInicial(config.sessionStorage, { usuarioId: config.usuarioId, ...config.alcance });
  const adapter = crearAdaptadorCorreccionUnidadInicial(config.cliente);
  return crearCorreccionUnidadInicial(config.alcance, {
    ...adapter, persistencia,
    alcanceActual: () => {
      const actual = config.contextoActual();
      return actual.usuarioId === config.usuarioId ? actual : { empresaId: '', productoId: '' };
    },
  });
}

