import React from "react";
import { createRoot } from "react-dom/client";
import SigoApp from "../../src/SigoApp";
import "../../src/index.css";
import "../../src/barcode-scanner.css";
import "../../src/caja-ventas.css";
import { state } from "./supabase-fixture";

const section = new URLSearchParams(location.search).get("section") as "Productos" | "Stock" | "Ventas";
const empresa = { empresa_id: "00000000-0000-4000-8000-000000000001", empresa_nombre: "QA AISLADA", rol: "seller" } as const;
(window as any).minoristaTest = state;
window.addEventListener("sigo:arca:venta", (event: Event) => state.fiscalEvents.push((event as CustomEvent).detail));
createRoot(document.getElementById("root")!).render(<SigoApp empresa={empresa as any} initialSection={section || "Productos"} />);
