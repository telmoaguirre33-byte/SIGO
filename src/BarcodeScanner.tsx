import { useEffect, useMemo, useRef, useState } from "react";
import {
  buscarProductoPorCodigo,
  isLegacyDuplicateProduct,
  isLikelyScannerSubmit,
  normalizeBarcode,
  type BarcodeAction,
  type BarcodeProduct,
} from "./barcode";

type Props = {
  empresaId: string;
  action: BarcodeAction;
  onActionChange?: (action: BarcodeAction) => void;
  onProduct: (product: BarcodeProduct, action: BarcodeAction) => void;
  onBlockedProduct?: (product: BarcodeProduct, reason: "precio" | "stock") => void;
};

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type ScanSource = "manual" | "wedge" | "camera";
type QueueableScanSource = Exclude<ScanSource, "camera">;
type ScannerControlsLike = { stop(): void };
type QueuedScan = {
  code: string;
  source: QueueableScanSource;
  empresaId: string;
  action: BarcodeAction;
};

// Cuando el scanner muestra selector de acción (maestro de Productos), sólo exponemos
// acciones que ese contexto ejecuta realmente. Venta y recepción tienen scanners propios
// dentro de sus módulos para evitar botones que aparenten operar y sólo hagan una consulta.
const ACTIONS: Array<{ value: BarcodeAction; label: string }> = [
  { value: "consultar", label: "Consultar precio / stock" },
  { value: "editar", label: "Buscar / editar producto" },
];

const SCANNER_GAP_MS = 90;
const CAMERA_DUPLICATE_GUARD_MS = 1200;
const MAX_PENDING_SCANS = 50;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

