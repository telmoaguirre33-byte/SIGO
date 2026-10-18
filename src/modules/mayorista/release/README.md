# Preparación de recursos comerciales (sin desplegar)

Este procedimiento complementa el paquete de publicación. No contiene una matriz de control; los estados se registran sólo en SIGO_Mayorista_Matriz_Piloto.xlsx.

`prepareCommercialAssets({source,destination})` genera en un directorio NUEVO y separado únicamente la allowlist operativa del service worker. No ejecuta aplicación, SQL, red, login, siembras ni sincronización. Rechaza sobrescribir cualquier destino existente o escribir dentro del origen.

Después del build normal, un operador prepara una copia local/de imagen separada:

```js
import {prepareCommercialAssets} from './src/modules/mayorista/release/commercial-assets.mjs';
await prepareCommercialAssets({source:'./src/modules/mayorista/demo/dist',destination:'/RUTA-NUEVA-AUTORIZADA/publico-comercial'});
```

No usar ese directorio como deployment sin revisar perfil, TLS/Auth/CORS y aprobación de publicación. No cambiar el directorio servido por QA. En una imagen comercial nueva, copiar esta salida a la raíz estática esperada por commercial-server.mjs y conservar su inyección de secure-config según origen aprobado. Nunca reemplazar los assets del teléfono/QA reservado para comprobar esta preparación.

La copia sustituye el módulo de acceso QA por una implementación inactiva, elimina las etiquetas PRUEBA P0/QA AISLADO, omite demos/sample/fixtures/herramientas que no estén en la allowlist, mantiene recursos de offline y verifica dependencias relativas incluidas. `secure-config` del archivo queda desactivado: el runtime comercial sólo lo habilita desde su perfil aprobado. Genera hashes por archivo; rechaza identificadores sintéticos conocidos y formatos de llave privada detectables. No sustituye una revisión completa de secretos ni valida contenido de datos de servidor.

El service worker de la copia usa nombre de caché comercial separado. No se cambian stores/versiones IndexedDB, UUID, autenticación, reglas comerciales ni sincronización. La aplicación funcional de QA no utiliza este preparador.

La prueba `tests/commercial-assets.mjs` usa el build real de CI, valida exclusión, imports, QA inactivo, rechazo de datos sintéticos, configuración apagada, no sobrescritura y conservación del origen. Las regresiones operativas existentes continúan en el paquete normal. No es una prueba física ni de un destino publicado.

Las 21 migraciones y backend comercial siguen separados de las herramientas QA. No ejecutar prepare/reset/accept, schema-package ni fixtures en predeploy comercial. Los datos/usuarios QA no se copian a la empresa piloto. El esquema real, credenciales privadas y restore proveedor requieren el destino autorizado; este preparador no inventa esos valores.
