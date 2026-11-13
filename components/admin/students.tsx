'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  copyText,
  daysLeft,
  DURATIONS,
  exportStudents,
  formatDate,
  timeAgo,
  type Act,
  type Notify,
} from './shared';

export type StudentFilter = 'premium' | 'free' | 'expiring' | 'suspended' | 'all';

const FILTERS: Array<{ id: StudentFilter; label: string }> = [
  { id: 'all', label: 'Tous' },
  { id: 'free', label: 'Gratuits' },
  { id: 'premium', label: 'Premium' },
  { id: 'expiring', label: 'Finissent bientôt' },
  { id: 'suspended', label: 'Suspendus' },
];

const PLAN: Record<string, { label: string; tone: 'green' | 'gold' | 'red' | 'grey' | 'blue' }> = {
  premium: { label: 'Premium', tone: 'gold' },
  free: { label: 'Gratuit', tone: 'blue' },
  suspended: { label: 'Suspendu', tone: 'red' },
};

const PAGE = 40;

const isExpiring = (u: any) => {
  if (u.plan !== 'premium') return false;
  const left = daysLeft(u.premiumUntil);
  return left !== null && left <= 7;
};

export default function Students({
  data,
  act,
  notify,
  filter,
  onFilter,
}: {
  data: any;
  act: Act;
  notify: Notify;
  filter: StudentFilter | null;
  onFilter: (f: StudentFilter) => void;
}) {
  const users: any[] = data.users || [];
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<StudentFilter, number> = {
      all: users.length,
      free: 0,
      premium: 0,
      expiring: 0,
      suspended: 0,
    };
    for (const u of users) {
      if (u.plan in c) c[u.plan as StudentFilter]++;
      if (isExpiring(u)) c.expiring++;
    }
    return c;
  }, [users]);

  const current: StudentFilter = filter || 'all';

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = users.filter(
      u =>
        (current === 'all' || (current === 'expiring' ? isExpiring(u) : u.plan === current)) &&
        (!term ||
          `${u.displayName} ${u.email} ${u.classLabel || ''} ${u.groupLabel || ''}`
            .toLowerCase()
            .includes(term))
    );
    if (current === 'expiring')
      filtered.sort(
        (a, b) => new Date(a.premiumUntil).getTime() - new Date(b.premiumUntil).getTime()
      );
    return filtered;
  }, [users, current, q]);

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <input
          className="input"
          type="search"
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Rechercher un nom, un e-mail, une classe…"
          aria-label="Rechercher un élève"
        />
        <button
          type="button"
          className="btn btn-light btn-sm"
          disabled={!list.length}
          onClick={() => exportStudents(list, current === 'all' ? 'eleves' : current)}
        >
          Exporter (CSV)
        </button>
      </div>
      <div className="adm-chips">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={`adm-chip ${current === f.id ? 'active' : ''}`}
            onClick={() => {
              onFilter(f.id);
              setLimit(PAGE);
            }}
          >
            {f.label} <span>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <p className="adm-note">
        Un élève t’a payé ? Cherche son nom ou son e-mail (il est dans son message WhatsApp),
        choisis la durée puis touche <b>Activer Premium</b>. S’il est déjà Premium, les jours
        s’ajoutent à ceux qui restent.
      </p>

      <div className="adm-list">
        {list.slice(0, limit).map(u => (
          <StudentCard
            key={u.id}
            user={u}
            classes={data.classes || []}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
            act={act}
            notify={notify}
          />
        ))}
        {!list.length ? (
          <div className="adm-empty">
            {q ? 'Aucun élève ne correspond à la recherche.' : 'Aucun élève dans cette liste.'}
          </div>
        ) : null}
      </div>
      {list.length > limit ? (
        <button
          type="button"
          className="btn btn-light adm-more"
          onClick={() => setLimit(l => l + PAGE)}
        >
          Afficher plus ({list.length - limit} restants)
        </button>
      ) : null}
    </div>
  );
}

