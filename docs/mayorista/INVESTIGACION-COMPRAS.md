# Investigación del workflow de Compras

Revisado sin cambiar el módulo, su test ni su workflow.

`scripts/verify-guardar-compra-ia.mjs` falla en el tercer caso: espera `precio_venta === null`, pero la fixture `base()` aporta `precios: {0: '150'}`. El helper respeta ese precio explícito incluso cuando encuentra un producto existente.

Reproducción ejecutada en memoria con una copia temporal del helper y Node `stripTypeScriptTypes`: el mismo producto devuelve código propio `PROPIO-1` y precio `150`; al quitar la entrada explícita devuelve `null`. Sin RPC ni escrituras de base de datos.

Los blobs son idénticos en la rama Mayorista y en `main` consultada:

- Helper: `ff7157c9ed82a861886b3ead82fc538178d9f1d9`.
- Test: `1a14f7f02e5891fc7c2c7d91a8514711eae61dc1`.

Evidencia CI: [run 38290123266](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38290123266), commit Mayorista `7cedbf1`.

La expectativa del test y la entrada explícita no coinciden. Resolver qué comportamiento debe exigir el test requiere una tarea separada autorizada para Compras. No se cambia para obtener un check verde en este PR.
