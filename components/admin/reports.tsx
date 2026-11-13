'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Badge, formatDate, timeAgo, type Act } from './shared';

export default function Reports({ act, onChanged }: { act: Act; onChanged: () => void }) {
  const [tab, setTab] = useState<'chat' | 'content'>('chat');
  const [reports, setReports] = useState<any[] | null>(null);
  const [content, setContent] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [chat, errors] = await Promise.all([
        api('/api/data?action=admin_reports'),
        api('/api/data?action=admin_content_reports'),
      ]);
      setReports(chat.reports || []);
      setContent(errors.reports || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // act() recharge déjà les données générales (compteurs) ; on recharge les listes ici.
  const run = async (body: Record<string, unknown>, message: string) => {
    const r = await act(body, message);
    await load();
    return r;
  };

  if (error)
    return (
      <div className="adm-stack">
        <p className="adm-note error">{error}</p>
        <button className="btn btn-light adm-more" onClick={load}>
          Réessayer
        </button>
      </div>
    );
  if (!reports || !content) return <div className="adm-empty">Chargement des signalements…</div>;
  const openContent = content.filter(r => r.status === 'open').length;

  return (
    <div className="adm-stack">
      <div className="adm-chips">
        <button
          type="button"
          className={`adm-chip ${tab === 'chat' ? 'active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Messages du chat <span>{reports.length}</span>
        </button>
        <button
          type="button"
          className={`adm-chip ${tab === 'content' ? 'active' : ''}`}
          onClick={() => setTab('content')}
        >
          Erreurs dans les sujets <span>{openContent}</span>
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="adm-list">
            {reports.map(r => (
              <ReportCard key={r.messageId} report={r} run={run} />
            ))}
            {!reports.length ? <div className="adm-empty">Aucun message signalé.</div> : null}
          </div>
        </>
      ) : (
        <>
          <p className="adm-note">
            Corrige le PDF dans Sujets & corrections, puis marque le signalement comme traité.
          </p>
          <div className="adm-list">
            {content.map(r => (
              <ContentReportCard key={r.id} report={r} run={run} />
            ))}
            {!content.length ? <div className="adm-empty">Aucune erreur signalée.</div> : null}
          </div>
        </>
      )}

      <button
        type="button"
        className="btn btn-light adm-more"
        onClick={() => {
          load();
          onChanged();
        }}
      >
        Actualiser
      </button>
    </div>
  );
}

function ContentReportCard({
  report,
  run,
}: {
  report: any;
  run: (b: Record<string, unknown>, m: string) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false);
  const exec = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    await run(body, message);
    setBusy(false);
  };
  const open = report.status === 'open';
  const fileUrl = report.correctionId
    ? `/api/files?kind=correction&id=${encodeURIComponent(report.correctionId)}`
    : `/api/files?kind=paper&id=${encodeURIComponent(report.paperId)}`;
  return (
    <article className={`adm-item ${open ? 'highlight' : ''}`}>
      <div className="adm-item-head">
        <div className="adm-item-title">
          <b>
            {report.subjectName} · {report.year} · {report.classLabel}
          </b>
          <span className="adm-sub">
            {report.correctionTitle ? `Correction « ${report.correctionTitle} »` : 'Sujet'} ·
            signalé par {report.reporterName} {timeAgo(report.createdAt)}
          </span>
        </div>
        <Badge tone={open ? 'red' : 'green'}>{open ? 'À traiter' : 'Traité'}</Badge>
      </div>
      <blockquote className="adm-quote">{report.message}</blockquote>
      <div className="adm-actions">
        <a className="btn btn-light btn-sm" href={fileUrl} target="_blank" rel="noopener">
          Ouvrir le PDF
        </a>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() =>
            exec(
              { action: 'content_report_resolve', id: report.id, reopen: !open },
              open ? 'Signalement marqué comme traité.' : 'Signalement rouvert.'
            )
          }
        >
          {open ? 'Marquer comme traité' : 'Rouvrir'}
        </button>
        <button
          className="btn btn-light btn-sm"
          disabled={busy}
          onClick={() => {
            if (confirm('Supprimer ce signalement ?'))
              exec({ action: 'content_report_delete', id: report.id }, 'Signalement supprimé.');
          }}
        >
          Supprimer
        </button>
      </div>
    </article>
  );
}

function ReportCard({
  report,
  run,
}: {
  report: any;
  run: (b: Record<string, unknown>, m: string) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false);
  const exec = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    await run(body, message);
    setBusy(false);
  };
  const count = report.reports.length;
  return (
    <article className="adm-item highlight">
      <div className="adm-item-head">
        <div className="adm-item-title">
          <b>{report.senderName}</b>
          <span className="adm-sub">
            {report.groupLabel} · envoyé {timeAgo(report.createdAt)}
          </span>
        </div>
        <Badge tone="red">
          {count} signalement{count > 1 ? 's' : ''}
        </Badge>
      </div>
      <blockquote className="adm-quote">{report.text}</blockquote>
      <div className="adm-children">
        {report.reports.map((x: any) => (
          <div key={x.id} className="adm-sub">
            <b>{x.reporterName}</b>, {formatDate(x.createdAt, true)}
            {x.reason ? ` : « ${x.reason} »` : ''}
          </div>
        ))}
      </div>
      {report.mutedUntil ? (
        <span className="adm-sub">Auteur muet jusqu’à {formatDate(report.mutedUntil, true)}</span>
      ) : null}
      <div className="adm-actions">
        <button
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => {
            if (confirm('Supprimer ce message pour tout le groupe ?'))
              exec(
                { action: 'report_delete_message', messageId: report.messageId },
                'Message supprimé.'
              );
          }}
        >
          Supprimer le message
        </button>
        <button
          className="btn btn-light btn-sm"
          disabled={busy}
          onClick={() =>
            exec({ action: 'report_dismiss', messageId: report.messageId }, 'Signalement ignoré.')
          }
        >
          Ignorer
        </button>
        {report.senderUserId ? (
          report.mutedUntil ? (
            <button
              className="btn btn-light btn-sm"
              disabled={busy}
              onClick={() =>
                exec(
                  { action: 'unmute_user', userId: report.senderUserId },
                  'L’élève peut de nouveau écrire.'
                )
              }
            >
              Rendre la parole
            </button>
          ) : (
            <button
              className="btn btn-light btn-sm"
              disabled={busy}
              onClick={() =>
                exec(
                  { action: 'mute_user', userId: report.senderUserId, minutes: 1440 },
                  'Auteur rendu muet pendant 24 h.'
                )
              }
            >
              Rendre muet 24 h
            </button>
          )
        ) : null}
        {report.senderUserId ? (
          <button
            className="btn btn-light btn-sm"
            disabled={busy}
            onClick={() => {
              if (confirm(`Suspendre le compte de ${report.senderName} ?`))
                exec({ action: 'suspend_user', id: report.senderUserId }, 'Compte suspendu.');
            }}
          >
            Suspendre l’auteur
          </button>
        ) : null}
      </div>
    </article>
  );
}
