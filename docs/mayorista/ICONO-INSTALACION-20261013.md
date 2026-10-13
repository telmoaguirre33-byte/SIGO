# SIGO Vendedor: identidad de instalación

Corrección exclusiva de Mayorista: S negra sobre fondo blanco, nombre `SIGO Vendedor`, PNG opacos 192/512 y variantes maskable con el glifo dentro del círculo seguro de Android. La marca negra se preparó tomando la S oficial del repositorio como referencia. Se conservan los IDs, URLs de inicio y scopes de las dos entradas PWA existentes, para no cambiar las identidades de almacenamiento.

Se actualizan favicon PNG, apple-touch-icon, archivos publicados y caches de ambos Service Workers. Los iconos tienen versión explícita y respuestas `no-cache`. No se borra IndexedDB, no se modifican pedidos, cifrado ni sincronización. La entrada segura usa un bootstrap externo permitido por CSP y muestra el botón cuando Chrome emite `beforeinstallprompt`. Aceptar ese diálogo no se presenta como instalación física confirmada.

## Actualizar en Android

1. Abrir la Preview privada exacta en Chrome e iniciar sesión Vercel si lo solicita. No usar el navegador interno de otra aplicación. El acceso SSO debe seguir vigente al abrir el manifest y los iconos.
2. Una URL de Preview distinta tiene otro origen y otro almacenamiento. Mantener el alias de rama existente cuando corresponda; no esperar que los pedidos aparezcan automáticamente en otro origen. Si ya hay pedidos en el dispositivo, conservarlos y generar el respaldo cifrado antes de desinstalar. No borrar datos del sitio ni IndexedDB para cambiar el icono. Verificar primero que los pedidos conservados pueden recuperarse.
3. Abrir la misma entrada utilizada anteriormente: `/` para la entrada de demostración o `/secure.html` para la entrada operativa. La entrada operativa conserva su activación/API independiente; corregir el icono no activa una base ni una empresa.
4. Cerrar todas las ventanas de la aplicación anterior y reabrir la URL con conexión, para que se active el Service Worker actualizado. Android puede tardar en renovar metadatos de una PWA instalada.
5. Si se decide reinstalar después del respaldo, retirar la instalación anterior desde Android y usar «Instalar SIGO Vendedor» o la opción «Instalar aplicación» de Chrome. Si solo ofrece «Crear acceso directo», registrar el bloqueo y no presentarlo como WebAPK instalado.
6. Verificar el nombre e icono en el lanzador y Ajustes → Aplicaciones, apertura standalone sin barra de Chrome, reinicio del teléfono y recuperación offline de pedidos. Registrar modelo, versión Android/Chrome, URL exacta y commit.

## Límites de la verificación

Las pruebas automatizadas comprueban dimensiones, PNG opaco negro/blanco, máscara segura, manifest y criterios Chromium, además de la regresión de pedidos. No sustituyen una instalación física ni confirman actualización del icono en el lanzador Android.

Una Preview con SSO puede impedir que el servicio de Android descargue el manifest/iconos sin las cookies del teléfono y provocar instalación como acceso directo. No se deshabilita la protección para ocultarlo. Se debe comprobar este caso en el teléfono autorizado; si ocurre, hace falta acordar un mecanismo de distribución privada compatible con WebAPK antes de afirmar instalación Android completa.

## Evidencia de esta corrección

Commit de código: `62f0773f12655a99f262dbf82ec031e3222464f5`.

- Local: build independiente, 17 controles PWA/integración, 24 pruebas de cargas y 2 de precios consolidados, todos ejecutados con resultado exitoso.
- [CI Mayorista](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38328380862): TypeScript, build, pruebas Node, RLS, 81 controles API/PostgreSQL, 45 controles Chromium/IndexedDB y Docker aprobados. Las dos nuevas pruebas Chromium verifican la entrada segura instalable y descarga de PNG any/maskable con dimensiones y colores reales.
- [Build SIGO](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38328380876): aprobado. Compras conserva su fallo previo; no se modificó.
- Preview privada del proyecto existente, estado `READY`, destino Preview (`target:null`), commit exacto arriba, sin promoción: https://sigo-mayorista-demo-20261012-b6ku5ruse-telmoaguirre33-byte.vercel.app/
- Entrada segura: https://sigo-mayorista-demo-20261012-b6ku5ruse-telmoaguirre33-byte.vercel.app/secure.html
- Alias de rama para conservar un origen estable si ya se usaba: https://sigo-mayorista-demo-20261012-git-fea-b8c996-telmoaguirre33-byte.vercel.app/

El conector pudo desplegar e inspeccionar el estado/commit, pero la lectura protegida devolvió `403` en `read_protection_bypass`. No se declara verificación HTTP autenticada del manifest desplegado. Para completarla, el conector necesita acceso al proyecto/equipo correcto; no se deshabilitó SSO. La V gris puede proceder de instalar la página de acceso Vercel: comprobar el título `SIGO Vendedor` después de autenticarse antes de instalar.

No se dispone de teléfono Android físico en este entorno. Instalar/reinstalar realmente, verificar WebAPK, actualización del icono y recuperación en ese teléfono quedan pendientes; la corrección de código y CI no acredita estos pasos.
