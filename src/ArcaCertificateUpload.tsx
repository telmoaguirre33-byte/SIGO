import { useState, type FormEvent } from "react";
import { supabase } from "./supabase";

function textoABase64(texto: string) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binario += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binario);
}

async function leerArchivo(file: File) {
  if (file.size > 262_144) throw new Error("El archivo supera el máximo permitido de 256 KB.");
  return file.text();
}

export default function ArcaCertificateUpload({ empresaId, onUploaded }: { empresaId: string; onUploaded?: () => void }) {
  const [certificado, setCertificado] = useState<File | null>(null);
  const [clavePrivada, setClavePrivada] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [resetKey, setResetKey] = useState(0);

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setError("");
    setOk("");
    if (!certificado || !clavePrivada) {
      setError("Seleccioná el certificado X.509 y su clave privada correspondiente.");
      return;
    }

    setBusy(true);
    try {
      const [{ data: sessionData }, certificadoPem, clavePrivadaPem] = await Promise.all([
        supabase.auth.getSession(),
        leerArchivo(certificado),
        leerArchivo(clavePrivada),
      ]);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("La sesión venció. Volvé a ingresar a SIGO.");

      const response = await fetch("/api/arca/certificate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          empresaId,
          certificadoBase64: textoABase64(certificadoPem),
          clavePrivadaBase64: textoABase64(clavePrivadaPem),
          passphrase: passphrase || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = String(payload?.error || "");
        if (code === "ARCA_CONFIG_REQUIRED") throw new Error("Primero guardá CUIT y ambiente en Datos de facturación.");
        if (code === "CERTIFICADO_CLAVE_NO_COINCIDEN") throw new Error("El certificado y la clave privada no corresponden al mismo par criptográfico.");
        if (code === "CERTIFICADO_VENCIDO") throw new Error("El certificado está vencido. Generá o vinculá uno vigente en ARCA.");
        if (code === "CERTIFICADO_O_CLAVE_NO_LEGIBLE") throw new Error("No se pudo leer el certificado o la clave privada. Revisá formato PEM y contraseña.");
        throw new Error("No se pudo guardar el certificado de forma segura.");
      }

      setOk(`Certificado vinculado. Vence: ${payload.vence ? new Date(payload.vence).toLocaleDateString("es-AR") : "fecha no informada"}.`);
      setCertificado(null);
      setClavePrivada(null);
      setPassphrase("");
      setResetKey((value) => value + 1);
      onUploaded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular el certificado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel arca-card arca-certificate-card">
      <div className="panel-header">
        <div>
          <h3>Certificado digital de ARCA</h3>
          <p>Subí el certificado X.509 y su clave privada. Se guardan en almacenamiento privado aislado por empresa.</p>
        </div>
      </div>

      <form className="form-grid" onSubmit={enviar} key={resetKey}>
        <div className="form-group form-span-2">
          <label>Certificado X.509 *</label>
          <input
            type="file"
            accept=".pem,.crt,.cer,application/x-pem-file,text/plain"
            onChange={(event) => setCertificado(event.target.files?.[0] ?? null)}
            required
          />
          <small>Ej.: certificate.pem o certificado.crt. Máximo 256 KB.</small>
        </div>
        <div className="form-group form-span-2">
          <label>Clave privada *</label>
          <input
            type="file"
            accept=".pem,.key,application/x-pem-file,text/plain"
            onChange={(event) => setClavePrivada(event.target.files?.[0] ?? null)}
            required
          />
          <small>La clave privada nunca se guarda en arca_config ni se muestra después de cargarla.</small>
        </div>
        <div className="form-group form-span-2">
          <label>Contraseña de la clave privada</label>
          <input
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Sólo si tu archivo .key está cifrado"
          />
          <small>Se usa únicamente para validar la carga y no se almacena.</small>
        </div>
        <div className="form-actions form-span-2">
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Validando y guardando…" : "Vincular certificado seguro"}</button>
        </div>
      </form>

      <div className="arca-security-note">
        <strong>No ingreses tu clave fiscal.</strong>
        <span>SIGO sólo necesita certificado + clave privada del certificado para WSAA. La clave fiscal permanece exclusivamente en ARCA.</span>
      </div>
      {ok ? <p className="sigo-matriz-success" role="status">{ok}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
