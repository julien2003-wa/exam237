'use client';
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import {
  formatSize,
  isSavedOffline,
  offlineSupported,
  post,
  saveOffline,
  subjectColor,
  subjectShort,
  whatsappUrl,
  type Notify,
  type Paper,
  type Viewer,
} from './lib';

export default function PaperSheet({
  paper,
  viewer,
  onClose,
  onPremium,
  onState,
  onExam,
  notify,
}: {
  paper: Paper;
  viewer: Viewer;
  onClose: () => void;
  onPremium: () => void;
  onState: (patch: { favorite?: boolean; status?: 'done' | 'review' | null }) => void;
  onExam: () => void;
  notify: Notify;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [reporting, setReporting] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportTarget, setReportTarget] = useState<string>('');
  const [sending, setSending] = useState(false);
  const color = subjectColor(paper.subjectName);
  const title = `${paper.subjectName} · ${paper.year}`;

  useEffect(() => {
    const urls = [paper.paperUrl, ...paper.corrections.map(c => c.pdfUrl)].filter(
      Boolean
    ) as string[];
    setSaved(Object.fromEntries(urls.map(u => [u, isSavedOffline(u)])));
  }, [paper]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = (url: string | null) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  };

  const download = async (url: string, kind: 'paper' | 'correction', label: string) => {
    if (!viewer.premium) return onPremium();
    setSaving(url);
    try {
      const size = await saveOffline(url, { title, subtitle: label, kind });
      setSaved(s => ({ ...s, [url]: true }));
      notify(`Enregistré sur ton téléphone (${formatSize(size)}).`);
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setSaving(null);
    }
  };

  const share = async () => {
    const link = `${window.location.origin}/bienvenue`;
    const text = `Je révise « ${paper.subjectName} ${paper.year} » sur Exam237, avec des corrigés expliqués comme en classe. Rejoins-moi : ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Exam237', text });
        return;
      }
    } catch {
      return;
    }
    window.open(whatsappUrl('', text), '_blank', 'noopener');
  };

  const sendReport = async () => {
    if (reportText.trim().length < 5) return notify('Décris l’erreur en quelques mots.', 'error');
    setSending(true);
    try {
      await post('/api/me', {
        action: 'report_content',
        paperId: paper.id,
        correctionId: reportTarget || null,
        message: reportText.trim(),
      });
      notify('Merci ! Exam237 va vérifier et corriger.');
      setReporting(false);
      setReportText('');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const status = paper.status;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="subject-tile" style={{ background: color }}>
            {subjectShort(paper.subjectName)}
          </span>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="paper-row" style={{ borderTop: 0, padding: 0 }}>
          <span className="tags">
            <span className="mini-pill">{paper.classLabel}</span>
            <span className="mini-pill">{paper.session}</span>
            {paper.durationMinutes ? (
              <span className="mini-pill">
                <Icon name="clock" size={12} /> {Math.floor(paper.durationMinutes / 60)} h
                {paper.durationMinutes % 60
                  ? String(paper.durationMinutes % 60).padStart(2, '0')
                  : ''}
              </span>
            ) : null}
            {paper.isNew ? <span className="pill pill-new">Nouveau</span> : null}
            {paper.free ? <span className="pill pill-free">Gratuit</span> : null}
          </span>
        </div>

        {paper.locked ? (
          <div className="action-list">
            <button type="button" className="action gold" onClick={onPremium}>
              <Icon name="lock" />
              <span className="grow">
                Réservé au Premium
                <small style={{ color: 'inherit', opacity: 0.85 }}>
                  Sujet
                  {paper.corrections.length
                    ? ` + ${paper.corrections.length} correction${paper.corrections.length > 1 ? 's' : ''} expliquée${paper.corrections.length > 1 ? 's' : ''}`
                    : ''}
                  {paper.corrections.some(c => c.hasVideo) ? ' + vidéo' : ''}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          </div>
        ) : (
          <div className="action-list">
            <button type="button" className="action primary" onClick={() => open(paper.paperUrl)}>
              <Icon name="file" />
              <span className="grow">
                Ouvrir le sujet
                <small>PDF</small>
              </span>
              <Icon name="chevron" />
            </button>
            {paper.corrections.map(c => (
              <div key={c.id} className="action-list">
                {c.pdfUrl ? (
                  <button type="button" className="action" onClick={() => open(c.pdfUrl)}>
                    <Icon name="check" />
                    <span className="grow">
                      {c.title || 'Correction'}
                      <small>
                        {c.reviewer ? `Relue par ${c.reviewer}` : 'Correction expliquée'}
                      </small>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ) : null}
                {c.videoUrl ? (
                  <button type="button" className="action" onClick={() => open(c.videoUrl)}>
                    <Icon name="video" />
                    <span className="grow">
                      Vidéo d’explication
                      <small>{c.title || 'Correction'}</small>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ) : null}
              </div>
            ))}
            {!paper.corrections.length ? (
              <p className="fine" style={{ textAlign: 'left' }}>
                La correction de ce sujet arrive bientôt.
              </p>
            ) : null}
            <button type="button" className="action" onClick={onExam}>
              <Icon name="clock" />
              <span className="grow">
                Mode examen
                <small>Compose avec le chrono, puis vois la correction</small>
              </span>
              <Icon name="chevron" />
            </button>
            {offlineSupported() && paper.paperUrl ? (
              <button
                type="button"
                className="action"
                aria-disabled={saving !== null}
                onClick={async () => {
                  if (saving) return;
                  await download(paper.paperUrl!, 'paper', 'Sujet');
                  for (const c of paper.corrections)
                    if (c.pdfUrl && viewer.premium)
                      await download(c.pdfUrl, 'correction', c.title || 'Correction');
                }}
              >
                <Icon name={viewer.premium ? 'download' : 'lock'} />
                <span className="grow">
                  {saved[paper.paperUrl] ? 'Sur ton téléphone ✓' : 'Lire sans connexion'}
                  <small>
                    {viewer.premium
                      ? saving
                        ? 'Téléchargement…'
                        : 'Sujet et corrections enregistrés sur ton téléphone'
                      : 'Réservé au Premium'}
                  </small>
                </span>
              </button>
            ) : null}
          </div>
        )}

        <div className="toggle-row" role="group" aria-label="Mon suivi">
          <button
            type="button"
            className="toggle"
            aria-pressed={paper.favorite}
            onClick={() => onState({ favorite: !paper.favorite })}
          >
            <Icon name="star" size={18} />
            Favori
          </button>
          <button
            type="button"
            className="toggle"
            aria-pressed={status === 'done'}
            onClick={() => onState({ status: status === 'done' ? null : 'done' })}
          >
            <Icon name="check" size={18} />
            Fait
          </button>
          <button
            type="button"
            className="toggle"
            aria-pressed={status === 'review'}
            onClick={() => onState({ status: status === 'review' ? null : 'review' })}
          >
            <Icon name="refresh" size={18} />À revoir
          </button>
        </div>

        <div className="duo">
          <button type="button" className="btn btn-light" onClick={share}>
            <Icon name="share" size={18} />
            Partager
          </button>
          <button
            type="button"
            className="btn btn-light"
            aria-expanded={reporting}
            aria-label="Signaler une erreur"
            onClick={() => setReporting(v => !v)}
          >
            <Icon name="flag" size={18} />
            Signaler
          </button>
        </div>

        {reporting ? (
          <div className="card stack" style={{ padding: 14 }}>
            <b>Signaler une erreur</b>
            {paper.corrections.length ? (
              <div className="field">
                <label htmlFor="report-target">Où est l’erreur ?</label>
                <select
                  id="report-target"
                  className="select"
                  value={reportTarget}
                  onChange={e => setReportTarget(e.target.value)}
                >
                  <option value="">Dans le sujet</option>
                  {paper.corrections.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.title || 'Correction'}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="report-text">Explique en quelques mots</label>
              <textarea
                id="report-text"
                className="textarea"
                value={reportText}
                maxLength={800}
                onChange={e => setReportText(e.target.value)}
                placeholder="Ex. : à la question 2b, le résultat devrait être 4,8 cm."
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending}
              onClick={sendReport}
            >
              {sending ? 'Envoi…' : 'Envoyer à Exam237'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
