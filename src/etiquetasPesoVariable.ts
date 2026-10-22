/** Etiquetas de peso/importe variable: decodificación explícita y segura.
 * No adivinar formatos EAN: cada comercio debe configurar prefijo, PLU y escala.
 * No modifica Caja ni Supabase hasta integrar y verificar el flujo completo.
 */
export type FormatoEtiquetaVariable = {
  prefijo: string; // exactamente dos dígitos, p. ej. "20"
  longitudPlu: number;
  tipo: "peso" | "importe" | "unidad";
  divisor: number; // peso: 1000 => gramos a kg; importe: 100 => centavos a pesos
};

export type EtiquetaVariable = {
  plu: string;
  tipo: FormatoEtiquetaVariable["tipo"];
  cantidadOImporte: number;
  codigo: string;
};

function digitoVerificadorEan13(doce: string): number {
  const suma = [...doce].reduce((acc, digito, indice) => acc + Number(digito) * (indice % 2 === 0 ? 1 : 3), 0);
  return (10 - (suma % 10)) % 10;
}

export function decodificarEtiquetaVariable(codigo: string, formato: FormatoEtiquetaVariable): EtiquetaVariable {
  if (!/^\d{13}$/.test(codigo) || !/^\d{2}$/.test(formato.prefijo) || !codigo.startsWith(formato.prefijo)) {
    throw new Error("ETIQUETA_FORMATO_INVALIDO");
  }
  if (!Number.isInteger(formato.longitudPlu) || formato.longitudPlu < 1 || formato.longitudPlu > 9) {
    throw new Error("ETIQUETA_PLU_INVALIDO");
  }
  if (!Number.isFinite(formato.divisor) || formato.divisor <= 0) throw new Error("ETIQUETA_ESCALA_INVALIDA");
  if (digitoVerificadorEan13(codigo.slice(0, 12)) !== Number(codigo[12])) throw new Error("ETIQUETA_CHECKSUM_INVALIDO");
  const plu = codigo.slice(2, 2 + formato.longitudPlu);
  const valor = codigo.slice(2 + formato.longitudPlu, 12);
  if (!valor || !/^\d+$/.test(valor)) throw new Error("ETIQUETA_VALOR_INVALIDO");
  const cantidadOImporte = Number(valor) / formato.divisor;
  if (!Number.isFinite(cantidadOImporte) || cantidadOImporte <= 0) throw new Error("ETIQUETA_VALOR_INVALIDO");
  return { plu, tipo: formato.tipo, cantidadOImporte, codigo };
}
