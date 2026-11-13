'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icons';
import {
  daysLeft,
  formatSize,
  frDate,
  offlineList,
  offlineSupported,
  openOffline,
  post,
  removeOffline,
  setWifiOnly,
  whatsappUrl,
  wifiOnly,
  type Notify,
  type OfflineItem,
  type Site,
  type Viewer,
} from './lib';

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'E'
  );
}

type Browser =
  'ios-safari' | 'ios-chrome' | 'ios-other' | 'in-app' | 'samsung' | 'android' | 'desktop';

// Chaque navigateur installe une application web à sa façon : on montre le bon chemin.
function detectBrowser(): Browser {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat/i.test(ua)) return 'in-app';
  const ios =
    /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) {
    if (/CriOS/i.test(ua)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS|OPT\//i.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

function InstallSteps({ browser }: { browser: Browser }) {
  const text = { margin: 0, color: 'var(--text)', lineHeight: 1.5 } as const;
  const note = { margin: 0, color: 'var(--muted)', fontSize: '0.86rem', lineHeight: 1.45 } as const;
  switch (browser) {
    case 'ios-safari':
      return (
        <>
          <p style={text}>
            Touche le bouton <b>Partager</b> (le carré avec une flèche, en bas de l’écran), puis{' '}
            <b>Sur l’écran d’accueil</b> et <b>Ajouter</b>.
          </p>
          <p style={note}>Lien ouvert depuis WhatsApp ? Ouvre-le d’abord dans Safari.</p>
        </>
      );
    case 'ios-chrome':
      return (
        <>
          <p style={text}>
            Touche le bouton <b>Partager</b> dans la barre d’adresse (en haut à droite), puis{' '}
            <b>Ajouter à l’écran d’accueil</b>.
          </p>
          <p style={note}>Il faut iOS 16.4 ou plus récent. Sinon, ouvre Exam237 dans Safari.</p>
        </>
      );
    case 'ios-other':
      return (
        <p style={text}>
          Touche le bouton <b>Partager</b> de ton navigateur, puis <b>Sur l’écran d’accueil</b>. Si
          l’option n’apparaît pas, ouvre Exam237 dans Safari.
        </p>
      );
    case 'in-app':
      return (
        <p style={text}>
          Tu es dans le navigateur de Facebook, Instagram ou TikTok : il ne permet pas d’installer.
          Touche le menu <b>⋯</b> puis <b>Ouvrir dans le navigateur</b> (Chrome ou Safari), et
          reviens ici.
        </p>
      );
    case 'samsung':
      return (
        <p style={text}>
          Touche le menu <b>≡</b> (en bas), puis <b>Ajouter la page à</b> et <b>Écran d’accueil</b>.
        </p>
      );
    case 'android':
      return (
        <p style={text}>
          Ouvre le menu <b>⋮</b> (en haut à droite), puis <b>Installer l’application</b> ou{' '}
          <b>Ajouter à l’écran d’accueil</b>.
        </p>
      );
    default:
      return (
        <p style={text}>
          Dans Chrome ou Edge, clique sur l’icône d’installation à droite de la barre d’adresse, ou
          cherche <b>Installer Exam237</b> dans le menu du navigateur.
        </p>
      );
  }
}

function PasswordInput({
  value,
  onChange,
  label,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pwd">
        <input
          className="input"
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={e => onChange(e.target.value)}
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
    </div>
  );
}

export default function ProfileView({
  viewer,
  site,
  onLogout,
  onRefresh,
  onPremium,
  onOpenSaved,
  notify,
}: {
  viewer: Viewer;
  site: Site;
  onLogout: () => void;
  onRefresh: () => Promise<void> | void;
  onPremium: (renew?: boolean) => void;
  onOpenSaved: (url: string) => boolean;
  notify: Notify;
}) {
  const isStudent = viewer.role === 'student';
  const [name, setName] = useState(viewer.displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [downloads, setDownloads] = useState<OfflineItem[]>([]);
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [browser, setBrowser] = useState<Browser>('android');
  const [deletePwd, setDeletePwd] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [wifi, setWifi] = useState(false);

  useEffect(() => {
    setDownloads(offlineList());
    setWifi(wifiOnly());
    setBrowser(detectBrowser());
    setInstalled(
      window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as any).standalone === true
    );
    const w = window as any;
    if (w.__exam237Install) setInstallEvent(w.__exam237Install);
    const onReady = () => setInstallEvent((window as any).__exam237Install || null);
    window.addEventListener('exam237-install-ready', onReady);
    return () => window.removeEventListener('exam237-install-ready', onReady);
  }, []);

  const left = daysLeft(viewer.premiumUntil);

  const saveName = async () => {
    if (name.trim().length < 2)
      return notify('Ton nom doit contenir au moins 2 caractères.', 'error');
    setSavingName(true);
    try {
      await post('/api/me', { action: 'profile', displayName: name.trim() });
      notify('Nom enregistré.');
      await onRefresh();
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    if (pwd.next.length < 8)
      return notify('Le nouveau mot de passe doit contenir au moins 8 caractères.', 'error');
    if (pwd.next !== pwd.confirm)
      return notify('Les deux nouveaux mots de passe ne sont pas identiques.', 'error');
    setSavingPwd(true);
    try {
      await post('/api/me', { action: 'change_password', current: pwd.current, next: pwd.next });
      setPwd({ current: '', next: '', confirm: '' });
      notify('Mot de passe modifié. Tes autres appareils ont été déconnectés.');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setSavingPwd(false);
    }
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice?.outcome === 'accepted') setInstalled(true);
    } catch {}
    (window as any).__exam237Install = null;
    setInstallEvent(null);
  };

  const openDownload = async (item: OfflineItem) => {
    // Dans le lecteur de l'application si le sujet est encore là, sinon dans le téléphone.
    if (onOpenSaved(item.key)) return;
    try {
      await openOffline(item.key, item.title);
    } catch (e: any) {
      notify(e.message, 'error');
      await removeOffline(item.key);
      setDownloads(offlineList());
    }
  };

  const deleteAccount = async () => {
    if (!deletePwd) return notify('Entre ton mot de passe pour confirmer.', 'error');
    setDeleting(true);
    try {
      await post('/api/me', { action: 'delete_account', password: deletePwd });
      for (const item of offlineList()) await removeOffline(item.key);
      window.location.replace('/bienvenue');
    } catch (e: any) {
      notify(e.message, 'error');
      setDeleting(false);
    }
  };

  const totalSize = downloads.reduce((sum, item) => sum + (item.size || 0), 0);
  const helpUrl = site?.whatsapp
    ? whatsappUrl(
        site.whatsapp,
        `Bonjour Exam237, j’ai besoin d’aide.\nNom : ${viewer.displayName || 'non renseigné'}\nE-mail : ${viewer.email}\nClasse : ${viewer.classLabel || 'non renseignée'}\n\nMon problème : `
      )
    : null;

  return (
    <div className="page">
      <div className="page-head" style={{ padding: '0 0 2px' }}>
        <h1>Profil</h1>
      </div>

      <section className="card">
        <div className="profile-head">
          <span className="profile-avatar">{initials(viewer.displayName || viewer.email)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{viewer.displayName || 'Exam237'}</h2>
            <p>{viewer.email}</p>
          </div>
          {isStudent ? (
            <span className={`pill ${viewer.premium ? 'pill-premium' : 'pill-free'}`}>
              {viewer.premium ? 'Premium' : 'Gratuit'}
            </span>
          ) : (
            <span className="pill pill-new">Admin</span>
          )}
        </div>
        <div className="rows">
          {isStudent ? (
            <>
              <div className="row">
                <span>Classe</span>
                <b>{viewer.classLabel || 'Non renseignée'}</b>
              </div>
              {viewer.groupLabel && viewer.groupLabel !== viewer.classLabel ? (
                <div className="row">
                  <span>Groupe</span>
                  <b>{viewer.groupLabel}</b>
                </div>
              ) : null}
              <div className="row">
                <span>Formule</span>
                <b>
                  {viewer.premium ? `Premium jusqu’au ${frDate(viewer.premiumUntil)}` : 'Gratuite'}
                </b>
              </div>
            </>
          ) : (
            <div className="row">
              <span>Rôle</span>
              <b>Administrateur Exam237</b>
            </div>
          )}
        </div>
      </section>

      {isStudent ? (
        viewer.premium ? (
          <section className="card plan-card premium">
            <span className="tag gold">Premium actif</span>
            <h2>
              {left !== null && left <= 5
                ? `Plus que ${Math.max(left, 0)} jour${left > 1 ? 's' : ''} de Premium`
                : `Premium jusqu’au ${frDate(viewer.premiumUntil)}`}
            </h2>
            <p>
              Tous les sujets, corrections, vidéos, le Prof IA et la lecture hors ligne, sans
              publicité.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => onPremium(true)}>
              <Icon name="refresh" size={18} /> Renouveler sur WhatsApp
            </button>
          </section>
        ) : (
          <section className="card plan-card">
            <span className="tag">Version gratuite</span>
            <h2>Débloque tout Exam237</h2>
            <p>Tous les sujets corrigés, les vidéos, le Prof IA et la lecture hors ligne.</p>
            <button type="button" className="btn btn-gold" onClick={() => onPremium(false)}>
              <Icon name="star" size={18} /> Passer Premium
            </button>
          </section>
        )
      ) : null}

      <section className="card">
        {isStudent ? (
          <details className="fold" style={{ borderTop: 0 }}>
            <summary>
              <Icon name="user" size={20} />
              <span className="grow">Modifier mon nom</span>
              <Icon name="chevron" size={18} />
            </summary>
            <div className="fold-body">
              <div className="field">
                <label>Nom affiché dans le chat</label>
                <input
                  className="input"
                  value={name}
                  maxLength={80}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingName}
                onClick={saveName}
              >
                {savingName ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </details>
        ) : null}

        {isStudent ? (
          <details className="fold">
            <summary>
              <Icon name="key" size={20} />
              <span className="grow">Changer mon mot de passe</span>
              <Icon name="chevron" size={18} />
            </summary>
            <div className="fold-body">
              <PasswordInput
                label="Mot de passe actuel"
                autoComplete="current-password"
                value={pwd.current}
                onChange={v => setPwd(p => ({ ...p, current: v }))}
              />
              <PasswordInput
                label="Nouveau mot de passe (8 caractères minimum)"
                autoComplete="new-password"
                value={pwd.next}
                onChange={v => setPwd(p => ({ ...p, next: v }))}
              />
              <PasswordInput
                label="Confirme le nouveau mot de passe"
                autoComplete="new-password"
                value={pwd.confirm}
                onChange={v => setPwd(p => ({ ...p, confirm: v }))}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingPwd || !pwd.current || !pwd.next}
                onClick={savePassword}
              >
                {savingPwd ? 'Modification…' : 'Changer le mot de passe'}
              </button>
            </div>
          </details>
        ) : null}

        {isStudent ? (
          <details className="fold" onToggle={() => setDownloads(offlineList())}>
            <summary>
              <Icon name="download" size={20} />
              <span className="grow">
                Téléchargements hors ligne
                {downloads.length ? (
                  <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 500 }}>
                    {downloads.length} fichier{downloads.length > 1 ? 's' : ''},{' '}
                    {formatSize(totalSize)}
                  </small>
                ) : null}
              </span>
              <Icon name="chevron" size={18} />
            </summary>
            <div className="fold-body">
              {viewer.premium && offlineSupported() ? (
                <label className="switch-row">
                  <span className="grow">
                    <b>Télécharger seulement en Wi-Fi</b>
                    <small>Pour ne pas utiliser tes données mobiles.</small>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={wifi}
                      onChange={e => {
                        setWifi(e.target.checked);
                        setWifiOnly(e.target.checked);
                      }}
                    />
                    <span aria-hidden="true" />
                  </span>
                </label>
              ) : null}
              {!offlineSupported() ? (
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Ton navigateur ne permet pas la lecture hors ligne.
                </p>
              ) : !downloads.length ? (
                <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.45 }}>
                  {viewer.premium
                    ? 'Aucun fichier pour l’instant. Ouvre un sujet puis touche « Lire sans connexion » : tu pourras le lire sans internet.'
                    : 'La lecture hors ligne est réservée aux membres Premium.'}
                </p>
              ) : (
                <div>
                  {downloads.map(item => (
                    <div key={item.key} className="download-item">
                      <span className="round">
                        <Icon name="file" size={20} />
                      </span>
                      <div className="grow">
                        <b>{item.title}</b>
                        <small>
                          {item.subtitle}, {formatSize(item.size)}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        onClick={() => openDownload(item)}
                      >
                        Ouvrir
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Supprimer ${item.title} du téléphone`}
                        onClick={async () => {
                          await removeOffline(item.key);
                          setDownloads(offlineList());
                          notify('Fichier retiré du téléphone.');
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        ) : null}

        <details className="fold" style={isStudent ? undefined : { borderTop: 0 }}>
          <summary>
            <Icon name="install" size={20} />
            <span className="grow">Installer l’application</span>
            <Icon name="chevron" size={18} />
          </summary>
          <div className="fold-body">
            {installed ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Exam237 est déjà installé sur cet appareil.
              </p>
            ) : installEvent ? (
              <>
                <p style={{ margin: 0, color: 'var(--text)', lineHeight: 1.45 }}>
                  Ajoute Exam237 à ton écran d’accueil : il s’ouvre comme une vraie application,
                  sans passer par le navigateur.
                </p>
                <button type="button" className="btn btn-gold" onClick={install}>
                  <Icon name="install" size={18} /> Installer Exam237
                </button>
              </>
            ) : (
              <InstallSteps browser={browser} />
            )}
          </div>
        </details>

        {isStudent && helpUrl ? (
          <a
            className="action"
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              border: 0,
              borderTop: '1px solid var(--line2)',
              borderRadius: 0,
              minHeight: 52,
              padding: '14px 16px',
            }}
          >
            <Icon name="phone" size={20} />
            <span className="grow">
              Besoin d’aide ?<small>Écris à Exam237 sur WhatsApp</small>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        ) : null}
      </section>

      <button type="button" className="btn btn-light btn-lg btn-block" onClick={onLogout}>
        <Icon name="logout" size={20} /> Se déconnecter
      </button>

      {isStudent ? (
        <section className="card">
          <details className="fold" style={{ borderTop: 0 }}>
            <summary style={{ color: 'var(--red)' }}>
              <Icon name="trash" size={20} />
              <span className="grow">Supprimer mon compte</span>
              <Icon name="chevron" size={18} />
            </summary>
            <div className="fold-body">
              <p style={{ margin: 0, color: 'var(--text)', lineHeight: 1.45 }}>
                Ton compte, tes messages, ta progression et ta conversation avec le Prof IA seront
                supprimés définitivement.{viewer.premium ? ' Ton Premium en cours sera perdu.' : ''}
              </p>
              <PasswordInput
                label="Entre ton mot de passe pour confirmer"
                autoComplete="current-password"
                value={deletePwd}
                onChange={setDeletePwd}
              />
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting || !deletePwd}
                onClick={deleteAccount}
              >
                {deleting ? 'Suppression…' : 'Supprimer définitivement mon compte'}
              </button>
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}