export default function BarcodeScanner({
  empresaId,
  action,
  onActionChange,
  onProduct,
  onBlockedProduct,
}: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<ScannerControlsLike | null>(null);
  const scanningRef = useRef(false);
  const inFlightRef = useRef(false);
  const queuedScansRef = useRef<QueuedScan[]>([]);
  const wedgeBufferRef = useRef("");
  const wedgeLastKeyAtRef = useRef(0);
  const lastCameraResolvedRef = useRef<{ code: string; at: number } | null>(null);
  const empresaActivaRef = useRef(empresaId);
  const actionActivaRef = useRef(action);
  const requestRef = useRef(0);

  const detectorCtor = useMemo(() => {
    const w = window as typeof window & { BarcodeDetector?: BarcodeDetectorCtor };
    return w.BarcodeDetector;
  }, []);

  function focusScanner() {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function syncQueuedCount() {
    setQueuedCount(queuedScansRef.current.length);
  }

  function clearQueuedScans() {
    queuedScansRef.current = [];
    syncQueuedCount();
  }

  function takeNextQueuedScan(): QueuedScan | null {
    while (queuedScansRef.current.length > 0) {
      const next = queuedScansRef.current.shift() ?? null;
      if (!next) break;
      if (next.empresaId === empresaActivaRef.current && next.action === actionActivaRef.current) {
        syncQueuedCount();
        return next;
      }
    }
    syncQueuedCount();
    return null;
  }

  async function drainQueuedScans() {
    if (inFlightRef.current) return;
    const next = takeNextQueuedScan();
    if (!next) {
      setBusy(false);
      focusScanner();
      return;
    }
    await processCode(next.code, next.source, next.empresaId, next.action);
  }

  async function processCode(
    normalized: string,
    source: ScanSource,
    empresaOperacion: string,
    actionOperacion: BarcodeAction,
  ) {
    const requestId = ++requestRef.current;
    inFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const matches = await buscarProductoPorCodigo(empresaOperacion, normalized);
      const contextoVigente = empresaActivaRef.current === empresaOperacion
        && actionActivaRef.current === actionOperacion
        && requestRef.current === requestId;
      if (!contextoVigente) return;
      if (matches.length === 0) {
        setError(`No se encontró un producto con el código ${normalized}.`);
        if (source === "camera") setCameraStatus("Código leído, pero no existe en esta empresa.");
        return;
      }
      if (matches.length > 1) {
        setError("El código está duplicado dentro de esta empresa. Revisá el maestro de productos.");
        if (source === "camera") setCameraStatus("Código duplicado. Revisá el maestro de productos.");
        return;
      }

      const producto = matches[0];
      if ((actionOperacion === "vender" || actionOperacion === "ingresar") && isLegacyDuplicateProduct(producto)) {
        const operacion = actionOperacion === "vender" ? "vender" : "ingresar stock";
        setError(`${producto.nombre}: identidad de código pendiente de revisión física. SIGO bloqueó ${operacion} para evitar operar sobre el producto equivocado.`);
        if (source === "camera") setCameraStatus("Código pendiente de revisión física. Operación bloqueada.");
        return;
      }

      if (actionOperacion === "vender") {
        const precio = Number(producto.precio_venta ?? 0);
        if (!Number.isFinite(precio) || precio <= 0) {
          onBlockedProduct?.(producto, "precio");
          setError(`${producto.nombre}: definí un precio de venta mayor a cero antes de vender.`);
          if (source === "camera") setCameraStatus("Producto leído, pero todavía no tiene precio de venta válido.");
          return;
        }
        const stock = Number(producto.stock_actual ?? 0);
        if (!Number.isFinite(stock) || stock <= 0) {
          onBlockedProduct?.(producto, "stock");
          setError(`${producto.nombre}: sin stock disponible para vender.`);
          if (source === "camera") setCameraStatus("Producto leído, pero no tiene stock disponible.");
          return;
        }
      }

      onProduct(producto, actionOperacion);
      if (source === "camera") setCameraStatus(`Listo: ${producto.nombre}`);
      if ("vibrate" in navigator) navigator.vibrate?.(40);
    } catch (e) {
      console.error(e);
      if (
        empresaActivaRef.current === empresaOperacion
        && actionActivaRef.current === actionOperacion
        && requestRef.current === requestId
      ) {
        setError("No se pudo consultar el código. Verificá conexión, permisos y empresa activa.");
      }
    } finally {
      inFlightRef.current = false;
      void drainQueuedScans();
    }
  }

  async function resolveCode(raw: string, source: ScanSource = "manual") {
    const normalized = normalizeBarcode(raw);
    if (!normalized) return;
    const empresaOperacion = empresaId;
    const actionOperacion = action;
    if (!empresaOperacion) {
      setError("Seleccioná una empresa antes de escanear.");
      focusScanner();
      return;
    }

    if (source === "camera") {
      if (inFlightRef.current) return;
      const now = Date.now();
      const previous = lastCameraResolvedRef.current;
      if (previous && previous.code === normalized && now - previous.at < CAMERA_DUPLICATE_GUARD_MS) return;
      lastCameraResolvedRef.current = { code: normalized, at: now };
      setCameraStatus(`Código leído: ${normalized}`);
      await processCode(normalized, source, empresaOperacion, actionOperacion);
      return;
    }

    // Liberamos el campo en el mismo instante en que la pistola/manual envía Enter/Tab.
    // Así una segunda lectura rápida no se concatena con el código anterior mientras
    // la primera consulta todavía está viajando a Supabase.
    setCode("");

    if (inFlightRef.current) {
      if (queuedScansRef.current.length >= MAX_PENDING_SCANS) {
        setError("El scanner recibió demasiadas lecturas pendientes. Esperá a que procese la cola antes de continuar.");
        return;
      }
      queuedScansRef.current.push({
        code: normalized,
        source,
        empresaId: empresaOperacion,
        action: actionOperacion,
      });
      syncQueuedCount();
      setBusy(true);
      return;
    }

    await processCode(normalized, source, empresaOperacion, actionOperacion);
  }

  function stopCamera() {
    scanningRef.current = false;
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastCameraResolvedRef.current = null;
    setCameraOpen(false);
    setCameraStatus("");
    focusScanner();
  }

  function openCamera() {
    setError("");
    setCameraStatus("Abriendo cámara trasera…");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La cámara no está disponible en este dispositivo o contexto. Usá HTTPS o la app instalada.");
      setCameraStatus("");
      return;
    }
    setCameraOpen(true);
  }

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;

    const video = videoRef.current;
    let cancelled = false;
    let nativeTimer: number | undefined;
    scanningRef.current = true;

    async function startNativeFallback() {
      if (!detectorCtor || cancelled) {
        if (!cancelled) {
          setError("El lector de cámara de este navegador no pudo inicializarse. Podés usar pistola o ingreso manual.");
          stopCamera();
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (cancelled || empresaActivaRef.current !== empresaId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        const detector = new detectorCtor();
        await video.play();
        setCameraStatus("Cámara activa. Centrá el código dentro del recuadro.");

        const scanNative = async () => {
          if (!scanningRef.current || cancelled) return;
          try {
            if (!inFlightRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              const results = await detector.detect(video);
              const found = results.map((r) => normalizeBarcode(r.rawValue || "")).find(Boolean);
              if (found) await resolveCode(found, "camera");
            }
          } catch (e) {
            console.debug("BarcodeDetector scan skipped", e);
          }
          nativeTimer = window.setTimeout(scanNative, 220);
        };
        void scanNative();
      } catch (e) {
        console.error("No se pudo iniciar BarcodeDetector", e);
        if (!cancelled) {
          setError("No se pudo abrir la cámara. Revisá el permiso del navegador y volvé a intentar.");
          stopCamera();
        }
      }
    }

    async function startRobustScanner() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          CAMERA_CONSTRAINTS,
          video,
          (result, _scanError, callbackControls) => {
            if (callbackControls) zxingControlsRef.current = callbackControls;
            if (!result || inFlightRef.current || cancelled) return;
            const found = normalizeBarcode(result.getText());
            if (found) void resolveCode(found, "camera");
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        zxingControlsRef.current = controls;
        setCameraStatus("Cámara activa. Centrá el código dentro del recuadro.");
      } catch (e) {
        console.warn("ZXing no pudo iniciar; se prueba lector nativo", e);
        if (!cancelled) void startNativeFallback();
      }
    }

    void startRobustScanner();

    return () => {
      cancelled = true;
      scanningRef.current = false;
      if (nativeTimer) window.clearTimeout(nativeTimer);
      zxingControlsRef.current?.stop();
      zxingControlsRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // El scanner se reinicia deliberadamente sólo al abrir/cerrar cámara o cambiar empresa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, detectorCtor, empresaId]);

  useEffect(() => {
    empresaActivaRef.current = empresaId;
    requestRef.current += 1;
    clearQueuedScans();
    wedgeBufferRef.current = "";
    wedgeLastKeyAtRef.current = 0;
    lastCameraResolvedRef.current = null;
    setCode("");
    setError("");
    if (!inFlightRef.current) setBusy(false);
    if (cameraOpen || streamRef.current || zxingControlsRef.current) stopCamera();
    else if (!inFlightRef.current) focusScanner();
    // El cambio de tenant invalida lecturas y cámara del tenant anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  useEffect(() => {
    actionActivaRef.current = action;
    requestRef.current += 1;
    clearQueuedScans();
    wedgeBufferRef.current = "";
    setCode("");
    setError("");
    if (!inFlightRef.current) {
      setBusy(false);
      focusScanner();
    }
    // Un cambio de acción nunca debe ejecutar lecturas que quedaron en cola para la acción anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  useEffect(() => {
    function handleKeyboardWedge(event: KeyboardEvent) {
      if (cameraOpen || event.ctrlKey || event.metaKey || event.altKey) return;

      const active = document.activeElement as HTMLElement | null;
      const isScannerInput = active === inputRef.current;
      const isEditable = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.tagName === "SELECT" || active?.isContentEditable;
      if (isEditable && !isScannerInput) return;
      if (isScannerInput) return;

      const now = Date.now();
      if (now - wedgeLastKeyAtRef.current > SCANNER_GAP_MS) wedgeBufferRef.current = "";
      wedgeLastKeyAtRef.current = now;

      if (isLikelyScannerSubmit(event.key)) {
        const buffered = normalizeBarcode(wedgeBufferRef.current);
        wedgeBufferRef.current = "";
        if (buffered.length >= 4) {
          event.preventDefault();
          void resolveCode(buffered, "wedge");
        }
        return;
      }

      if (event.key.length === 1) wedgeBufferRef.current += event.key;
    }

    window.addEventListener("keydown", handleKeyboardWedge);
    return () => window.removeEventListener("keydown", handleKeyboardWedge);
  }, [cameraOpen, empresaId, action]);

  useEffect(() => () => {
    scanningRef.current = false;
    clearQueuedScans();
    zxingControlsRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return (
    <section className="barcode-scanner" aria-label="Escáner de código de barras">
      {onActionChange && (
        <div className="barcode-actions" aria-label="Acción del código escaneado">
          {ACTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={action === item.value ? "primary-button" : "admin-button"}
              onClick={() => onActionChange(item.value)}
              aria-pressed={action === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="barcode-entry-row">
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (isLikelyScannerSubmit(e.key)) {
              e.preventDefault();
              void resolveCode(code, "manual");
            }
          }}
          placeholder="Código de barras o interno"
          aria-label="Código de barras o código interno"
        />
        <button className="admin-button" type="button" disabled={busy || !code.trim()} onClick={() => void resolveCode(code, "manual")}>
          {busy ? "Procesando…" : "Buscar"}
        </button>
        {cameraOpen ? (
          <button className="admin-button danger-button" type="button" onClick={stopCamera}>Cerrar cámara</button>
        ) : (
          <button className="primary-button barcode-camera-button" type="button" disabled={busy} onClick={openCamera}>
            📷 Escanear con cámara
          </button>
        )}
      </div>

      <p className="barcode-help">
        Pistola USB/Bluetooth: cada lectura suma una unidad, incluso si escaneás el mismo producto varias veces. También acepta código interno alfanumérico.
      </p>
      {queuedCount > 0 && (
        <p className="barcode-help" role="status" aria-live="polite">
          Lecturas en cola: <strong>{queuedCount}</strong>. SIGO las procesa en orden sin perder unidades.
        </p>
      )}

      {cameraOpen && (
        <div className="camera-scanner-shell">
          <div className="camera-preview-wrap">
            <video ref={videoRef} playsInline muted className="camera-preview" />
            <div className="camera-scan-frame" aria-hidden="true" />
          </div>
          <div className="camera-status" role="status" aria-live="polite">
            <strong>{cameraStatus || "Cámara activa"}</strong>
            <span>Acercá o alejá el producto hasta ver el código completo, nítido y horizontal dentro del recuadro.</span>
          </div>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
