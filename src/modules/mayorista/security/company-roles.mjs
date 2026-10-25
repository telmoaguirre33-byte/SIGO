/** Roles consultados en membresía persistente; alias previo solo en QA no operativo. */
export const administrative=p=>['gerencia','administracion','administrador'].includes(p?.rol);
export const management=p=>['gerencia','administrador'].includes(p?.rol);
export const preparation=p=>administrative(p)||p?.rol==='armador';
export const distribution=p=>administrative(p)||p?.rol==='chofer';
