'use client';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { daysBefore, examTargetFor } from '@/lib/exams';
import {
  daysLeft,
  frDate,
  readLocal,
  SEEN_EVENT,
  subjectColor,
  subjectShort,
  timeAgo,
  type Bootstrap,
  type Paper,
} from './lib';

const SEEN_KEY = 'exam237-promos-vues';

export default function HomeView({
  data,
  unread,
  onOpenPaper,
  onOpenStory,
  onPremium,
  onOpenSubjects,
  onOpenProfile,
}: {
  data: Bootstrap;
  unread: number;
  onOpenPaper: (paper: Paper) => void;
  onOpenStory: (index: number) => void;
  onPremium: (renew?: boolean) => void;
  onOpenSubjects: (subjectId?: string) => void;
  onOpenProfile: () => void;
}) {
  const { viewer, papers, promos, site, resume } = data;
  const first = (viewer.displayName || '').split(' ')[0] || '';
  const initials = (viewer.displayName || viewer.email || 'E')
    .split(/\s+/)
    .map(w => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => setSeen(readLocal<string[]>(SEEN_KEY, []));
    refresh();
    window.addEventListener(SEEN_EVENT, refresh);
    return () => window.removeEventListener(SEEN_EVENT, refresh);
  }, [promos]);

  const subjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; done: number }>();
    for (const p of papers) {
      const s = map.get(p.subjectId) || { id: p.subjectId, name: p.subjectName, total: 0, done: 0 };
      s.total += 1;
      if (p.status === 'done') s.done += 1;
      map.set(p.subjectId, s);
    }
    return [...map.values()];
  }, [papers]);
  const doneCount = papers.filter(p => p.status === 'done').length;
  const latest = useMemo(
    () =>
      papers
        .slice()
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, 4),
    [papers]
  );
  const favorites = papers.filter(p => p.favorite).slice(0, 4);
  const resumePaper = resume ? papers.find(p => p.id === resume.paperId) : null;
  // La date de l'examen (Réglages) ou, en attendant, le début officiel de la période d'examens.
  const exam = examTargetFor(site.examDate, viewer.examType);
  const examDays = exam ? daysBefore(exam.date) : null;
  const premiumDays = daysLeft(viewer.premiumUntil);

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-top">
            <img src="/logo.png" alt="Exam237" />
            <div className="hero-hello">
              <b>{first ? `Bonjour ${first}` : 'Bienvenue'}</b>
              <span>{viewer.classLabel || viewer.groupLabel || 'Exam237'}</span>
            </div>
            <button
              type="button"
              className="avatar-btn"
              aria-label="Mon profil"
              onClick={onOpenProfile}
            >
              {initials}
            </button>
          </div>

          {promos.length ? (
            <div className="stories" role="list" aria-label="Vidéos Exam237">
              {promos.map((promo, index) => (
                <button
                  key={promo.id}
                  type="button"
                  role="listitem"
                  className={`story ${seen.includes(promo.id) ? 'seen' : ''}`}
                  onClick={() => onOpenStory(index)}
                >
                  <span className="story-ring">
                    <span
                      className={`story-inner ${promo.posterUrl ? 'photo' : promo.kind === 'partner' ? 'partner' : promo.ctaType === 'premium' ? 'premium' : ''}`}
                    >
                      {promo.posterUrl ? (
                        <img src={promo.posterUrl} alt="" decoding="async" />
                      ) : promo.kind === 'partner' ? (
                        <Icon name="megaphone" size={26} />
                      ) : promo.ctaType === 'premium' ? (
                        <Icon name="star" size={26} />
                      ) : (
                        <img src="/logo.png" alt="" />
                      )}
                    </span>
                  </span>
                  <span className="story-label">
                    {promo.kind === 'partner' ? 'Partenaire' : promo.title}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="page">
        {viewer.premium ? (
          premiumDays !== null && premiumDays <= 5 ? (
            <div className="banner">
              <Icon name="clock" />
              <span>
                Ton Premium se termine {premiumDays <= 1 ? 'demain' : `dans ${premiumDays} jours`}.
              </span>
              <button className="btn btn-gold btn-sm" onClick={() => onPremium(true)}>
                Renouveler
              </button>
            </div>
          ) : (
            <section className="card plan-card premium">
              <span className="tag gold">Premium actif</span>
              <h2>Jusqu’au {frDate(viewer.premiumUntil)}</h2>
              <p>Tous tes sujets, corrigés et vidéos sont débloqués.</p>
            </section>
          )
        ) : (
          <section className="card plan-card">
            <span className="tag">Version gratuite</span>
            <h2>Débloque tous les sujets corrigés</h2>
            <p>Toutes les corrections, les vidéos, le Prof IA et la lecture sans connexion.</p>
            <button type="button" className="btn btn-gold btn-lg" onClick={() => onPremium()}>
              <Icon name="star" size={18} />
              Passer Premium
            </button>
          </section>
        )}

        <div className="duo">
          {exam && examDays !== null ? (
            <section className="count-card" aria-label={`${exam.title} dans ${examDays} jours`}>
              <span className="k">{exam.title}</span>
              <span className="n">{examDays}</span>
              <span className="s">
                {exam.exact
                  ? examDays === 1
                    ? 'jour pour réviser'
                    : 'jours pour réviser'
                  : examDays === 1
                    ? 'jour avant le début'
                    : 'jours avant le début'}
              </span>
            </section>
          ) : (
            <section className="count-card">
              <span className="k">Ma progression</span>
              <span className="n">{doneCount}</span>
              <span className="s">{doneCount === 1 ? 'sujet fait' : 'sujets faits'}</span>
            </section>
          )}
          {resumePaper ? (
            <section className="card mini-card">
              <span className="k">Reprendre</span>
              <b>
                {resumePaper.subjectName} {resumePaper.year}
              </b>
              <small>Ouvert {timeAgo(resume!.openedAt)}</small>
              <button className="btn btn-primary btn-sm" onClick={() => onOpenPaper(resumePaper)}>
                Rouvrir
              </button>
            </section>
          ) : (
            <section className="card mini-card">
              <span className="k">Pour commencer</span>
              <b>
                {viewer.premium
                  ? 'Tous tes sujets sont débloqués'
                  : 'Un sujet corrigé offert par matière'}
              </b>
              <small>
                {unread > 0
                  ? `${unread} message${unread > 1 ? 's' : ''} dans le chat`
                  : 'Choisis une matière'}
              </small>
              <button className="btn btn-primary btn-sm" onClick={() => onOpenSubjects()}>
                Voir les sujets
              </button>
            </section>
          )}
        </div>

        {subjects.length ? (
          <section className="card section">
            <div className="section-head">
              <h2>Ma progression</h2>
              <small>
                {doneCount} sujet{doneCount > 1 ? 's' : ''} fait{doneCount > 1 ? 's' : ''}
              </small>
            </div>
            {subjects.map(s => {
              const color = subjectColor(s.name);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="progress-row"
                  style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left' }}
                  onClick={() => onOpenSubjects(s.id)}
                >
                  <span className="subject-tile" style={{ background: color }}>
                    {subjectShort(s.name)}
                  </span>
                  <span className="progress-body">
                    <span className="progress-line">
                      <b>{s.name}</b>
                      <span>
                        {s.done}/{s.total}
                      </span>
                    </span>
                    <span className="bar">
                      <span
                        style={{
                          width: `${s.total ? Math.round((s.done / s.total) * 100) : 0}%`,
                          background: color,
                        }}
                      />
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        ) : null}

        {favorites.length ? (
          <section className="card section">
            <div className="section-head">
              <h2>Mes favoris</h2>
            </div>
            <div>
              {favorites.map(p => (
                <PaperRow key={p.id} paper={p} onOpen={onOpenPaper} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="card section">
          <div className="section-head">
            <h2>Derniers sujets</h2>
            <button className="btn btn-light btn-sm" onClick={() => onOpenSubjects()}>
              Tout voir
            </button>
          </div>
          <div>
            {latest.length ? (
              latest.map(p => <PaperRow key={p.id} paper={p} onOpen={onOpenPaper} />)
            ) : (
              <div className="empty">Les sujets de ta classe arrivent bientôt.</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function PaperRow({ paper, onOpen }: { paper: Paper; onOpen: (paper: Paper) => void }) {
  const color = subjectColor(paper.subjectName);
  return (
    <button type="button" className="paper-row" onClick={() => onOpen(paper)}>
      <span className="subject-tile" style={{ background: color }}>
        {subjectShort(paper.subjectName)}
      </span>
      <span className="meta">
        <b>
          {paper.subjectName} {paper.year}
        </b>
        <span className="tags">
          <small>{paper.session}</small>
          {paper.isNew ? <span className="pill pill-new">Nouveau</span> : null}
          {paper.free ? <span className="pill pill-free">Gratuit</span> : null}
          {paper.status === 'done' ? <span className="pill pill-done">Fait</span> : null}
          {paper.status === 'review' ? <span className="pill pill-review">À revoir</span> : null}
          {paper.favorite ? (
            <span className="pill pill-premium" aria-label="Favori">
              <Icon name="star" size={11} strokeWidth={3} />
            </span>
          ) : null}
        </span>
      </span>
      {paper.locked ? (
        <span className="round lock" aria-label="Réservé au Premium">
          <Icon name="lock" size={18} />
        </span>
      ) : (
        <span className="round" aria-hidden="true">
          <Icon name="chevron" size={18} strokeWidth={2.4} />
        </span>
      )}
    </button>
  );
}
