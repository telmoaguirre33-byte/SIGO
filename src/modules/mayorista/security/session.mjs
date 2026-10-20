/** Contrato independiente. El proveedor debe verificar la sesión en servidor.
 * No consume identidades demo ni acepta user_metadata como autorización. */
export class SessionMayorista {
  #provider; #principal = null; #epoch = 0; #now;
  constructor(provider, now = Date.now) { this.#provider = provider; this.#now = now; }
  async login(credentials) {
    const epoch = ++this.#epoch;
    this.#principal = null;
    if (!this.#provider?.signIn || !this.#provider?.validateSession) throw new Error('Autenticación Mayorista no configurada');
    const session = await this.#provider.signIn(credentials);
    const principal = await this.#provider.validateSession(session);
    if (epoch !== this.#epoch) throw new Error('La sesión cambió durante el inicio');
    if (!principal?.userId || !principal?.sessionId || !principal?.empresaId || !principal?.vendedorId ||
        principal.anonymous || principal.revoked || !Number.isFinite(principal.expiresAt) || principal.expiresAt <= this.#now() ||
        !Array.isArray(principal.permissions)) throw new Error('Sesión no autorizada');
    this.#principal = structuredClone(principal);
    return this.principal();
  }
  principal() {
    if (!this.#principal || this.#principal.expiresAt <= this.#now()) { this.#principal = null; throw new Error('Sesión cerrada o vencida'); }
    return structuredClone(this.#principal);
  }
  authorize(permission, empresaId) {
    const p = this.principal();
    if (p.empresaId !== empresaId || !p.permissions.includes(permission)) throw new Error('Sin permisos para esta empresa');
    return p;
  }
  async logout() {
    ++this.#epoch;
    this.#principal = null;
    // El acceso local se cierra aun si la revocación remota falla. Propagar el fallo para reintentar.
    await this.#provider?.signOut?.();
  }
}
