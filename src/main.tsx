import React from "react";
import ReactDOM from "react-dom/client";
import ArcaLauncher from "./ArcaLauncher";
import CarritoLauncher from "./CarritoLauncher";
import ConfiguracionLauncher from "./ConfiguracionLauncher";
import DevolucionesLauncher from "./DevolucionesLauncher";
import IngresosLauncher from "./IngresosLauncher";
import MobileOperationsMenu from "./MobileOperationsMenu";
import LectorCelularLauncher from "./LectorCelularLauncher";
import SigoAyuda from "./SigoAyuda";
import SigoAuthGate from "./SigoAuthGate";
import SigoRoot from "./SigoRoot";
import LectorCelularPage from "./LectorCelularPage";
import PrivacyPolicy from "./PrivacyPolicy";
import "./index.css";
import "./barcode-scanner.css";
import "./premium-mobile.css";
import "./native-app.css";
import "./don-benchmark.css";
import "./arca-facturacion.css";
import "./reports-catalog.css";
import "./ingresos-diarios.css";
import "./caja-ventas.css";
import "./mobile-operations-menu.css";
import "./usuarios-permisos.css";
import "./logout-visible.css";
import "./sigo-ayuda.css";
import "./stock-import.css";
import "./configuracion.css";

const lectorToken = new URLSearchParams(window.location.search).get("lector_token");
const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {normalizedPath === "/politica-de-privacidad" ? <PrivacyPolicy /> : lectorToken ? <LectorCelularPage token={lectorToken} /> : <SigoAuthGate>
      <>
        <SigoRoot />
        <ArcaLauncher />
        <ConfiguracionLauncher />
        <CarritoLauncher />
        <LectorCelularLauncher />
        <DevolucionesLauncher />
        <IngresosLauncher />
        <MobileOperationsMenu />
        <SigoAyuda />
      </>
    </SigoAuthGate>}
  </React.StrictMode>,
);
