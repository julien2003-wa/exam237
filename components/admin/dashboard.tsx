'use client';

import { useState } from 'react';
import type { Pane } from '../admin-view';
import { Icon } from '../icons';
import type { StudentFilter } from './students';
import {
  Badge,
  daysLeft,
  exportStudents,
  formatDate,
  formatPhone,
  Section,
  type Act,
  type Notify,
} from './shared';

// Vue d'ensemble : chiffres clés, Premium qui expirent, sujets les plus lus, configuration.
export default function Dashboard({
  data,
  act,
  notify,
  onStudents,
  onPane,
}: {
  data: any;
  act: Act;
  notify: Notify;
  onStudents: (filter: StudentFilter) => void;
  onPane: (pane: Pane) => void;
}) {
  const stats = data.stats || {};
  const site = data.site || {};
  const expiring: any[] = data.expiring || [];
  const topPapers: any[] = data.topPapers || [];
  const [busyId, setBusyId] = useState<string | null>(null);

  const prices = Object.values(site.prices || {}).filter(Boolean).length;
  const examDates = Object.keys(site.examDates || {}).length;
  const checks: Array<{ ok: boolean; label: string; help: string; pane?: Pane }> = [
    {
      ok: !!site.whatsapp,
      label: 'Numéro WhatsApp',
      help: site.whatsapp
        ? `${formatPhone(site.whatsapp)} reçoit les demandes Premium.`
        : 'Sans numéro, le bouton « Passer Premium » ne peut pas ouvrir WhatsApp.',
      pane: 'settings',
    },
    {
      ok: prices > 0,
      label: 'Prix du Premium',
      help: prices
        ? `${prices} formule${prices > 1 ? 's' : ''} avec un prix.`
        : 'Les élèves verront « Prix sur WhatsApp ».',
      pane: 'settings',
    },
    {
      ok: examDates > 0,
      label: 'Dates des examens',
      help: examDates
        ? 'Le compte à rebours s’affiche sur l’accueil.'
        : 'Ajoute-les pour afficher le compte à rebours.',
      pane: 'settings',
    },
    {
      ok: !!data.realtimeConfigured,
      label: 'Chat instantané (Ably)',
      help: data.realtimeConfigured
        ? 'Les messages arrivent en direct.'
        : 'Ajoute ABLY_API_KEY dans Vercel : sinon le chat se met à jour toutes les 4 secondes.',
    },
    {
      ok: !!data.assistantConfigured,
      label: 'Prof IA et assistant (Claude)',
      help: data.assistantConfigured
        ? 'La clé ANTHROPIC_API_KEY est en place.'
        : 'Ajoute ANTHROPIC_API_KEY dans Vercel.',
      pane: 'assistant',
    },
    {
      ok: !!data.blobConfigured,
      label: 'Stockage des fichiers (Vercel Blob)',
      help: data.blobConfigured
        ? 'PDF et vidéos sont stockés en privé.'
        : 'Dans Vercel : Storage → ton stockage Blob → Projects, brancher le projet exam237.',
    },
  ];
  const missing = checks.filter(c => !c.ok).length;

  const extend = async (user: any) => {
    setBusyId(user.id);
    const r = await act({ action: 'activate_premium', id: user.id, days: 30 }, '');
    setBusyId(null);
    if (r)
      notify(
        `${user.displayName || user.email} : Premium prolongé jusqu’au ${formatDate(r.premiumUntil)}.`
      );
  };

  return (
    <div className="adm-stack">
      <div className="adm-cards">
        <button type="button" className="adm-card" onClick={() => onStudents('all')}>
          <small>Élèves inscrits</small>
          <b>{stats.students || 0}</b>
          <span>+{stats.newThisWeek || 0} cette semaine</span>
        </button>
        <button type="button" className="adm-card gold" onClick={() => onStudents('premium')}>
          <small>Premium actifs</small>
          <b>{stats.premium || 0}</b>
          <span>
            {stats.activationsMonth || 0} activation{stats.activationsMonth > 1 ? 's' : ''} en 30 j
          </span>
        </button>
        <button type="button" className="adm-card" onClick={() => onStudents('free')}>
          <small>Comptes gratuits</small>
          <b>{stats.free || 0}</b>
          <span>
            {stats.students ? Math.round(((stats.premium || 0) / stats.students) * 100) : 0} %
            passent Premium
          </span>
        </button>
        <div className="adm-card">
          <small>En ligne</small>
          <b>{stats.online || 0}</b>
          <span>en ce moment</span>
        </div>
        <button type="button" className="adm-card" onClick={() => onPane('content')}>
          <small>Sujets publiés</small>
          <b>{stats.papers || 0}</b>
          <span>
            {stats.corrections || 0} corrections · {stats.freePapers || 0} gratuits
          </span>
        </button>
        <button
          type="button"
          className={`adm-card ${stats.reports || stats.contentReports ? 'red' : ''}`}
          onClick={() => onPane('reports')}
        >
          <small>Signalements</small>
          <b>{(stats.reports || 0) + (stats.contentReports || 0)}</b>
          <span>
            {stats.reports || 0} chat · {stats.contentReports || 0} erreurs
          </span>
        </button>
      </div>

      {missing ? (
        <Section title="À configurer" count={missing}>
          <div className="adm-checklist">
            {checks.map(c => (
              <div key={c.label} className={`adm-check ${c.ok ? 'ok' : ''}`}>
                <span className="adm-check-mark" aria-hidden="true">
                  {c.ok ? <Icon name="check" size={14} strokeWidth={3} /> : '!'}
                </span>
                <div>
                  <b>{c.label}</b>
                  <small>{c.help}</small>
                </div>
                {!c.ok && c.pane ? (
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    onClick={() => onPane(c.pane!)}
                  >
                    Régler
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title="Premium qui se terminent (7 jours)"
        count={expiring.length}
        actions={
          expiring.length ? (
            <button
              type="button"
              className="btn btn-light btn-sm"
              onClick={() => onStudents('expiring')}
            >
              Tout voir
            </button>
          ) : undefined
        }
      >
        {expiring.length ? (
          <div className="adm-rows">
            {expiring.slice(0, 8).map(u => {
              const left = daysLeft(u.premiumUntil);
              return (
                <div key={u.id} className="adm-row">
                  <div>
                    <b>{u.displayName || u.email}</b>
                    <small>
                      {u.classLabel || 'Sans classe'} · fin le {formatDate(u.premiumUntil)}
                    </small>
                  </div>
                  <Badge tone={left !== null && left <= 2 ? 'red' : 'gold'}>
                    {left !== null && left <= 0 ? 'aujourd’hui' : `${left} j`}
                  </Badge>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    disabled={busyId === u.id}
                    onClick={() => extend(u)}
                  >
                    +1 mois
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="adm-sub" style={{ margin: 0 }}>
            Aucun Premium ne se termine cette semaine.
          </p>
        )}
      </Section>

      <Section title="Sujets les plus consultés (30 jours)" count={topPapers.length}>
        {topPapers.length ? (
          <div className="adm-rows">
            {topPapers.map((p, i) => (
              <div key={p.id} className="adm-row">
                <span className="adm-rank">{i + 1}</span>
                <div>
                  <b>
                    {p.subject_name} · {p.exam_year}
                  </b>
                  <small>
                    {p.class_label} · {p.title}
                  </small>
                </div>
                <Badge tone="green">
                  {p.views} ouverture{p.views > 1 ? 's' : ''}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="adm-sub" style={{ margin: 0 }}>
            Pas encore de consultations ce mois-ci.
          </p>
        )}
      </Section>

      <Section title="Exporter" defaultOpen={false}>
        <p className="adm-sub" style={{ margin: 0 }}>
          Télécharge la liste des élèves (nom, e-mail, classe, formule, dates) pour l’ouvrir dans
          Excel ou Google Sheets.
        </p>
        <div className="adm-form-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => exportStudents(data.users || [])}
          >
            Tous les élèves (CSV)
          </button>
          <button
            type="button"
            className="btn btn-light btn-sm"
            onClick={() =>
              exportStudents(
                (data.users || []).filter((u: any) => u.plan === 'premium'),
                'premium'
              )
            }
          >
            Premium seulement
          </button>
        </div>
      </Section>
    </div>
  );
}
