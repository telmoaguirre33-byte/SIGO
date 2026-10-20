import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "./supabase";

type Producto = {
  id: string;
  codigo_interno: string | null;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  marca: string | null;
  proveedor: string | null;
  costo_actual: number | null;
  costo_ultima_compra: number | null;
  precio_venta: number | null;
  margen_ganancia: number | null;
  margen_porcentaje: number | null;
  stock_actual: number | null;
  stock_minimo: number | null;
  stock_maximo: number | null;
};

type Categoria = {
  id: string;
  nombre: string;
  activo: boolean | null;
};

type Marca = {
  id: string;
  nombre: string;
  activo: boolean | null;
};

type ProveedorCatalogo = {
  id: string;
  razon_social: string;
  activo: boolean | null;
};

type Proveedor = {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
};

type Compra = {
  id: string;
  proveedor_id: string | null;
  tipo_comprobante: string | null;
  punto_venta: string | null;
  numero_comprobante: string | null;
  fecha_compra: string | null;
  subtotal: number | null;
  descuento: number | null;
  iva_total: number | null;
  estado: string | null;
  documento_url: string | null;
  origen: string | null;
};

type DetalleCompraForm = {
  tempId: string;
  producto_id: string;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
};

const menuItems = [
  { name: "Inicio", icon: "I" },
  { name: "Productos", icon: "P" },
  { name: "Ventas", icon: "V" },
  { name: "Compras", icon: "C" },
  { name: "Clientes", icon: "CL" },
  { name: "Proveedores", icon: "PR" },
  { name: "Stock", icon: "S" },
  { name: "Informes", icon: "IN" },
];

