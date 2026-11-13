import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Page introuvable' };

export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="center-card">
        <img src="/logo.png" alt="Exam237" width={88} height={88} />
        <h1>Page introuvable</h1>
        <p>Cette page n’existe pas ou a été déplacée.</p>
        <a className="btn btn-primary btn-lg" href="/">
          Retour à l’accueil
        </a>
      </div>
    </main>
  );
}
