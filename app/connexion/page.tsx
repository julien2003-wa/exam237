'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';

type PublicClass = {
  code: string;
  label: string;
  groupId: string | null;
  groupLabel: string | null;
};

function PasswordField({
  name,
  label,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  autoComplete: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <div className="pwd">
        <input
          id={name}
          className="input"
          type={show ? 'text' : 'password'}
          name={name}
          required
          minLength={autoComplete === 'new-password' ? 8 : undefined}
          autoComplete={autoComplete}
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
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export default function Connexion() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [classes, setClasses] = useState<PublicClass[]>([]);
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register' || window.location.hash === '#inscription')
      setMode('register');
    fetch('/api/auth?action=me', { cache: 'no-store' })
      .then(r => {
        if (r.ok) router.replace('/');
      })
      .catch(() => {});
    fetch('/api/data?action=public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setClasses(d.classes || []);
        setWhatsapp(d.site?.whatsapp || '');
      })
      .catch(() => {});
  }, [router]);

  // Les classes regroupées par niveau (3e, 1re, Tle…), comme dans le menu de l'admin.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: PublicClass[] }>();
    for (const c of classes) {
      const key = c.groupId || c.code;
      if (!map.has(key)) map.set(key, { label: c.groupLabel || c.label, items: [] });
      map.get(key)!.items.push(c);
    }
    return [...map.values()];
  }, [classes]);

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError(null);
    setForgotOpen(false);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (mode === 'register' && String(form.password || '').length < 8)
      return setError('Le mot de passe doit contenir au moins 8 caractères.');
    setBusy(true);
    try {
      const r = await fetch(`/api/auth?action=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Une erreur est survenue. Réessaie.');
      router.replace('/');
    } catch (err: any) {
      setError(
        err?.message === 'Failed to fetch'
          ? 'Pas de connexion internet. Vérifie ton réseau et réessaie.'
          : err.message
      );
      setBusy(false);
    }
  };

  const forgotLink = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(
        `Bonjour Exam237, j’ai oublié mon mot de passe.\nMon adresse e-mail : ${email.trim() || '…'}`
      )}`
    : null;

  return (
    <main className="auth-wrap">
      <div className="auth-top">
        <img src="/logo.png" alt="Exam237" />
        <h1>{mode === 'login' ? 'Bon retour sur Exam237' : 'Crée ton compte gratuit'}</h1>
        <p>
          {mode === 'login'
            ? 'Retrouve tes sujets, tes corrections et le chat de ta classe.'
            : 'Ton compte est actif tout de suite. Passe Premium quand tu veux.'}
        </p>
      </div>

      <div className="auth-card">
        <div className="seg" role="group" aria-label="Connexion ou inscription">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>
            Se connecter
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            onClick={() => switchMode('register')}
          >
            Créer un compte
          </button>
        </div>

        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="stack" onSubmit={submit} key={mode}>
          {mode === 'register' ? (
            <div className="field">
              <label htmlFor="displayName">Nom et prénom</label>
              <input
                id="displayName"
                className="input"
                name="displayName"
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="email">Adresse e-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              name="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          {mode === 'register' ? (
            <div className="field">
              <label htmlFor="classCode">Ta classe</label>
              <select id="classCode" className="select" name="classCode" required defaultValue="">
                <option value="" disabled>
                  {classes.length ? 'Choisis ta classe' : 'Chargement des classes…'}
                </option>
                {groups.map(g =>
                  g.items.length > 1 ? (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map(c => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={g.items[0].code} value={g.items[0].code}>
                      {g.items[0].label}
                    </option>
                  )
                )}
              </select>
            </div>
          ) : null}
          <PasswordField
            name="password"
            label="Mot de passe"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            hint={mode === 'register' ? 'Au moins 8 caractères. Garde-le pour toi.' : undefined}
          />
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? (
              <>
                <span
                  className="spinner"
                  style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: '#fff' }}
                />
                {mode === 'login' ? 'Connexion…' : 'Création du compte…'}
              </>
            ) : mode === 'login' ? (
              'Se connecter'
            ) : (
              'Créer mon compte gratuit'
            )}
          </button>
        </form>

        {mode === 'login' ? (
          forgotOpen ? (
            <div className="alert ok" style={{ display: 'grid', gap: 10 }}>
              <span>
                Écris ton adresse e-mail ci-dessus, puis contacte Exam237 sur WhatsApp : tu recevras
                un lien pour choisir un nouveau mot de passe.
              </span>
              {forgotLink ? (
                <a
                  className="btn btn-primary"
                  href={forgotLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="phone" size={18} /> Écrire sur WhatsApp
                </a>
              ) : (
                <span>Le numéro WhatsApp d’Exam237 sera bientôt disponible ici.</span>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="text-link"
              style={{ justifySelf: 'center' }}
              onClick={() => setForgotOpen(true)}
            >
              Mot de passe oublié ?
            </button>
          )
        ) : (
          <p className="fine">
            Gratuit : le chat de ta classe et un sujet corrigé par matière pour essayer.
          </p>
        )}

        <a
          className="text-link"
          href="/bienvenue"
          style={{ justifySelf: 'center', fontSize: '0.9rem' }}
        >
          Découvrir Exam237
        </a>
      </div>
    </main>
  );
}
