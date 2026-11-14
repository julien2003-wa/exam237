'use client';

import { useState } from 'react';
import type { Act } from './shared';

type Closure = { closed: boolean; since: string | null };

function since(iso: string | null) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Bouton « Fermer le site » : plus personne ne voit Exam237, sauf l'admin ici (voir middleware.ts).
export default function SiteAccess({ closure, act }: { closure?: Closure; act: Act }) {
  const [busy, setBusy] = useState(false);
  const closed = !!closure?.closed;

  const toggle = async () => {
    const question = closed
      ? 'Rouvrir le site à tout le monde ?'
      : 'Fermer le site ?\n\nPlus personne ne pourra l’ouvrir, sauf toi ici dans l’administration. Rien n’est effacé : tu pourras le rouvrir quand tu veux.';
    if (!confirm(question)) return;
    setBusy(true);
    await act(
      { action: 'set_site_closed', closed: !closed },
      closed
        ? 'Site rouvert : tout le monde y a de nouveau accès.'
        : 'Site fermé : les élèves et les visiteurs voient « Exam237 est fermé pour le moment ».'
    );
    setBusy(false);
  };

  const when = since(closure?.since ?? null);
  return (
    <div className={`adm-access ${closed ? 'closed' : ''}`} role="status">
      <span className="adm-access-dot" aria-hidden="true" />
      <div className="adm-access-text">
        <b>{closed ? 'Site fermé' : 'Site ouvert'}</b>
        <span>
          {closed
            ? `${when ? `Depuis le ${when}. ` : ''}Les élèves et les visiteurs voient « Exam237 est fermé pour le moment ».`
            : 'Les élèves et les visiteurs peuvent utiliser Exam237.'}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-sm ${closed ? 'btn-primary' : 'btn-danger'}`}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? 'Un instant…' : closed ? 'Rouvrir le site' : 'Fermer le site'}
      </button>
    </div>
  );
}
