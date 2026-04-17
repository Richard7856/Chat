export default function HomePage() {
  return (
    <main className="shell">
      <header className="brand">
        <h1>Euromex Chat</h1>
        <p className="tagline">Comunicación interna privada de Grupo Euromex.</p>
      </header>

      <section className="status">
        <h2>Estado del proyecto</h2>
        <p>
          Fase 1 — Fundación. Monorepo inicializado, infraestructura local
          lista (Postgres + Redis), API con healthcheck, web shell desplegado.
          Las siguientes fases añaden autenticación por invitación, enrollment
          de dispositivos y mensajería E2EE.
        </p>
        <p>
          Para el estado detallado y decisiones técnicas consulta{" "}
          <code>desicion.md</code> en la raíz del repo.
        </p>
      </section>
    </main>
  );
}