function App() {
  const [active, setActive] = useState("Inicio");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">C</div>

          <div>
            <strong>COMERCIAL</strong>
            <span>Gestion Comercial</span>
          </div>
        </div>

        <nav className="menu">
          {menuItems.map((item) => (
            <button
              key={item.name}
              className={
                active === item.name
                  ? "menu-item active"
                  : "menu-item"
              }
              onClick={() => setActive(item.name)}
            >
              <span className="menu-icon">{item.icon}</span>
              <span>{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">A</div>

            <div>
              <strong>Administrador</strong>
              <span>Acceso completo</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{active}</h1>
            <p>Gestion Comercial</p>
          </div>

          <div className="topbar-actions">
            <button className="icon-button">
              Avisos
            </button>

            <button className="admin-button">
              Administrador
            </button>
          </div>
        </header>

        <section className="content">
          {active === "Inicio" && <Dashboard />}
          {active === "Productos" && <Products />}
          {active === "Compras" && <Purchases />}
          {active === "Proveedores" && <Suppliers />}

          {active !== "Inicio" &&
            active !== "Productos" &&
            active !== "Compras" &&
            active !== "Proveedores" && (
              <ComingSoon title={active} />
            )}
        </section>
      </main>
    </div>
  );
}

function Dashboard() {
  return (
    <>
      <div className="welcome">
        <div>
          <h2>Bienvenido a Comercial</h2>

          <p>
            Desde aqui podes administrar toda la gestion
            de tu negocio.
          </p>
        </div>

        <button className="primary-button">
          + Nueva venta
        </button>
      </div>

      <div className="stats">
        <Stat
          title="Ventas del dia"
          value="$ 0"
          description="Sin ventas registradas"
        />

        <Stat
          title="Productos"
          value="0"
          description="Catalogo de productos"
        />

        <Stat
          title="Stock bajo"
          value="0"
          description="Productos para reponer"
        />

        <Stat
          title="Clientes"
          value="0"
          description="Clientes registrados"
        />
      </div>
    </>
  );
}

function Products() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [productoEditar, setProductoEditar] =
    useState<Producto | null>(null);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError("");

    const resultado = await supabase
      .from("productos")
      .select("*")
      .order("nombre", { ascending: true });

    if (resultado.error) {
      console.error(resultado.error);
      setError(resultado.error.message);
      setProductos([]);
    } else {
      setProductos((resultado.data || []) as Producto[]);
    }

    setLoading(false);
  }

  async function eliminarProducto(producto: Producto) {
    const confirmar = window.confirm(
      'Seguro que queres eliminar "' +
        producto.nombre +
        '"?'
    );

    if (!confirmar) return;

    setDeletingId(producto.id);

    const resultado = await supabase
      .from("productos")
      .delete()
      .eq("id", producto.id);

    if (resultado.error) {
      console.error(resultado.error);
      window.alert(
        "No se pudo eliminar: " + resultado.error.message
      );
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    await loadProducts();
  }

  const filteredProducts = productos.filter((producto) => {
    const text = [
      producto.nombre,
      producto.codigo_interno || "",
      producto.codigo_barras || "",
      producto.marca || "",
      producto.categoria || "",
      producto.proveedor || "",
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(search.toLowerCase());
  });

  function abrirNuevoProducto() {
    setProductoEditar(null);
    setShowForm(true);
  }

  function abrirEditarProducto(producto: Producto) {
    setProductoEditar(producto);
    setShowForm(true);
  }

  async function productoGuardado() {
    setShowForm(false);
    setProductoEditar(null);
    await loadProducts();
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Productos</h2>
          <p>
            Administra productos, codigos, precios y stock.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={abrirNuevoProducto}
        >
          + Nuevo producto
        </button>
      </div>

      <div className="product-tools">
        <input
          type="search"
          placeholder="Buscar producto, codigo o codigo de barras..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <button
          className="admin-button"
          onClick={loadProducts}
        >
          Actualizar
        </button>
      </div>

      {loading && (
        <div className="panel">
          <p>Cargando productos...</p>
        </div>
      )}

      {!loading && error && (
        <div className="panel">
          <h3>No se pudieron cargar los productos</h3>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && productos.length === 0 && (
        <div className="panel">
          <div className="empty-products">
            <h3>No hay productos cargados</h3>
            <p>Todavia no hay productos registrados.</p>

            <button
              className="primary-button"
              onClick={abrirNuevoProducto}
            >
              + Cargar primer producto
            </button>
          </div>
        </div>
      )}

      {!loading && !error && productos.length > 0 && (
        <div className="panel">
          <div className="table-wrapper">
            <table className="products-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Codigo</th>
                  <th>Codigo de barras</th>
                  <th>Costo</th>
                  <th>Precio venta</th>
                  <th>Stock</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map((producto) => (
                  <tr key={producto.id}>
                    <td>
                      <strong>{producto.nombre}</strong>
                      {producto.marca && (
                        <small>{producto.marca}</small>
                      )}
                    </td>

                    <td>{producto.codigo_interno || "-"}</td>
                    <td>{producto.codigo_barras || "-"}</td>

                    <td>
                      $
                      {Number(
                        producto.costo_actual || 0
                      ).toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>

                    <td>
                      $
                      {Number(
                        producto.precio_venta || 0
                      ).toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </td>

                    <td>{producto.stock_actual || 0}</td>

                    <td>
                      <div style={actionButtonsStyle}>
                        <button
                          type="button"
                          className="admin-button"
                          onClick={() =>
                            abrirEditarProducto(producto)
                          }
                        >
                          Editar
                        </button>

                        <button
                          type="button"
                          style={deleteButtonStyle}
                          disabled={deletingId === producto.id}
                          onClick={() =>
                            eliminarProducto(producto)
                          }
                        >
                          {deletingId === producto.id
                            ? "Eliminando..."
                            : "Eliminar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredProducts.length === 0 && (
              <div className="table-empty">
                No encontramos productos con esa busqueda.
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <ProductForm
          producto={productoEditar}
          onClose={() => {
            setShowForm(false);
            setProductoEditar(null);
          }}
          onSaved={productoGuardado}
        />
      )}
    </div>
  );
}
function ProductForm({
  producto,
  onClose,
  onSaved,
}: {
  producto: Producto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre || "");
  const [codigoInterno, setCodigoInterno] =
    useState(producto?.codigo_interno || "");
  const [codigoBarras, setCodigoBarras] =
    useState(producto?.codigo_barras || "");
  const [categoria, setCategoria] =
    useState(producto?.categoria || "");
  const [marca, setMarca] =
    useState(producto?.marca || "");
  const [proveedor, setProveedor] =
    useState(producto?.proveedor || "");

  const [costo, setCosto] = useState(
    producto?.costo_actual != null
      ? String(producto.costo_actual)
      : ""
  );

  const [precio, setPrecio] = useState(
    producto?.precio_venta != null
      ? String(producto.precio_venta)
      : ""
  );

  const [stock, setStock] = useState(
    producto?.stock_actual != null
      ? String(producto.stock_actual)
      : ""
  );

  const [stockMinimo, setStockMinimo] = useState(
    producto?.stock_minimo != null
      ? String(producto.stock_minimo)
      : ""
  );

  const [categorias, setCategorias] =
    useState<Categoria[]>([]);
  const [marcas, setMarcas] =
    useState<Marca[]>([]);
  const [proveedores, setProveedores] =
    useState<ProveedorCatalogo[]>([]);
  const [loadingCatalogos, setLoadingCatalogos] =
    useState(true);
  const [catalogError, setCatalogError] =
    useState("");
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");

  useEffect(() => {
    cargarCatalogos();
  }, []);

  async function cargarCatalogos() {
    setLoadingCatalogos(true);
    setCatalogError("");

    const [
      resultadoCategorias,
      resultadoMarcas,
      resultadoProveedores,
    ] = await Promise.all([
      supabase
        .from("categorias")
        .select("id,nombre,activo")
        .eq("activo", true)
        .order("nombre", { ascending: true }),

      supabase
        .from("marcas")
        .select("id,nombre,activo")
        .eq("activo", true)
        .order("nombre", { ascending: true }),

      supabase
        .from("proveedores")
        .select("id,razon_social,activo")
        .eq("activo", true)
        .order("razon_social", { ascending: true }),
    ]);

    if (resultadoCategorias.error) {
      setCatalogError(
        "No se pudieron cargar las categorias."
      );
    } else {
      setCategorias(
        (resultadoCategorias.data || []) as Categoria[]
      );
    }

    if (resultadoMarcas.error) {
      setCatalogError(
        "No se pudieron cargar las marcas."
      );
    } else {
      setMarcas(
        (resultadoMarcas.data || []) as Marca[]
      );
    }

    if (resultadoProveedores.error) {
      setCatalogError(
        "No se pudieron cargar los proveedores."
      );
    } else {
      setProveedores(
        (resultadoProveedores.data || []) as ProveedorCatalogo[]
      );
    }

    setLoadingCatalogos(false);
  }

  const costoNumero = Number(costo) || 0;
  const precioNumero = Number(precio) || 0;

  const margenGanancia =
    precioNumero > 0 && costoNumero > 0
      ? precioNumero - costoNumero
      : 0;

  const margenPorcentaje =
    costoNumero > 0
      ? (margenGanancia / costoNumero) * 100
      : 0;

  async function guardarProducto(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!nombre.trim()) {
      setError("El nombre del producto es obligatorio.");
      return;
    }

    setSaving(true);
    setError("");

    const datosProducto = {
      nombre: nombre.trim(),
      codigo_interno: codigoInterno.trim() || null,
      codigo_barras: codigoBarras.trim() || null,
      categoria: categoria || null,
      marca: marca || null,
      proveedor: proveedor || null,
      costo_actual: costo !== "" ? Number(costo) : null,
      costo_ultima_compra:
        costo !== "" ? Number(costo) : null,
      precio_venta:
        precio !== "" ? Number(precio) : null,
      margen_ganancia:
        costo !== "" && precio !== ""
          ? margenGanancia
          : null,
      margen_porcentaje:
        costo !== "" && precio !== ""
          ? margenPorcentaje
          : null,
      stock_actual:
        stock !== "" ? Number(stock) : 0,
      stock_minimo:
        stockMinimo !== ""
          ? Number(stockMinimo)
          : 0,
    };

    const resultado = producto
      ? await supabase
          .from("productos")
          .update(datosProducto)
          .eq("id", producto.id)
      : await supabase
          .from("productos")
          .insert(datosProducto);

    if (resultado.error) {
      setError(resultado.error.message);
      setSaving(false);
      return;
    }

    onSaved();
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <h2>
              {producto
                ? "Editar producto"
                : "Nuevo producto"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
          >
            X
          </button>
        </div>

        <form onSubmit={guardarProducto}>
          <label>Nombre *</label>

          <input
            required
            value={nombre}
            onChange={(e) =>
              setNombre(e.target.value)
            }
            style={inputStyle}
          />

          <label>Codigo interno</label>

          <input
            value={codigoInterno}
            onChange={(e) =>
              setCodigoInterno(e.target.value)
            }
            style={inputStyle}
          />

          <label>Codigo de barras</label>

          <input
            value={codigoBarras}
            onChange={(e) =>
              setCodigoBarras(e.target.value)
            }
            style={inputStyle}
          />

          <label>Categoria</label>

          <select
            value={categoria}
            onChange={(e) =>
              setCategoria(e.target.value)
            }
            style={inputStyle}
            disabled={loadingCatalogos}
          >
            <option value="">
              Seleccionar categoria
            </option>

            {categorias.map((item) => (
              <option
                key={item.id}
                value={item.nombre}
              >
                {item.nombre}
              </option>
            ))}
          </select>

          <label>Marca</label>

          <select
            value={marca}
            onChange={(e) =>
              setMarca(e.target.value)
            }
            style={inputStyle}
            disabled={loadingCatalogos}
          >
            <option value="">
              Seleccionar marca
            </option>

            {marcas.map((item) => (
              <option
                key={item.id}
                value={item.nombre}
              >
                {item.nombre}
              </option>
            ))}
          </select>

          <label>Proveedor</label>

          <select
            value={proveedor}
            onChange={(e) =>
              setProveedor(e.target.value)
            }
            style={inputStyle}
            disabled={loadingCatalogos}
          >
            <option value="">
              Seleccionar proveedor
            </option>

            {proveedores.map((item) => (
              <option
                key={item.id}
                value={item.razon_social}
              >
                {item.razon_social}
              </option>
            ))}
          </select>

          {catalogError && (
            <div style={errorStyle}>
              {catalogError}
            </div>
          )}

          <label>Costo actual</label>

          <input
            type="number"
            step="0.01"
            min="0"
            value={costo}
            onChange={(e) =>
              setCosto(e.target.value)
            }
            style={inputStyle}
          />

          <label>Precio de venta</label>

          <input
            type="number"
            step="0.01"
            min="0"
            value={precio}
            onChange={(e) =>
              setPrecio(e.target.value)
            }
            style={inputStyle}
          />

          {costoNumero > 0 &&
            precioNumero > 0 && (
              <div style={marginBoxStyle}>
                <strong>
                  Margen: $
                  {margenGanancia.toLocaleString(
                    "es-AR",
                    {
                      minimumFractionDigits: 2,
                    }
                  )}
                </strong>

                <span>
                  {" ("}
                  {margenPorcentaje.toFixed(2)}
                  {"%)"}
                </span>
              </div>
            )}

          <label>Stock actual</label>

          <input
            type="number"
            step="0.01"
            min="0"
            value={stock}
            onChange={(e) =>
              setStock(e.target.value)
            }
            style={inputStyle}
          />

          <label>Stock minimo</label>

          <input
            type="number"
            step="0.01"
            min="0"
            value={stockMinimo}
            onChange={(e) =>
              setStockMinimo(e.target.value)
            }
            style={inputStyle}
          />

          {error && (
            <div style={errorStyle}>
              {error}
            </div>
          )}

          <div style={buttonRowStyle}>
            <button
              type="button"
              className="admin-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving
                ? "Guardando..."
                : "Guardar producto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Purchases() {
  const [compras, setCompras] =
    useState<Compra[]>([]);
  const [proveedores, setProveedores] =
    useState<ProveedorCatalogo[]>([]);
  const [productos, setProductos] =
    useState<Producto[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");
  const [showForm, setShowForm] =
    useState(false);

  useEffect(() => {
    cargarCompras();
  }, []);

  async function cargarCompras() {
    setLoading(true);
    setError("");

    const [
      resultadoCompras,
      resultadoProveedores,
      resultadoProductos,
    ] = await Promise.all([
      supabase
        .from("compras")
        .select(
          "id,proveedor_id,tipo_comprobante,punto_venta,numero_comprobante,fecha_compra,subtotal,descuento,iva_total,estado,documento_url,origen"
        )
        .order("fecha_compra", {
          ascending: false,
        }),

      supabase
        .from("proveedores")
        .select("id,razon_social,activo")
        .eq("activo", true)
        .order("razon_social", {
          ascending: true,
        }),

      supabase
        .from("productos")
        .select("*")
        .order("nombre", {
          ascending: true,
        }),
    ]);

    if (resultadoCompras.error) {
      setError(resultadoCompras.error.message);
      setCompras([]);
    } else {
      setCompras(
        (resultadoCompras.data || []) as Compra[]
      );
    }

    if (!resultadoProveedores.error) {
      setProveedores(
        (resultadoProveedores.data || []) as ProveedorCatalogo[]
      );
    }

    if (!resultadoProductos.error) {
      setProductos(
        (resultadoProductos.data || []) as Producto[]
      );
    }

    setLoading(false);
  }

  function nombreProveedor(id: string | null) {
    if (!id) return "-";

    const proveedor = proveedores.find(
      (item) => item.id === id
    );

    return proveedor?.razon_social || "-";
  }

  async function compraGuardada() {
    setShowForm(false);
    await cargarCompras();
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Compras</h2>
          <p>
            Registra compras y actualiza stock y costos.
          </p>
        </div>

        <div style={actionButtonsStyle}>
          <button
            type="button"
            className="admin-button"
            onClick={() =>
              window.alert(
                "El escaneo de factura con IA se conecta en el siguiente paso."
              )
            }
          >
            Escanear factura con IA
          </button>

          <button
            className="primary-button"
            onClick={() =>
              setShowForm(true)
            }
          >
            + Nueva compra
          </button>
        </div>
      </div>

      {loading && (
        <div className="panel">
          <p>Cargando compras...</p>
        </div>
      )}

      {!loading && error && (
        <div className="panel">
          <h3>
            No se pudieron cargar las compras
          </h3>
          <p>{error}</p>
        </div>
      )}

      {!loading &&
        !error &&
        compras.length === 0 && (
          <div className="panel">
            <div className="empty-products">
              <h3>No hay compras cargadas</h3>

              <button
                className="primary-button"
                onClick={() =>
                  setShowForm(true)
                }
              >
                + Cargar primera compra
              </button>
            </div>
          </div>
        )}

      {!loading &&
        !error &&
        compras.length > 0 && (
          <div className="panel">
            <div className="table-wrapper">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Proveedor</th>
                    <th>Comprobante</th>
                    <th>Subtotal</th>
                    <th>IVA</th>
                    <th>Estado</th>
                  </tr>
                </thead>

                <tbody>
                  {compras.map((compra) => (
                    <tr key={compra.id}>
                      <td>
                        {compra.fecha_compra || "-"}
                      </td>

                      <td>
                        {nombreProveedor(
                          compra.proveedor_id
                        )}
                      </td>

                      <td>
                        {[
                          compra.tipo_comprobante,
                          compra.punto_venta,
                          compra.numero_comprobante,
                        ]
                          .filter(Boolean)
                          .join(" ") || "-"}
                      </td>

                      <td>
                        $
                        {Number(
                          compra.subtotal || 0
                        ).toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                        })}
                      </td>

                      <td>
                        $
                        {Number(
                          compra.iva_total || 0
                        ).toLocaleString("es-AR", {
                          minimumFractionDigits: 2,
                        })}
                      </td>

                      <td>
                        {compra.estado || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {showForm && (
        <PurchaseForm
          proveedores={proveedores}
          productos={productos}
          onClose={() =>
            setShowForm(false)
          }
          onSaved={compraGuardada}
        />
      )}
    </div>
  );
}

function PurchaseForm({
  proveedores,
  productos,
  onClose,
  onSaved,
}: {
  proveedores: ProveedorCatalogo[];
  productos: Producto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [tipoComprobante, setTipoComprobante] =
    useState("Factura C");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [numeroComprobante, setNumeroComprobante] =
    useState("");
  const [fechaCompra, setFechaCompra] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [descuento, setDescuento] = useState("0");
  const [ivaTotal, setIvaTotal] = useState("0");
  const [detalles, setDetalles] =
    useState<DetalleCompraForm[]>([
      crearDetalleVacio(),
    ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function crearDetalleVacio(): DetalleCompraForm {
    return {
      tempId:
        Date.now().toString() +
        Math.random().toString(),
      producto_id: "",
      descripcion: "",
      cantidad: "1",
      precio_unitario: "",
    };
  }

  function agregarLinea() {
    setDetalles((actual) => [
      ...actual,
      crearDetalleVacio(),
    ]);
  }

  function eliminarLinea(tempId: string) {
    if (detalles.length === 1) return;

    setDetalles((actual) =>
      actual.filter(
        (item) => item.tempId !== tempId
      )
    );
  }

  function modificarDetalle(
    tempId: string,
    campo: keyof DetalleCompraForm,
    valor: string
  ) {
    setDetalles((actual) =>
      actual.map((item) =>
        item.tempId === tempId
          ? {
              ...item,
              [campo]: valor,
            }
          : item
      )
    );
  }

  function seleccionarProducto(
    tempId: string,
    productoId: string
  ) {
    const producto = productos.find(
      (item) => item.id === productoId
    );

    setDetalles((actual) =>
      actual.map((item) =>
        item.tempId === tempId
          ? {
              ...item,
              producto_id: productoId,
              descripcion:
                producto?.nombre || "",
              precio_unitario:
                producto?.costo_actual != null
                  ? String(
                      producto.costo_actual
                    )
                  : "",
            }
          : item
      )
    );
  }

  const subtotal = detalles.reduce(
    (total, item) => {
      const cantidad =
        Number(item.cantidad) || 0;
      const precio =
        Number(item.precio_unitario) || 0;

      return total + cantidad * precio;
    },
    0
  );

  const descuentoNumero =
    Number(descuento) || 0;

  const ivaNumero =
    Number(ivaTotal) || 0;

  const totalCompra =
    subtotal - descuentoNumero + ivaNumero;

  async function guardarCompra(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setError("");

    if (!proveedorId) {
      setError("Selecciona un proveedor.");
      return;
    }

    const lineasValidas =
      detalles.filter(
        (item) =>
          item.producto_id &&
          Number(item.cantidad) > 0 &&
          Number(item.precio_unitario) >= 0
      );

    if (lineasValidas.length === 0) {
      setError(
        "Agrega por lo menos un producto."
      );
      return;
    }

    if (
      lineasValidas.length !==
      detalles.length
    ) {
      setError(
        "Completa correctamente todos los productos de la compra."
      );
      return;
    }

    setSaving(true);

    const resultadoCompra =
      await supabase
        .from("compras")
        .insert({
          proveedor_id: proveedorId,
          tipo_comprobante:
            tipoComprobante || null,
          punto_venta:
            puntoVenta.trim() || null,
          numero_comprobante:
            numeroComprobante.trim() ||
            null,
          fecha_compra:
            fechaCompra || null,
          subtotal,
          descuento: descuentoNumero,
          iva_total: ivaNumero,
          estado: "confirmada",
          documento_url: null,
          origen: "manual",
        })
        .select("id")
        .single();

    if (resultadoCompra.error) {
      console.error(
        resultadoCompra.error
      );

      setError(
        resultadoCompra.error.message
      );

      setSaving(false);
      return;
    }

    const compraId =
      resultadoCompra.data.id;

    const detalleParaGuardar =
      lineasValidas.map((item) => {
        const cantidad =
          Number(item.cantidad);

        const precio =
          Number(item.precio_unitario);

        return {
          compra_id: compraId,
          producto_id:
            item.producto_id,
          descripcion_factura:
            item.descripcion || null,
          cantidad,
          precio_unitario: precio,
          descuento: 0,
          iva: 0,
          subtotal:
            cantidad * precio,
          estado_match: "manual",
          confianza_match: 1,
        };
      });

    const resultadoDetalle =
      await supabase
        .from("detalle_compras")
        .insert(detalleParaGuardar);

    if (resultadoDetalle.error) {
      console.error(
        resultadoDetalle.error
      );

      setError(
        "La compra se creo, pero hubo un error al guardar el detalle: " +
          resultadoDetalle.error.message
      );

      setSaving(false);
      return;
    }

    const acumulado =
      new Map<
        string,
        {
          cantidad: number;
          costo: number;
        }
      >();

    for (const linea of lineasValidas) {
      const actual =
        acumulado.get(
          linea.producto_id
        );

      const cantidad =
        Number(linea.cantidad);

      const costo =
        Number(
          linea.precio_unitario
        );

      acumulado.set(
        linea.producto_id,
        {
          cantidad:
            (actual?.cantidad || 0) +
            cantidad,
          costo,
        }
      );
    }

    for (const [
      productoId,
      movimiento,
    ] of acumulado.entries()) {
      const producto =
        productos.find(
          (item) =>
            item.id === productoId
        );

      const stockActual =
        Number(
          producto?.stock_actual || 0
        );

      const resultadoProducto =
        await supabase
          .from("productos")
          .update({
            stock_actual:
              stockActual +
              movimiento.cantidad,
            costo_actual:
              movimiento.costo,
            costo_ultima_compra:
              movimiento.costo,
          })
          .eq("id", productoId);

      if (resultadoProducto.error) {
        console.error(
          resultadoProducto.error
        );

        setError(
          "La compra se guardo, pero no se pudo actualizar el stock: " +
            resultadoProducto.error.message
        );

        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div style={modalOverlayStyle}>
      <div
        style={{
          ...modalStyle,
          maxWidth: "1000px",
        }}
      >
        <div style={modalHeaderStyle}>
          <div>
            <h2>Nueva compra</h2>

            <p>
              Carga la factura y los
              productos comprados.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
          >
            X
          </button>
        </div>

        <form onSubmit={guardarCompra}>
          <div style={formGridStyle}>
            <div>
              <label>Proveedor *</label>

              <select
                required
                value={proveedorId}
                onChange={(e) =>
                  setProveedorId(
                    e.target.value
                  )
                }
                style={inputStyle}
              >
                <option value="">
                  Seleccionar proveedor
                </option>

                {proveedores.map(
                  (proveedor) => (
                    <option
                      key={proveedor.id}
                      value={proveedor.id}
                    >
                      {
                        proveedor.razon_social
                      }
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label>
                Tipo comprobante
              </label>

              <select
                value={tipoComprobante}
                onChange={(e) =>
                  setTipoComprobante(
                    e.target.value
                  )
                }
                style={inputStyle}
              >
                <option value="Factura A">
                  Factura A
                </option>

                <option value="Factura B">
                  Factura B
                </option>

                <option value="Factura C">
                  Factura C
                </option>

                <option value="Remito">
                  Remito
                </option>

                <option value="Ticket">
                  Ticket
                </option>
              </select>
            </div>

            <div>
              <label>Punto de venta</label>

              <input
                value={puntoVenta}
                onChange={(e) =>
                  setPuntoVenta(
                    e.target.value
                  )
                }
                style={inputStyle}
                placeholder="0001"
              />
            </div>

            <div>
              <label>
                Numero comprobante
              </label>

              <input
                value={
                  numeroComprobante
                }
                onChange={(e) =>
                  setNumeroComprobante(
                    e.target.value
                  )
                }
                style={inputStyle}
                placeholder="00001234"
              />
            </div>

            <div>
              <label>Fecha</label>

              <input
                type="date"
                value={fechaCompra}
                onChange={(e) =>
                  setFechaCompra(
                    e.target.value
                  )
                }
                style={inputStyle}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: "24px",
            }}
          >
            <div style={sectionHeaderStyle}>
              <div>
                <h3>Productos</h3>

                <p>
                  La cantidad comprada
                  se sumara al stock.
                </p>
              </div>

              <button
                type="button"
                className="admin-button"
                onClick={agregarLinea}
              >
                + Agregar producto
              </button>
            </div>

            {detalles.map(
              (detalle, index) => {
                const importe =
                  (Number(
                    detalle.cantidad
                  ) || 0) *
                  (Number(
                    detalle.precio_unitario
                  ) || 0);

                return (
                  <div
                    key={detalle.tempId}
                    style={
                      purchaseLineStyle
                    }
                  >
                    <div
                      style={
                        purchaseLineNumberStyle
                      }
                    >
                      {index + 1}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minWidth: "220px",
                      }}
                    >
                      <label>
                        Producto
                      </label>

                      <select
                        required
                        value={
                          detalle.producto_id
                        }
                        onChange={(e) =>
                          seleccionarProducto(
                            detalle.tempId,
                            e.target.value
                          )
                        }
                        style={inputStyle}
                      >
                        <option value="">
                          Seleccionar
                        </option>

                        {productos.map(
                          (producto) => (
                            <option
                              key={
                                producto.id
                              }
                              value={
                                producto.id
                              }
                            >
                              {
                                producto.nombre
                              }
                              {producto.codigo_interno
                                ? " - " +
                                  producto.codigo_interno
                                : ""}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div
                      style={{
                        width: "120px",
                      }}
                    >
                      <label>
                        Cantidad
                      </label>

                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={
                          detalle.cantidad
                        }
                        onChange={(e) =>
                          modificarDetalle(
                            detalle.tempId,
                            "cantidad",
                            e.target.value
                          )
                        }
                        style={inputStyle}
                      />
                    </div>

                    <div
                      style={{
                        width: "160px",
                      }}
                    >
                      <label>
                        Costo unitario
                      </label>

                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          detalle.precio_unitario
                        }
                        onChange={(e) =>
                          modificarDetalle(
                            detalle.tempId,
                            "precio_unitario",
                            e.target.value
                          )
                        }
                        style={inputStyle}
                      />
                    </div>

                    <div
                      style={{
                        width: "150px",
                      }}
                    >
                      <label>Subtotal</label>

                      <div
                        style={
                          amountBoxStyle
                        }
                      >
                        $
                        {importe.toLocaleString(
                          "es-AR",
                          {
                            minimumFractionDigits: 2,
                          }
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      style={
                        smallDeleteButtonStyle
                      }
                      onClick={() =>
                        eliminarLinea(
                          detalle.tempId
                        )
                      }
                    >
                      X
                    </button>
                  </div>
                );
              }
            )}
          </div>

          <div style={totalsBoxStyle}>
            <div>
              <label>Descuento</label>

              <input
                type="number"
                min="0"
                step="0.01"
                value={descuento}
                onChange={(e) =>
                  setDescuento(
                    e.target.value
                  )
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label>IVA total</label>

              <input
                type="number"
                min="0"
                step="0.01"
                value={ivaTotal}
                onChange={(e) =>
                  setIvaTotal(
                    e.target.value
                  )
                }
                style={inputStyle}
              />
            </div>

            <div style={summaryStyle}>
              <span>
                Subtotal: $
                {subtotal.toLocaleString(
                  "es-AR",
                  {
                    minimumFractionDigits: 2,
                  }
                )}
              </span>

              <strong>
                Total: $
                {totalCompra.toLocaleString(
                  "es-AR",
                  {
                    minimumFractionDigits: 2,
                  }
                )}
              </strong>
            </div>
          </div>

          {error && (
            <div style={errorStyle}>
              {error}
            </div>
          )}

          <div style={buttonRowStyle}>
            <button
              type="button"
              className="admin-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving
                ? "Guardando compra..."
                : "Confirmar compra"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Suppliers() {
  const [proveedores, setProveedores] =
    useState<Proveedor[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");
  const [search, setSearch] =
    useState("");
  const [showForm, setShowForm] =
    useState(false);
  const [
    proveedorEditar,
    setProveedorEditar,
  ] = useState<Proveedor | null>(null);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    setLoading(true);
    setError("");

    const resultado = await supabase
      .from("proveedores")
      .select(
        "id,razon_social,nombre_fantasia,cuit,telefono,email,direccion"
      )
      .order("razon_social", {
        ascending: true,
      });

    if (resultado.error) {
      setError(
        resultado.error.message
      );
      setProveedores([]);
    } else {
      setProveedores(
        (resultado.data || []) as Proveedor[]
      );
    }

    setLoading(false);
  }

  const filtrados =
    proveedores.filter(
      (proveedor) => {
        const texto = [
          proveedor.razon_social,
          proveedor.nombre_fantasia || "",
          proveedor.cuit || "",
          proveedor.telefono || "",
          proveedor.email || "",
        ]
          .join(" ")
          .toLowerCase();

        return texto.includes(
          search.toLowerCase()
        );
      }
    );

  async function eliminarProveedor(
    proveedor: Proveedor
  ) {
    const confirmar =
      window.confirm(
        'Seguro que queres eliminar "' +
          proveedor.razon_social +
          '"?'
      );

    if (!confirmar) return;

    setDeletingId(proveedor.id);

    const resultado = await supabase
      .from("proveedores")
      .delete()
      .eq("id", proveedor.id);

    if (resultado.error) {
      window.alert(
        "No se pudo eliminar: " +
          resultado.error.message
      );

      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    await cargarProveedores();
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Proveedores</h2>

          <p>
            Administra los proveedores
            del negocio.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => {
            setProveedorEditar(null);
            setShowForm(true);
          }}
        >
          + Nuevo proveedor
        </button>
      </div>

      <div className="product-tools">
        <input
          type="search"
          placeholder="Buscar proveedor..."
          value={search}
          onChange={(e) =>
            setSearch(e.target.value)
          }
        />

        <button
          className="admin-button"
          onClick={cargarProveedores}
        >
          Actualizar
        </button>
      </div>

      {loading && (
        <div className="panel">
          Cargando proveedores...
        </div>
      )}

      {!loading && error && (
        <div className="panel">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="panel">
          <div className="table-wrapper">
            <table className="products-table">
              <thead>
                <tr>
                  <th>Razon social</th>
                  <th>Nombre fantasia</th>
                  <th>CUIT</th>
                  <th>Telefono</th>
                  <th>Email</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filtrados.map(
                  (proveedor) => (
                    <tr
                      key={proveedor.id}
                    >
                      <td>
                        <strong>
                          {
                            proveedor.razon_social
                          }
                        </strong>
                      </td>

                      <td>
                        {proveedor.nombre_fantasia ||
                          "-"}
                      </td>

                      <td>
                        {proveedor.cuit ||
                          "-"}
                      </td>

                      <td>
                        {proveedor.telefono ||
                          "-"}
                      </td>

                      <td>
                        {proveedor.email ||
                          "-"}
                      </td>

                      <td>
                        <div
                          style={
                            actionButtonsStyle
                          }
                        >
                          <button
                            className="admin-button"
                            onClick={() => {
                              setProveedorEditar(
                                proveedor
                              );
                              setShowForm(true);
                            }}
                          >
                            Editar
                          </button>

                          <button
                            style={
                              deleteButtonStyle
                            }
                            disabled={
                              deletingId ===
                              proveedor.id
                            }
                            onClick={() =>
                              eliminarProveedor(
                                proveedor
                              )
                            }
                          >
                            {deletingId ===
                            proveedor.id
                              ? "Eliminando..."
                              : "Eliminar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <SupplierForm
          proveedor={proveedorEditar}
          onClose={() => {
            setShowForm(false);
            setProveedorEditar(null);
          }}
          onSaved={async () => {
            setShowForm(false);
            setProveedorEditar(null);
            await cargarProveedores();
          }}
        />
      )}
    </div>
  );
}

function SupplierForm({
  proveedor,
  onClose,
  onSaved,
}: {
  proveedor: Proveedor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [razonSocial, setRazonSocial] =
    useState(
      proveedor?.razon_social || ""
    );

  const [
    nombreFantasia,
    setNombreFantasia,
  ] = useState(
    proveedor?.nombre_fantasia || ""
  );

  const [cuit, setCuit] =
    useState(proveedor?.cuit || "");

  const [telefono, setTelefono] =
    useState(
      proveedor?.telefono || ""
    );

  const [email, setEmail] =
    useState(proveedor?.email || "");

  const [direccion, setDireccion] =
    useState(
      proveedor?.direccion || ""
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  async function guardarProveedor(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!razonSocial.trim()) {
      setError(
        "La razon social es obligatoria."
      );
      return;
    }

    setSaving(true);
    setError("");

    const datos = {
      razon_social:
        razonSocial.trim(),
      nombre_fantasia:
        nombreFantasia.trim() || null,
      cuit: cuit.trim() || null,
      telefono:
        telefono.trim() || null,
      email: email.trim() || null,
      direccion:
        direccion.trim() || null,
    };

    const resultado = proveedor
      ? await supabase
          .from("proveedores")
          .update(datos)
          .eq("id", proveedor.id)
      : await supabase
          .from("proveedores")
          .insert(datos);

    if (resultado.error) {
      setError(
        resultado.error.message
      );
      setSaving(false);
      return;
    }

    onSaved();
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div>
            <h2>
              {proveedor
                ? "Editar proveedor"
                : "Nuevo proveedor"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
          >
            X
          </button>
        </div>

        <form onSubmit={guardarProveedor}>
          <label>Razon social *</label>

          <input
            required
            value={razonSocial}
            onChange={(e) =>
              setRazonSocial(
                e.target.value
              )
            }
            style={inputStyle}
          />

          <label>Nombre fantasia</label>

          <input
            value={nombreFantasia}
            onChange={(e) =>
              setNombreFantasia(
                e.target.value
              )
            }
            style={inputStyle}
          />

          <label>CUIT</label>

          <input
            value={cuit}
            onChange={(e) =>
              setCuit(e.target.value)
            }
            style={inputStyle}
          />

          <label>Telefono</label>

          <input
            value={telefono}
            onChange={(e) =>
              setTelefono(
                e.target.value
              )
            }
            style={inputStyle}
          />

          <label>Email</label>

          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            style={inputStyle}
          />

          <label>Direccion</label>

          <input
            value={direccion}
            onChange={(e) =>
              setDireccion(
                e.target.value
              )
            }
            style={inputStyle}
          />

          {error && (
            <div style={errorStyle}>
              {error}
            </div>
          )}

          <div style={buttonRowStyle}>
            <button
              type="button"
              className="admin-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving
                ? "Guardando..."
                : "Guardar proveedor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{description}</p>
    </div>
  );
}

function ComingSoon({
  title,
}: {
  title: string;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>

      <p>
        Este modulo se agregara en los
        proximos pasos.
      </p>
    </div>
  );
}

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 1000,
};

const modalStyle: CSSProperties = {
  width: "100%",
  maxWidth: "680px",
  maxHeight: "92vh",
  overflowY: "auto",
  background: "#ffffff",
  color: "#111827",
  borderRadius: "18px",
  padding: "24px",
  boxShadow:
    "0 20px 60px rgba(0,0,0,0.35)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "20px",
  alignItems: "flex-start",
  marginBottom: "22px",
};

const closeButtonStyle: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  borderRadius: "10px",
  width: "38px",
  height: "38px",
  cursor: "pointer",
  fontWeight: 700,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "9px",
  marginTop: "6px",
  marginBottom: "14px",
  boxSizing: "border-box",
  background: "#ffffff",
  color: "#111827",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "20px",
};

const actionButtonsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const deleteButtonStyle: CSSProperties = {
  padding: "9px 12px",
  border: "none",
  borderRadius: "8px",
  background: "#fee2e2",
  color: "#991b1b",
  cursor: "pointer",
};

const smallDeleteButtonStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  border: "none",
  borderRadius: "8px",
  background: "#fee2e2",
  color: "#991b1b",
  cursor: "pointer",
  marginTop: "24px",
};

const marginBoxStyle: CSSProperties = {
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: "10px",
  padding: "12px",
  marginBottom: "14px",
};

const errorStyle: CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "12px",
  borderRadius: "10px",
  marginTop: "12px",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "15px",
  marginBottom: "12px",
};

const purchaseLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  flexWrap: "wrap",
  gap: "10px",
  padding: "14px",
  marginBottom: "10px",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  background: "#f9fafb",
};

const purchaseLineNumberStyle: CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "50%",
  background: "#e5e7eb",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  marginTop: "24px",
};

const amountBoxStyle: CSSProperties = {
  padding: "11px 12px",
  marginTop: "6px",
  borderRadius: "9px",
  background: "#e5e7eb",
  fontWeight: 700,
};

const totalsBoxStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "15px",
  padding: "18px",
  marginTop: "20px",
  background: "#f9fafb",
  borderRadius: "12px",
};

const summaryStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "8px",
  fontSize: "17px",
};

export default App;
