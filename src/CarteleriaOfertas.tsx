import { useMemo, useState } from "react";
import type { ProductoSigo } from "./productos";

type Props = { productos: ProductoSigo[] };
type FormatoOferta = "a4_4" | "a4_2";

function html(value: unknown) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function dinero(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(Number(valor))) return "";
  return `$ ${Number(valor).toLocaleString("es-AR",{maximumFractionDigits:2})}`;
}

export default function CarteleriaOfertas({ productos }: Props) {
  const [abierto,setAbierto]=useState(false);
  const [busqueda,setBusqueda]=useState("");
  const [productoId,setProductoId]=useState("");
  const [precioOferta,setPrecioOferta]=useState("");
  const [titulo,setTitulo]=useState("OFERTA");
  const [formato,setFormato]=useState<FormatoOferta>("a4_4");
  const [error,setError]=useState("");

  const visibles=useMemo(()=>{
    const q=busqueda.trim().toLowerCase();
    if(!q) return productos.slice(0,80);
    return productos.filter(p=>[p.nombre,p.codigo_barras,p.codigo_interno,p.marca].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0,80);
  },[productos,busqueda]);
  const producto=productos.find(p=>p.id===productoId)??null;

  function elegir(id:string){
    setProductoId(id);
    const p=productos.find(x=>x.id===id);
    setPrecioOferta(p?.precio_venta!=null?String(p.precio_venta):"");
    setError("");
  }

  function imprimir(){
    setError("");
    if(!producto){setError("Seleccioná un producto.");return;}
    const oferta=Number(precioOferta.replace(",","."));
    if(!Number.isFinite(oferta)||oferta<=0){setError("Ingresá un precio de oferta mayor a cero.");return;}
    const cantidad=formato==="a4_4"?4:2;
    const carteles=Array.from({length:cantidad},()=>`<article class="cartel">
      <div class="titulo">${html(titulo.trim()||"OFERTA")}</div>
      <div class="producto">${html(producto.nombre)}</div>
      ${producto.marca?`<div class="marca">${html(producto.marca)}</div>`:""}
      ${Number(producto.precio_venta||0)>0?`<div class="antes">Precio habitual: ${html(dinero(producto.precio_venta))}</div>`:""}
      <div class="precio">${html(dinero(oferta))}</div>
    </article>`).join("");
    const grid=formato==="a4_4"?"grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);":"grid-template-columns:1fr;grid-template-rows:repeat(2,1fr);";
    const ventana=window.open("","_blank","width=980,height=760");
    if(!ventana){setError("El navegador bloqueó la ventana de impresión. Habilitá ventanas emergentes para SIGO.");return;}
    ventana.opener=null;
    ventana.document.open();
    ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SIGO · Ofertas</title><style>
      @page{size:A4 portrait;margin:8mm} *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      html,body{margin:0;padding:0;width:100%;height:100%}.hoja{width:194mm;height:281mm;display:grid;${grid}gap:4mm}
      .cartel{border:2px solid #111;border-radius:4mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:7mm;overflow:hidden;break-inside:avoid}
      .titulo{font-size:${formato==="a4_4"?"28px":"38px"};font-weight:900;letter-spacing:.08em}.producto{font-size:${formato==="a4_4"?"20px":"27px"};font-weight:800;margin-top:5mm;line-height:1.08}.marca{font-size:15px;margin-top:2mm}.antes{font-size:14px;margin-top:5mm;text-decoration:line-through}.precio{font-size:${formato==="a4_4"?"44px":"62px"};font-weight:900;line-height:1;margin-top:4mm}
      @media print{html,body{width:210mm;height:297mm}.hoja{break-after:avoid}}
    </style></head><body><main class="hoja">${carteles}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body></html>`);
    ventana.document.close();
  }

  return <div style={{marginTop:12}}>
    <button className="admin-button" type="button" disabled={productos.length===0} onClick={()=>setAbierto(v=>!v)}>📣 Crear oferta / cartel</button>
    {abierto&&<div className="panel" style={{marginTop:12}}>
      <div className="page-header"><div><h3>Ofertas / Cartelería</h3><p>Creá carteles comerciales sin modificar el precio del producto en SIGO.</p></div></div>
      <div className="form-grid">
        <div className="form-group form-span-2"><label>Buscar producto</label><input type="search" value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Producto, código o marca"/></div>
        <div className="form-group form-span-2"><label>Producto</label><select value={productoId} onChange={e=>elegir(e.target.value)}><option value="">Seleccionar…</option>{visibles.map(p=><option key={p.id} value={p.id}>{p.nombre}{p.precio_venta!=null?` · ${dinero(p.precio_venta)}`:""}</option>)}</select></div>
        <div className="form-group"><label>Título</label><select value={titulo} onChange={e=>setTitulo(e.target.value)}><option>OFERTA</option><option>PROMO</option><option>IMPERDIBLE</option></select></div>
        <div className="form-group"><label>Precio oferta</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={precioOferta} onChange={e=>setPrecioOferta(e.target.value)}/></div>
        <div className="form-group form-span-2"><label>Formato de impresión</label><select value={formato} onChange={e=>setFormato(e.target.value as FormatoOferta)}><option value="a4_4">A4 dividido en 4 · cuatro carteles</option><option value="a4_2">A4 dividido en 2 · dos carteles</option></select></div>
      </div>
      {producto&&<div className="sigo-matriz-success" style={{marginTop:12}}><strong>Vista previa:</strong> {titulo} · {producto.nombre} · {dinero(Number(precioOferta||0))}</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" type="button" disabled={!productoId} onClick={imprimir}>Imprimir carteles</button></div>
    </div>}
  </div>;
}
