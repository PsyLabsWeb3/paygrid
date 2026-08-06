"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useCanaryAuth } from "@/contexts/canary-auth";
import {
  addRipioFiatAccount,
  createRipioCanary,
  getRipioCanary,
  getRipioProfile,
  releaseRipioCanary,
  startRipioOfframpSession,
  startRipioProfile,
  type RipioCanaryRun,
  type RipioProfile,
} from "@/lib/api";

const progress = [
  ["WAITING_SPEI", "Esperando SPEI"], ["MXN_RECEIVED", "MXN recibido"],
  ["TRADE_COMPLETED", "Convertido"], ["WITHDRAWAL_PROCESSING", "wMXN en camino"],
  ["READY_FOR_RELEASE", "Listo para liberar"], ["RELEASED", "Enviado a retiro"],
  ["OFFRAMP_DEPOSIT_RECEIVED", "Ripio recibió wMXN"], ["OFFRAMP_TRADE_COMPLETED", "Conversión a MXN"],
  ["OFFRAMP_WITHDRAWAL_PROCESSING", "SPEI en camino"], ["COMPLETED", "SPEI completado"],
] as const;

function valueFrom(instructions: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = instructions[name];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "—";
}

export function RipioCanaryDashboard() {
  const auth = useCanaryAuth();
  const [profile, setProfile] = useState<RipioProfile | null>(null);
  const [run, setRun] = useState<RipioCanaryRun | null>(null);
  const [email, setEmail] = useState("");
  const [clabe, setClabe] = useState("");
  const [amount, setAmount] = useState("100");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const withToken = useCallback(async <T,>(operation: (token: string) => Promise<T>) => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Inicia sesión para continuar");
    return operation(token);
  }, [auth]);

  const refreshProfile = useCallback(async () => {
    const result = await withToken(getRipioProfile);
    setProfile(result.profile);
  }, [withToken]);

  useEffect(() => {
    if (auth.authenticated) void refreshProfile().catch((error) => toast.error(error.message));
  }, [auth.authenticated, refreshProfile]);

  useEffect(() => {
    if (!run || ["COMPLETED", "FAILED", "REFUNDED"].includes(run.status)) return;
    const timer = window.setInterval(() => {
      void withToken((token) => getRipioCanary(token, run.id)).then(setRun).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [run, withToken]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo completar"); }
    finally { setBusy(false); }
  };

  const currentIndex = useMemo(() => run ? progress.findIndex(([status]) => status === run.status) : -1, [run]);

  if (!auth.configured) return <section className="surface"><h2>Configuración pendiente</h2><p className="muted">Agrega NEXT_PUBLIC_PRIVY_APP_ID para habilitar esta pantalla privada.</p></section>;
  if (!auth.ready) return <section className="surface"><p className="muted">Preparando acceso seguro…</p></section>;
  if (!auth.authenticated) return <button className="primary-button" onClick={auth.login}><LogIn size={19} /> Iniciar sesión</button>;

  return (
    <div className="stack-lg">
      <section className="surface stack">
        <div className="section-heading"><div><span className="eyebrow">Paso 1</span><h2>Verificación Ripio</h2></div><ShieldCheck size={22} /></div>
        {!profile?.customerCreated && <><label className="label">Correo</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><button disabled={busy || !email} className="primary-button" onClick={() => void act(async () => { const result = await withToken((token) => startRipioProfile(token, { email, redirectUrl: `${location.origin}/ripio-canary` })); setProfile(result.profile); if (result.kycUrl) location.href = result.kycUrl; })}>Empezar verificación</button></>}
        {profile?.customerCreated && <div className="metric-grid"><div className="metric"><span className="muted fine">Identidad</span><strong>{profile.kycStatus}</strong></div><div className="metric"><span className="muted fine">Cuenta SPEI</span><strong>{profile.fiatAccountStatus}</strong></div></div>}
        {profile?.customerCreated && profile.kycStatus !== "COMPLETED" && <button className="secondary-button" disabled={busy} onClick={() => void act(refreshProfile)}><RefreshCw size={18} /> Actualizar estado</button>}
      </section>

      {profile?.kycStatus === "COMPLETED" && <section className="surface stack"><span className="eyebrow">Paso 2</span><h2>Cuenta de depósito SPEI</h2><p className="muted fine">La CLABE se envía directamente a Ripio. Paygrid solo conserva sus últimos cuatro dígitos y una huella no reversible.</p>{!profile.clabeLast4 ? <><label className="label">CLABE de 18 dígitos</label><input className="input" inputMode="numeric" maxLength={18} value={clabe} onChange={(e) => setClabe(e.target.value.replace(/\D/g, ""))} /><button className="primary-button" disabled={busy || clabe.length !== 18} onClick={() => void act(async () => { const result = await withToken((token) => addRipioFiatAccount(token, clabe)); setClabe(""); setProfile(result.profile); })}>Registrar cuenta</button></> : <p><CheckCircle2 size={17} style={{ display: "inline" }} /> Cuenta terminada en {profile.clabeLast4}</p>}{profile.clabeLast4 && profile.fiatAccountStatus !== "ENABLED" && <button className="secondary-button" disabled={busy} onClick={() => void act(refreshProfile)}><RefreshCw size={18} /> Consultar aprobación</button>}{profile.fiatAccountStatus === "ENABLED" && !profile.offrampReady && <button className="primary-button" disabled={busy} onClick={() => void act(async () => setProfile((await withToken(startRipioOfframpSession)).profile))}>Preparar retiro</button>}</section>}

      {profile?.offrampReady && !run && <section className="surface stack"><span className="eyebrow">Paso 3</span><h2>Canary de hasta 100 MXN</h2><label className="label">Monto exacto en MXN</label><input className="input amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><p className="muted fine">Fee observado requerido: 1 bp (0.01%). Para 100 wMXN: 0.01 a tesorería y 99.99 al retiro.</p><button className="primary-button" disabled={busy || !amount} onClick={() => void act(async () => setRun(await withToken((token) => createRipioCanary(token, amount))))}>Crear prueba SPEI</button></section>}

      {run && <section className="surface stack"><span className="eyebrow">Prueba {run.id.slice(0, 8)}</span><h2>{run.fiatAmount} MXN → {run.grossAmount ?? "…"} wMXN</h2><div className="metric-grid"><div className="metric"><span className="muted fine">CLABE de fondeo</span><strong>{valueFrom(run.fundingInstructions, ["clabe", "clabe_destination", "destinationClabe"])}</strong></div><div className="metric"><span className="muted fine">Referencia</span><strong>{valueFrom(run.fundingInstructions, ["reference", "concept", "trackingReference"])}</strong></div></div><ol className="canary-progress">{progress.map(([status, label], index) => <li key={status} className={index <= currentIndex ? "done" : ""}>{label}</li>)}</ol>{run.status === "READY_FOR_RELEASE" && <><label className="label">Confirmación del operador</label><input className="input" value={confirmation} placeholder={`RELEASE ${run.id}`} onChange={(e) => setConfirmation(e.target.value)} /><button className="primary-button" disabled={busy || confirmation !== `RELEASE ${run.id}`} onClick={() => void act(async () => setRun(await withToken((token) => releaseRipioCanary(token, run.id, confirmation))))}>Liberar manualmente</button></>}<button className="secondary-button" onClick={() => void act(async () => setRun(await withToken((token) => getRipioCanary(token, run.id))))}><RefreshCw size={18} /> Actualizar</button></section>}
    </div>
  );
}
