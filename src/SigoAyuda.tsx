import { useMemo, useState } from "react";

type TemaAyuda = {
  id: string;
  icono: string;
  titulo: string;
  resumen: string;
  pasos: string[];
  consejo?: string;
};

const TEMAS: TemaAyuda[] = [
  {
    id: "ingreso",
    icono: "→",
    titulo: "Ingresar y empezar",
    resumen: "Cómo entrar a SIGO, elegir la empresa correcta y comenzar a trabajar.",
    pasos: [
      "Abrí SIGO e ingresá con tu email y contraseña.",
      "Verificá arriba cuál es la Empresa activa antes de vender, comprar o modificar stock.",
      "Si administrás más de una empresa, elegí la correcta desde el selector de Empresa activa.",
      "Usá Actualizar si acabás de recibir un permiso o alta nueva.",
      "Para terminar la sesión usá el botón Salir.",
    ],
    consejo: "Todo movimiento queda asociado a la empresa activa. Revisala antes de confirmar una operación.",
  },
  {
    id: "productos",
    icono: "□",
    titulo: "Productos y códigos",
    resumen: "Alta de productos, precios y búsqueda por código de barras.",
    pasos: [
      "Entrá en Productos y tocá Nuevo producto.",
      "Cargá nombre, categoría, marca y precio de venta.",
      "Ingresá el código de barras si el producto lo tiene. También podés usar un código interno.",
      "El stock actual no se modifica desde la ficha: aumenta por Compras y disminuye por Ventas.",
      "Para consultar un artículo usá Buscar por código con pistola USB/Bluetooth, ingreso manual o cámara del celular.",
    ],
    consejo: "No dupliques códigos. Un mismo código debe identificar un solo producto dentro de la empresa.",
  },
  {
    id: "ventas",
    icono: "$",
    titulo: "Ventas y Caja",
    resumen: "Cómo registrar una venta y dejar correctamente asentado el cobro.",
    pasos: [
      "Entrá en Ventas.",
      "Agregá productos por búsqueda o escaneando su código.",
      "Revisá cantidad, precio y total antes de confirmar.",
      "Elegí el medio de pago: efectivo, débito, crédito, transferencia, Mercado Pago, cuenta corriente u otro.",
      "Confirmá la venta. SIGO descuenta el stock y registra el movimiento de Caja.",
      "Si la venta queda a cuenta corriente, seleccioná el cliente correcto antes de confirmar.",
    ],
    consejo: "No confirmes dos veces una venta si la pantalla tarda. Esperá la respuesta de SIGO para evitar duplicados.",
  },
  {
    id: "stock",
    icono: "≡",
    titulo: "Stock",
    resumen: "Cómo consultar existencias y entender por qué cambia el stock.",
    pasos: [
      "Entrá en Stock para ver existencias de la empresa activa.",
      "El stock aumenta cuando confirmás una compra.",
      "El stock disminuye cuando confirmás una venta.",
      "Usá stock mínimo para detectar productos que necesitan reposición.",
      "Si un número no coincide, revisá primero compras y ventas antes de hacer una corrección manual.",
    ],
    consejo: "SIGO busca mantener trazabilidad: el stock debe moverse por operaciones reales, no editándose libremente.",
  },
  {
    id: "compras",
    icono: "↓",
    titulo: "Compras y Proveedores",
    resumen: "Cómo ingresar mercadería y actualizar costos y stock.",
    pasos: [
      "Entrá en Compras / Proveedores.",
      "Seleccioná un proveedor existente o crealo con razón social y CUIT.",
      "Cargá fecha y número de comprobante.",
      "Agregá los productos, cantidades y costos de compra.",
      "Revisá la compra completa y tocá Confirmar compra e ingresar stock.",
      "Al confirmar, SIGO incrementa stock y actualiza el último costo del producto.",
    ],
    consejo: "No vuelvas a ingresar el mismo comprobante. SIGO protege contra comprobantes duplicados cuando la identidad del documento coincide.",
  },
  {
    id: "factura-ia",
    icono: "✦",
    titulo: "Foto de factura con IA",
    resumen: "Cómo usar una foto o escaneo para cargar una compra más rápido.",
    pasos: [
      "En Compras / Proveedores tocá Escanear factura con IA.",
      "Sacá una foto nítida, de frente y con toda la factura visible, o elegí una imagen JPG, PNG o WebP.",
      "Esperá a que SIGO lea proveedor, CUIT, fecha, comprobante, productos, cantidades y costos.",
      "Revisá la vista previa. SIGO marca qué productos ya existen y cuáles serían nuevos.",
      "Si un producto no existe, SIGO puede crearlo de forma segura antes de ingresar el stock.",
      "Tocá Usar datos de esta factura y, después de revisar, Confirmar compra e ingresar stock.",
    ],
    consejo: "La IA ayuda a cargar, pero vos confirmás. Nunca aceptes una línea mal leída sin corregirla antes de impactar stock.",
  },
  {
    id: "clientes",
    icono: "◎",
    titulo: "Clientes y Cuenta Corriente",
    resumen: "Alta de clientes, ventas a cuenta y seguimiento de deuda.",
    pasos: [
      "Entrá en Clientes / Ctas. corrientes.",
      "Creá el cliente con los datos necesarios para identificarlo correctamente.",
      "En una venta, elegí Cuenta corriente como medio de pago cuando corresponda.",
      "Seleccioná el cliente antes de confirmar la venta.",
      "Consultá luego su saldo e historial para controlar pagos y deuda.",
    ],
    consejo: "Siempre vinculá la venta al cliente correcto antes de confirmar una cuenta corriente.",
  },
  {
    id: "scanner",
    icono: "▥",
    titulo: "Scanner de productos",
    resumen: "Tres formas de leer códigos: pistola, manual y cámara.",
    pasos: [
      "Pistola USB/Bluetooth: conectala como teclado y enfocá el campo de código antes de escanear.",
      "Manual: escribí el código y tocá Consultar precio / stock.",
      "Cámara: desde el celular tocá el botón de cámara y apuntá al código de barras con buena luz.",
      "Cuando SIGO encuentre el producto, verificá nombre, precio y stock antes de usarlo en la operación.",
    ],
    consejo: "Si la cámara no reconoce el código, limpiá el lente, acercate y evitá reflejos sobre el envase.",
  },
  {
    id: "informes",
    icono: "▤",
    titulo: "Informes",
    resumen: "Cómo leer ventas, caja, stock, clientes y compras desde el tablero.",
    pasos: [
      "Entrá en Informes.",
      "Elegí la tarjeta del informe que necesitás.",
      "Revisá siempre que la empresa activa sea la correcta.",
      "Usá los indicadores de ventas, caja, compras, stock y cuentas corrientes para controlar el negocio.",
      "Si un módulo aparece sin datos, verificá primero que existan operaciones confirmadas en el período.",
    ],
  },
  {
    id: "arca",
    icono: "A",
    titulo: "ARCA y Facturación",
    resumen: "Preparación de la empresa para emitir comprobantes electrónicos.",
    pasos: [
      "Abrí ARCA · Facturar.",
      "Completá los datos fiscales de la empresa.",
      "Vinculá el certificado digital y el servicio de facturación correspondiente.",
      "Configurá el punto de venta habilitado.",
      "Cuando la conexión quede validada, SIGO podrá solicitar autorización y CAE desde la operación de venta.",
    ],
    consejo: "SIGO no debe pedir ni guardar tu clave fiscal. La vinculación se realiza mediante certificados y servicios de ARCA.",
  },
  {
    id: "suscripcion",
    icono: "◇",
    titulo: "Prueba gratis y Suscripción",
    resumen: "Cómo funciona la prueba de 15 días y el pago de SIGO.",
    pasos: [
      "Al crear una empresa podés iniciar la Prueba gratis 15 días.",
      "Desde el acceso elegí Suscripción.",
      "Dentro de Suscripción elegí Mercado Pago.",
      "El pago se procesa fuera de SIGO; SIGO no guarda datos de tarjeta.",
      "Cuando el plan de producción esté vinculado, la activación y renovación podrán quedar asociadas al estado del pago.",
    ],
  },
];

