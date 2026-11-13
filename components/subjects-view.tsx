'use client';
import { useMemo, useState } from 'react';
import { Icon } from './icons';
import { PaperRow } from './home-view';
import { subjectColor, subjectShort, type Paper } from './lib';

type Filter = 'all' | 'favorites' | 'review' | 'done' | 'free';

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SubjectsView({
  papers,
  focusSubject,
  onFocusSubject,
  onOpenPaper,
  onPremium,
  premium,
}: {
  papers: Paper[];
  focusSubject: string | null;
  onFocusSubject: (id: string | null) => void;
  onOpenPaper: (paper: Paper) => void;
  onPremium: () => void;
  premium: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [year, setYear] = useState<number | null>(null);

  const subjects = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; total: number; done: number; free: number }
    >();
    for (const p of papers) {
      const s = map.get(p.subjectId) || {
        id: p.subjectId,
        name: p.subjectName,
        total: 0,
        done: 0,
        free: 0,
      };
      s.total += 1;
      if (p.status === 'done') s.done += 1;
      if (p.free) s.free += 1;
      map.set(p.subjectId, s);
    }
    return [...map.values()];
  }, [papers]);

  const focused = subjects.find(s => s.id === focusSubject) || null;
  const term = normalize(search.trim());
  const showGrid = !focused && !term && filter === 'all';

  const visible = useMemo(() => {
    return papers
      .filter(p => !focused || p.subjectId === focused.id)
      .filter(p => !year || p.year === year)
      .filter(p =>
        filter === 'favorites'
          ? p.favorite
          : filter === 'review'
            ? p.status === 'review'
            : filter === 'done'
              ? p.status === 'done'
              : filter === 'free'
                ? p.free
                : true
      )
      .filter(
        p =>
          !term ||
          normalize(`${p.subjectName} ${p.title} ${p.year} ${p.session} ${p.classLabel}`).includes(
            term
          )
      )
      .sort((a, b) => b.year - a.year || a.subjectName.localeCompare(b.subjectName));
  }, [papers, focused, year, filter, term]);

  const years = useMemo(
    () =>
      [
        ...new Set(papers.filter(p => !focused || p.subjectId === focused.id).map(p => p.year)),
      ].sort((a, b) => b - a),
    [papers, focused]
  );

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'Tous' },
    { id: 'favorites', label: 'Favoris' },
    { id: 'review', label: 'À revoir' },
    { id: 'done', label: 'Faits' },
    ...(!premium ? [{ id: 'free' as Filter, label: 'Gratuits' }] : []),
  ];

  return (
    <div className="page">
      <div className="section-head" style={{ paddingTop: 2 }}>
        {focused ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Toutes les matières"
            onClick={() => {
              onFocusSubject(null);
              setYear(null);
            }}
          >
            <Icon name="back" />
          </button>
        ) : null}
        <h1 style={{ margin: 0, fontSize: '1.45rem', letterSpacing: '-0.02em', flex: 1 }}>
          {focused ? focused.name : 'Sujets'}
        </h1>
      </div>

      <div className="search">
        <Icon name="search" size={18} />
        <input
          className="input"
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une matière, une année…"
          aria-label="Rechercher un sujet"
        />
      </div>

      <div className="chips" role="group" aria-label="Filtrer">
        {filters.map(f => (
          <button
            key={f.id}
            type="button"
            className="chip"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showGrid ? (
        <div className="subject-grid">
          {subjects.map(s => {
            const color = subjectColor(s.name);
            return (
              <button
                key={s.id}
                type="button"
                className="subject-card"
                style={{ background: color }}
                onClick={() => onFocusSubject(s.id)}
              >
                <span className="abbr">{subjectShort(s.name)}</span>
                <span style={{ display: 'grid', gap: 3, width: '100%' }}>
                  <b>{s.name}</b>
                  <small>
                    {s.total} sujet{s.total > 1 ? 's' : ''}
                    {s.done ? `, ${s.done} fait${s.done > 1 ? 's' : ''}` : ''}
                  </small>
                  <span className="bar">
                    <span
                      style={{ width: `${s.total ? Math.round((s.done / s.total) * 100) : 0}%` }}
                    />
                  </span>
                </span>
              </button>
            );
          })}
          {!subjects.length ? (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              Les sujets de ta classe arrivent bientôt.
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {focused && years.length > 1 ? (
            <div className="chips" role="group" aria-label="Année">
              <button
                type="button"
                className="chip"
                aria-pressed={year === null}
                onClick={() => setYear(null)}
              >
                Toutes les années
              </button>
              {years.map(y => (
                <button
                  key={y}
                  type="button"
                  className="chip"
                  aria-pressed={year === y}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : null}
          <section className="card section">
            {visible.length ? (
              <div>
                {visible.map(p => (
                  <PaperRow key={p.id} paper={p} onOpen={onOpenPaper} />
                ))}
              </div>
            ) : (
              <div className="empty">
                {filter === 'favorites'
                  ? 'Aucun favori pour l’instant. Touche l’étoile d’un sujet pour le retrouver ici.'
                  : filter === 'review'
                    ? 'Aucun sujet à revoir.'
                    : filter === 'done'
                      ? 'Aucun sujet marqué comme fait.'
                      : 'Aucun sujet trouvé.'}
              </div>
            )}
          </section>
        </>
      )}

      {!premium && papers.some(p => p.locked) ? (
        <button type="button" className="action gold" onClick={onPremium}>
          <Icon name="star" />
          <span className="grow">
            Débloque tous les sujets et corrigés
            <small style={{ color: 'inherit', opacity: 0.8 }}>
              Les sujets avec un cadenas sont réservés au Premium
            </small>
          </span>
          <Icon name="chevron" />
        </button>
      ) : null}
    </div>
  );
}
