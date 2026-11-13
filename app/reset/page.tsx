'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';

// Page ouverte depuis le lien envoyé par Exam237 sur WhatsApp.
export default function Reset() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
    setReady(true);
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password') || '');
    const confirm = String(f.get('confirm') || '');
    if (password.length < 8)
      return setError('Le mot de passe doit contenir au moins 8 caractères.');
    if (password !== confirm) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    try {
      const r = await fetch('/api/auth?action=reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Impossible de modifier le mot de passe.');
      setDone(true);
      window.setTimeout(() => router.replace('/connexion'), 1800);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-top">
        <img src="/logo.png" alt="Exam237" />
        <h1>Nouveau mot de passe</h1>
        <p>Choisis un mot de passe que toi seul connais.</p>
      </div>
      <div className="auth-card">
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}
        {done ? (
          <div className="alert ok">Mot de passe modifié. Tu peux maintenant te connecter.</div>
        ) : !ready ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : !token ? (
          <>
            <div className="alert error">
              Ce lien est incomplet. Demande un nouveau lien à Exam237 sur WhatsApp.
            </div>
            <a className="btn btn-light" href="/connexion">
              Retour à la connexion
            </a>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">Nouveau mot de passe</label>
              <div className="pwd">
                <input
                  id="password"
                  className="input"
                  type={show ? 'text' : 'password'}
                  name="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  onClick={() => setShow(v => !v)}
                >
                  <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
                </button>
              </div>
              <small>Au moins 8 caractères.</small>
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirme le mot de passe</label>
              <input
                id="confirm"
                className="input"
                type={show ? 'text' : 'password'}
                name="confirm"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <button className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'Modification…' : 'Enregistrer le mot de passe'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