function StudentCard({
  user,
  classes,
  open,
  onToggle,
  act,
  notify,
}: {
  user: any;
  classes: any[];
  open: boolean;
  onToggle: () => void;
  act: Act;
  notify: Notify;
}) {
  const [days, setDays] = useState(30);
  const [classCode, setClassCode] = useState(user.classCode || '');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = PLAN[user.plan] || { label: user.plan, tone: 'grey' as const };
  const left = daysLeft(user.premiumUntil);
  const name = user.displayName || user.email || 'Sans nom';
  const premium = user.plan === 'premium';

  const run = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      return await act(body, message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    const duration = DURATIONS.find(d => d.days === days)?.label || `${days} jours`;
    const r = await run({ action: 'activate_premium', id: user.id, days }, '');
    if (r) notify(`${name} est Premium jusqu’au ${formatDate(r.premiumUntil)} (+${duration}).`);
  };

  let access = '';
  if (premium)
    access = `Premium jusqu’au ${formatDate(user.premiumUntil)}${left !== null ? ` · ${left} j restant${left > 1 ? 's' : ''}` : ''}`;
  else if (user.plan === 'suspended')
    access = left && left > 0 ? `Suspendu · ${left} j de Premium restants` : 'Suspendu';
  else if (user.premiumUntil)
    access = `Gratuit · Premium terminé le ${formatDate(user.premiumUntil)}`;
  else access = `Gratuit · inscrit ${timeAgo(user.createdAt)}`;

  const shareText = link
    ? `Bonjour ${user.displayName || ''}, voici ton lien pour choisir un nouveau mot de passe Exam237 (valable 24 h) : ${link}`
    : '';

  return (
    <article className={`adm-item ${isExpiring(user) ? 'highlight' : ''}`}>
      <div className="adm-item-head">
        <div className="adm-item-title">
          <b>
            {user.online ? '🟢 ' : ''}
            {name}
          </b>
          <span className="adm-sub">
            {user.email} · {user.classLabel || 'Sans classe'}
            {user.groupLabel && user.groupLabel !== user.classLabel ? ` · ${user.groupLabel}` : ''}
          </span>
        </div>
        <Badge tone={plan.tone}>{plan.label}</Badge>
      </div>
      <div className="adm-kv">
        <span>{access}</span>
        <span>{user.online ? 'En ligne' : `Vu ${timeAgo(user.lastSeenAt)}`}</span>
        {user.mutedUntil ? <span>🔇 Muet jusqu’à {formatDate(user.mutedUntil, true)}</span> : null}
      </div>

      <div className="adm-actions">
        {user.plan === 'suspended' ? (
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => run({ action: 'reactivate_user', id: user.id }, 'Compte réactivé.')}
          >
            Réactiver le compte
          </button>
        ) : (
          <>
            <select
              className="select"
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              aria-label="Durée"
            >
              {DURATIONS.map(d => (
                <option key={d.days} value={d.days}>
                  {d.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={activate}>
              {premium ? 'Prolonger le Premium' : 'Activer Premium'}
            </button>
          </>
        )}
        <button className="btn btn-light btn-sm" onClick={onToggle} aria-expanded={open}>
          {open ? 'Fermer' : 'Plus…'}
        </button>
      </div>

      {open ? (
        <div className="adm-inline">
          <div className="field">
            <label>Classe</label>
            <div className="adm-actions">
              <select
                className="select grow"
                value={classCode}
                onChange={e => setClassCode(e.target.value)}
                aria-label="Nouvelle classe"
              >
                <option value="">Choisir…</option>
                {classes.map((c: any) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                    {c.group_label ? ` — ${c.group_label}` : ''}
                    {c.active ? '' : ' (désactivée)'}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-light btn-sm"
                disabled={busy || !classCode || classCode === user.classCode}
                onClick={() =>
                  run({ action: 'set_user_class', id: user.id, classCode }, 'Classe modifiée.')
                }
              >
                Changer
              </button>
            </div>
            <small>L’élève voit aussitôt les sujets et le chat de sa nouvelle classe.</small>
          </div>

          <div className="field">
            <label>Mot de passe oublié</label>
            {link ? (
              <div className="adm-link">
                <code>{link}</code>
                <div className="adm-actions">
                  <button
                    className="btn btn-light btn-sm"
                    onClick={async () =>
                      notify((await copyText(link)) ? 'Lien copié.' : 'Copie impossible.')
                    }
                  >
                    Copier
                  </button>
                  <a
                    className="btn btn-primary btn-sm"
                    href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Envoyer par WhatsApp
                  </a>
                </div>
                <small>Valable 24 h, utilisable une seule fois.</small>
              </div>
            ) : (
              <div className="adm-actions">
                <button
                  className="btn btn-light btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    const r = await run({ action: 'reset_link', id: user.id }, '');
                    if (r?.link) setLink(r.link);
                  }}
                >
                  Créer un lien de nouveau mot de passe
                </button>
              </div>
            )}
          </div>

          {user.mutedUntil ? (
            <div className="adm-actions">
              <button
                className="btn btn-light btn-sm"
                disabled={busy}
                onClick={() =>
                  run(
                    { action: 'unmute_user', userId: user.id },
                    'L’élève peut de nouveau écrire dans le chat.'
                  )
                }
              >
                🔈 Rendre la parole dans le chat
              </button>
            </div>
          ) : null}

          <div className="adm-actions">
            {premium ? (
              <button
                className="btn btn-light btn-sm"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `Retirer le Premium de ${name} ? Son compte redevient gratuit tout de suite.`
                    )
                  )
                    run(
                      { action: 'revoke_premium', id: user.id },
                      'Premium retiré : le compte est gratuit.'
                    );
                }}
              >
                Retirer le Premium
              </button>
            ) : null}
            {user.plan === 'suspended' ? null : (
              <button
                className="btn btn-light btn-sm"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `Suspendre ${name} ? Il sera déconnecté et ne pourra plus se connecter.`
                    )
                  )
                    run({ action: 'suspend_user', id: user.id }, 'Compte suspendu.');
                }}
              >
                Suspendre
              </button>
            )}
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm(`Supprimer définitivement ${name} ? Cette action est irréversible.`))
                  run({ action: 'delete_user', id: user.id }, 'Élève supprimé définitivement.');
              }}
            >
              Supprimer
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
