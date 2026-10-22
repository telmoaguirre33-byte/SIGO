export function fechaLocalIso(fecha = new Date()): string {
  return `${fecha.getFullYear().toString().padStart(4, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}