export default function SigoAyuda() {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const temas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return TEMAS;
    return TEMAS.filter((tema) =>
      [tema.titulo, tema.resumen, ...tema.pasos, tema.consejo ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [busqueda]);

  return (
    <>
      <button className="sigo-help-launcher" type="button" onClick={() => setOpen(true)} aria-label="Abrir SIGO Ayuda">
        <span className="sigo-help-launcher-icon" aria-hidden="true">?</span>
        <span><strong>SIGO Ayuda</strong><small>Cómo usar la app</small></span>
      </button>

      {open ? (
        <div className="sigo-help-overlay" role="dialog" aria-modal="true" aria-label="SIGO Ayuda">
          <header className="sigo-help-topbar">
            <button type="button" className="admin-button" onClick={() => setOpen(false)}>← Volver</button>
            <div><strong>SIGO Ayuda</strong><small>Guía paso a paso para trabajar con seguridad</small></div>
          </header>

          <main className="sigo-help-content">
            <section className="sigo-help-hero">
              <span className="sigo-help-kicker">CENTRO DE AYUDA</span>
              <h1>Aprendé SIGO paso a paso</h1>
              <p>Desde el ingreso hasta ventas, caja, stock, compras, factura con IA, clientes, scanner, informes y ARCA.</p>
              <label className="sigo-help-search">
                <span>Buscar en la ayuda</span>
                <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Ej.: cómo ingresar una compra" />
              </label>
            </section>

            <section className="sigo-help-quickstart">
              <strong>Ruta recomendada para empezar</strong>
              <div><span>1</span>Ingresar</div><div><span>2</span>Productos</div><div><span>3</span>Compras</div><div><span>4</span>Stock</div><div><span>5</span>Ventas y Caja</div>
            </section>

            <section className="sigo-help-topics" aria-live="polite">
              {temas.length ? temas.map((tema, index) => (
                <details className="sigo-help-topic" key={tema.id} open={!busqueda && index === 0}>
                  <summary>
                    <span className="sigo-help-topic-icon" aria-hidden="true">{tema.icono}</span>
                    <span><strong>{tema.titulo}</strong><small>{tema.resumen}</small></span>
                    <span className="sigo-help-chevron" aria-hidden="true">⌄</span>
                  </summary>
                  <div className="sigo-help-topic-body">
                    <ol>{tema.pasos.map((paso) => <li key={paso}>{paso}</li>)}</ol>
                    {tema.consejo ? <div className="sigo-help-tip"><strong>Importante</strong><span>{tema.consejo}</span></div> : null}
                  </div>
                </details>
              )) : <div className="sigo-help-empty">No encontramos ese tema. Probá con “ventas”, “stock”, “compras”, “scanner” o “ARCA”.</div>}
            </section>

            <section className="sigo-help-support">
              <div>
                <span className="sigo-help-kicker">SOPORTE</span>
                <h2>¿Necesitás ayuda personal?</h2>
                <p>Contactanos y contanos qué estabas intentando hacer y qué mensaje apareció.</p>
              </div>
              <div className="sigo-help-support-actions">
                <a href="tel:+543764252564" className="sigo-help-contact"><span>☎</span><div><small>Teléfono de soporte</small><strong>3764252564</strong></div></a>
                <a href="mailto:sovitelsa@gmail.com" className="sigo-help-contact"><span>✉</span><div><small>Correo de soporte</small><strong>sovitelsa@gmail.com</strong></div></a>
              </div>
            </section>
          </main>
        </div>
      ) : null}
    </>
  );
}
