import { supabase } from "./supabase";

export type EstadoModuloSigo = "operativo" | "bloqueado" | "no_disponible";

export type SaludModuloSigo = {
  modulo: string;
  estado: EstadoModuloSigo;
  detalle: string;
};

export type SaludOperativaSigo = {
  estado: "operativo" | "parcial" | "bloqueado";
  operativos: number;
  total: number;
  modulos: SaludModuloSigo[];
  verificadoEn: string;
};

type Probe = {
  modulo: string;
  tabla: string;
};

const probes: Probe[] = [
  { modulo: "Productos / Stock", tabla: "productos" },
  { modulo: "Ventas / Caja", tabla: "ventas_sigo" },
  { modulo: "Clientes / Ctas. corrientes", tabla: "clientes_sigo" },
  { modulo: "Compras / Proveedores", tabla: "compras_sigo" },
  { modulo: "Caja", tabla: "caja_movimientos_sigo" },
];

function clasificarError(message: string): Pick<SaludModuloSigo, "estado" | "detalle"> {
  const texto = message.toLowerCase();

  if (
    texto.includes("does not exist") ||
    texto.includes("could not find the table") ||
    texto.includes("could not find the function") ||
    texto.includes("schema cache") ||
    (texto.includes("relation") && texto.includes("does not exist"))
  ) {
    return {
      estado: "no_disponible",
      detalle: "Falta aplicar o refrescar la migración correspondiente en Supabase.",
    };
  }

  if (
    texto.includes("permission denied") ||
    texto.includes("row-level security") ||
    texto.includes("not authorized") ||
    texto.includes("jwt") ||
    texto.includes("auth_required")
  ) {
    return {
      estado: "bloqueado",
      detalle: "La estructura existe, pero la sesión o los permisos no permiten validarla.",
    };
  }

  return {
    estado: "bloqueado",
    detalle: message || "No se pudo validar este módulo.",
  };
}

async function probarTabla(probe: Probe, empresaId: string): Promise<SaludModuloSigo> {
  const { error } = await supabase
    .from(probe.tabla)
    .select("empresa_id", { head: true, count: "exact" })
    .eq("empresa_id", empresaId)
    .limit(1);

  if (!error) {
    return {
      modulo: probe.modulo,
      estado: "operativo",
      detalle: "Tabla accesible para la empresa activa.",
    };
  }

  const clasificacion = clasificarError(error.message);
  return { modulo: probe.modulo, ...clasificacion };
}

async function probarCodigoBarras(empresaId: string): Promise<SaludModuloSigo> {
  const { error } = await supabase.rpc("buscar_producto_codigo_sigo", {
    p_empresa_id: empresaId,
    p_codigo: "__SIGO_HEALTHCHECK_NO_MATCH__",
  });

  if (!error) {
    return {
      modulo: "Código de barras",
      estado: "operativo",
      detalle: "Lookup tenant-aware disponible para pistola, ingreso manual y cámara.",
    };
  }

  const clasificacion = clasificarError(error.message);
  return { modulo: "Código de barras", ...clasificacion };
}

export async function verificarSaludOperativaSigo(empresaId: string): Promise<SaludOperativaSigo> {
  if (!empresaId) throw new Error("No hay una empresa activa para validar.");

  const modulos = await Promise.all([
    ...probes.map((probe) => probarTabla(probe, empresaId)),
    probarCodigoBarras(empresaId),
  ]);
  const operativos = modulos.filter((modulo) => modulo.estado === "operativo").length;
  const noDisponibles = modulos.filter((modulo) => modulo.estado === "no_disponible").length;

  return {
    estado: operativos === modulos.length ? "operativo" : noDisponibles > 0 ? "bloqueado" : "parcial",
    operativos,
    total: modulos.length,
    modulos,
    verificadoEn: new Date().toISOString(),
  };
}
