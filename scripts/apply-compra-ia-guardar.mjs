import fs from 'node:fs';
const path = 'src/ComprasOperativas.tsx';
let source = fs.readFileSync(path, 'utf8');
const marker = '/* compra-ia-guardar-atomico-v1 */';
if (source.includes(marker)) { console.log('Compra IA guardar: already applied'); process.exit(0); }
function replace(before, after, count = 1) {
  const found = source.split(before).length - 1;
  if (found !== count) throw new Error(`Compra IA guardar: expected ${count} anchors, found ${found}: ${before.slice(0,100)}`);
  source = source.split(before).join(after);
}
replace('import BarcodeScanner from "./BarcodeScanner";', `import BarcodeScanner from "./BarcodeScanner";\nimport GuardarCompraIA from "./GuardarCompraIA";\n${marker}`);
replace('  const [facturaAplicando, setFacturaAplicando] = useState(false);', '  const [facturaAplicando, setFacturaAplicando] = useState(false);\n  const [guardadoPendienteIA, setGuardadoPendienteIA] = useState(false);');
replace('    setNuevoCuit("");\n    setUltimaConciliacion(null);', '    setNuevoCuit("");\n    setUltimaConciliacion(null);\n    setFacturaAplicando(false);\n    setGuardadoPendienteIA(false);');
replace('        if (b?.facturaIA) {', '        if (b?.facturaIA) {\n          idempotencyKeyRef.current = typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey : nuevaClave();');
replace('compraPreparadaIA,guardadoEn:', 'compraPreparadaIA,idempotencyKey:idempotencyKeyRef.current,guardadoEn:', 2);
replace('      setFacturaIA(resultado);', '      idempotencyKeyRef.current = nuevaClave();\n      setFacturaIA(resultado);');
replace('codigoInterno: (codigosInternosFactura[index] ?? item.codigo ?? "").trim() || null,', 'codigoInterno: existente?.codigo_interno ?? ((codigosInternosFactura[index] ?? item.codigo ?? "").trim() || null),');
replace('codigoBarras: (codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim() || null,', 'codigoBarras: existente?.codigo_barras ?? ((codigosBarrasFactura[index] ?? item.codigo_barras ?? "").trim() || null),');
replace('{existente ? (item.codigo_barras ?? item.codigo ?? "-")', '{existente ? (existente.codigo_interno ?? existente.codigo_barras ?? "Código interno automático")');
replace('Código de barras / EAN (recomendado)', 'Código de barras (opcional)');
replace('Falta código de barras. Podés completarlo ahora o continuar sin EAN.', 'El código de barras es opcional. SIGO usará el código interno o generará uno al guardar.');
replace('          <div style={{ marginTop: 16 }}>\n            <div className="form-grid">', '          <div style={{ marginTop: 16 }}>\n            <fieldset disabled={facturaAplicando || guardadoPendienteIA || saving} style={{border:0,padding:0,minWidth:0}}>\n            <div className="form-grid">');
replace('            {compraPreparadaIA && <div className="panel"', '            </fieldset>\n            {compraPreparadaIA && <div className="panel"');
replace('Los cambios definitivos quedan reservados para “Confirmar compra e ingresar stock”.', 'Al presionar “Guardar compra” se registrarán la compra y el ingreso de stock, sin exigir código de barras.');
// Disable draft replacement/cancellation while the outcome of a submitted request is unknown.
source = source.replaceAll('facturaProcesando || facturaAplicando || saving}', 'facturaProcesando || facturaAplicando || saving || guardadoPendienteIA}');
source = source.replaceAll('facturaAplicando || facturaProcesando || saving}', 'facturaAplicando || facturaProcesando || saving || guardadoPendienteIA}');
replace('disabled={!facturaIA || facturaProcesando} onClick={()=>setCorreccionFacturaAbierta(true)}', 'disabled={!facturaIA || facturaProcesando || facturaAplicando || guardadoPendienteIA} onClick={()=>setCorreccionFacturaAbierta(true)}');
replace('<button type="button" className="primary-button" disabled={facturaAplicando || facturaProcesando || saving || guardadoPendienteIA} onClick={aplicarFacturaAnalizada}>{facturaAplicando ? "Preparando compra…" : "🛒 PREPARAR COMPRA"}</button>', `<GuardarCompraIA empresaId={empresaId} idempotencyKey={idempotencyKeyRef.current}
                factura={facturaIA} productos={productos} vinculos={vinculosFactura} barras={codigosBarrasFactura}
                codigos={codigosInternosFactura} precios={preciosVentaFactura} margenes={margenesFactura}
                disabled={facturaProcesando || saving} onAntesGuardar={guardarBorradorIA}
                onEstado={setFacturaAplicando} onPendiente={setGuardadoPendienteIA} onError={setError}
                onGuardada={(compraId, resultado) => {
                  localStorage.removeItem(borradorKey);
                  setUltimaConciliacion({compraId,resultado});
                  setFacturaIA(null);setCompraPreparadaIA(null);setRevisionFacturaAbierta(false);setCorreccionFacturaAbierta(false);
                  setPreciosVentaFactura({});setMargenesFactura({});setCodigosBarrasFactura({});setCodigosInternosFactura({});setVinculosFactura({});
                  setLineas([nuevaLinea()]);setNumero("");setOrigenCompra("manual");setFacturaAplicando(false);setGuardadoPendienteIA(false);
                  idempotencyKeyRef.current=nuevaClave();
                  setFacturaMensaje("✅ COMPRA GUARDADA. Se registraron la compra y el ingreso de stock.");
                  void cargar(empresaId);
                }} />`);
fs.writeFileSync(path, source);
console.log('Compra IA guardar: applied');
