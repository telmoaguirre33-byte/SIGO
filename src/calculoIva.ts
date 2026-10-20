export type AjusteFiscal = {
  debitoFiscal: number;
  creditoFiscalComputable: number;
  retencionesComputables: number;
  percepcionesComputables: number;
  saldoAFavorAnterior: number;
  otrosAjustes: number;
  conciliado: boolean;
};

export type ResultadoIva = {
  debitoFiscal: number;
  creditoFiscalComputable: number;
  saldoTecnico: number;
  importeEstimado: number | null;
  saldoAFavorEstimado: number | null;
};

function importe(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error("IMPORTE_FISCAL_INVALIDO");
  return Math.round(n * 100) / 100;
}

export function calcularPosicionIva(datos: AjusteFiscal): ResultadoIva {
  const debitoFiscal = importe(datos.debitoFiscal);
  const creditoFiscalComputable = importe(datos.creditoFiscalComputable);
  const retenciones = importe(datos.retencionesComputables);
  const percepciones = importe(datos.percepcionesComputables);
  const saldoAnterior = importe(datos.saldoAFavorAnterior);
  if (!Number.isFinite(datos.otrosAjustes) || Math.abs(datos.otrosAjustes) > 1e12) throw new Error("AJUSTE_FISCAL_INVALIDO");
  const saldoTecnico = Math.round((debitoFiscal - creditoFiscalComputable) * 100) / 100;
  if (!datos.conciliado) return { debitoFiscal, creditoFiscalComputable, saldoTecnico, importeEstimado: null, saldoAFavorEstimado: null };
  const saldo = Math.round((saldoTecnico - retenciones - percepciones - saldoAnterior + datos.otrosAjustes) * 100) / 100;
  return {
    debitoFiscal, creditoFiscalComputable, saldoTecnico,
    importeEstimado: Math.max(0, saldo),
    saldoAFavorEstimado: Math.max(0, -saldo),
  };
}
