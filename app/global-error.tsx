'use client';

// Dernier filet de sécurité si la mise en page elle-même ne peut pas s'afficher.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#064b3a',
          color: '#fff',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.4rem' }}>Exam237 rencontre un problème</h1>
          <p style={{ color: '#cfe6dc' }}>Réessaie dans un instant.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 12,
              minHeight: 48,
              padding: '10px 18px',
              border: 0,
              borderRadius: 14,
              background: '#f5c518',
              color: '#3d3200',
              fontWeight: 800,
              fontSize: '1rem',
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
