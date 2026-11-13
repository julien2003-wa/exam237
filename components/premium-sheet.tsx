'use client';
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { PLANS, premiumMessage, whatsappUrl, type Site, type Viewer } from './lib';

const BENEFITS = [
  'Tous les sujets avec leurs corrections',
  'Les vidéos de correction',
  'Le Prof IA, même avec la photo d’un exercice',
  'La lecture sans connexion',
  'Le mode examen chronométré',
  'Aucune publicité',
];

export default function PremiumSheet({
  viewer,
  site,
  renew,
  onClose,
}: {
  viewer: Viewer;
  site: Site;
  renew: boolean;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState('3');
  const chosen = PLANS.find(p => p.months === plan) || PLANS[1];
  const price = site.prices?.[plan] || '';
  const message = premiumMessage(viewer, chosen.label, price, renew);
  const ready = !!site.whatsapp;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Passer Premium"
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>{renew ? 'Renouveler mon Premium' : 'Passe Premium'}</h2>
          <span className="avatar-btn" aria-hidden="true" style={{ width: 40, height: 40 }}>
            <Icon name="star" size={20} />
          </span>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="lead">Tout Exam237, sans limite, jusqu’à ton examen.</p>

        <section className="card benefits">
          {BENEFITS.map(b => (
            <div key={b} className="benefit">
              <span className="tick">
                <Icon name="check" size={14} strokeWidth={3} />
              </span>
              <span>{b}</span>
            </div>
          ))}
        </section>

        <div className="field">
          <label id="plans-label">Choisis ta formule</label>
          <div className="plans" role="group" aria-labelledby="plans-label">
            {PLANS.map(p => (
              <button
                key={p.months}
                type="button"
                className="plan"
                aria-pressed={plan === p.months}
                onClick={() => setPlan(p.months)}
              >
                <b>{p.label}</b>
                <small>{site.prices?.[p.months] || 'Prix sur WhatsApp'}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="wa-preview">
          <strong>Message envoyé à Exam237 sur WhatsApp</strong>
          <p>{message}</p>
        </div>

        {ready ? (
          <a
            className="btn btn-primary btn-lg"
            href={whatsappUrl(site.whatsapp, message)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size={20} />
            Continuer sur WhatsApp
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" disabled>
            Bientôt disponible
          </button>
        )}
        <p className="fine">
          Tu paies par MTN MoMo ou Orange Money. Exam237 active ton Premium dès réception du
          paiement.
        </p>
      </div>
    </div>
  );
}
