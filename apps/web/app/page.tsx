export default function HomePage() {
  return (
    <main className="shell">
      <header className="brand">
        <h1>Euromex Chat</h1>
        <p className="tagline">Comunicación interna privada de Grupo Euromex.</p>
      </header>

      <section className="status">
        <h2>Acceso</h2>
        <p>
          Este chat es solo para miembros autorizados de Grupo Euromex. Para
          entrar necesitas:
        </p>
        <ul>
          <li>
            <strong>Cuenta ya creada:</strong>{" "}
            <a href="/login">iniciar sesión</a>
          </li>
          <li>
            <strong>Código de invitación del admin:</strong>{" "}
            <a href="/enroll">crear cuenta</a>
          </li>
        </ul>
      </section>
    </main>
  );
}
