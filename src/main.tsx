import React from "react";
import ReactDOM from "react-dom/client";
import ArcaLauncher from "./ArcaLauncher";
import ConfiguracionLauncher from "./ConfiguracionLauncher";
import IngresosLauncher from "./IngresosLauncher";
import SigoAyuda from "./SigoAyuda";
import SigoAuthGate from "./SigoAuthGate";
import SigoRoot from "./SigoRoot";
import "./index.css";
import "./barcode-scanner.css";
import "./premium-mobile.css";
import "./native-app.css";
import "./don-benchmark.css";
import "./arca-facturacion.css";
import "./reports-catalog.css";
import "./ingresos-diarios.css";
import "./logout-visible.css";
import "./sigo-ayuda.css";
import "./configuracion.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SigoAuthGate>
      <>
        <SigoRoot />
        <ArcaLauncher />
        <ConfiguracionLauncher />
        <IngresosLauncher />
        <SigoAyuda />
      </>
    </SigoAuthGate>
  </React.StrictMode>
);
