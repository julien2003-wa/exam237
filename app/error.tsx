'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="center-screen">
      <div className="center-card">
        <img src="/logo.png" alt="Exam237" width={88} height={88} />
        <h1>Oups, un souci est survenu</h1>
        <p>Ce n’est pas de ta faute. Vérifie ta connexion, puis réessaie.</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={reset}>
          Réessayer
        </button>
        <a className="text-link" href="/">
          Retour à l’accueil
        </a>
      </div>
    </main>
  );
}
