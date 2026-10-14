# Aceptación persistente QA

La autorización del 14/10/2026 prohíbe crear otra base. La revisión posterior a f63593b cambia exclusivamente el arnés de aceptación: cuatro esquemas aislados por revisión dentro de la base PostgreSQL QA existente, con las mismas políticas RLS y sin modificar los datos operativos existentes.

El predeploy comprueba proyecto, entorno, instancia privada, CA TLS e identidad instalada. Ejecuta login firmado para cinco roles, separación de empresas, pedido idempotente, preparación, carga, reparto, entrega, crédito por pedido, venta, stock, Caja y cuenta corriente compartidos. Ejecuta el emisor fiscal existente con transporte WSFE simulado, pérdida de confirmación y conciliación, sin certificados productivos ni llamadas a ARCA. Revoca los usuarios ficticios después de las pruebas.

Se conserva evidencia y filas comerciales en los esquemas propios. Las conexiones se cierran y se abren nuevamente antes de guardar el informe. El endpoint /readiness identifica la revisión exacta y la evidencia persistida. La aceptación aislada no activa empresas reales ni demuestra un CAE real de homologación. Producción y main permanecen fuera del alcance; PR #72 no se fusiona.
