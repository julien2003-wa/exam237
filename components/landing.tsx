'use client';

/*
  Parties animées de la page de présentation (/bienvenue).
  Tout s'arrête si le téléphone demande moins d'animations, et rien ne tourne hors de l'écran.
*/

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { examTime } from '@/lib/exams';
import type { CatalogExam } from '@/lib/landing-data';

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduce;
}

function useOnScreen<T extends Element>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

/* ---------- Menu (téléphone) ---------- */

export function LandingMenu({ links }: { links: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="lp-menu">
      <button
        type="button"
        className="lp-menu-btn"
        aria-expanded={open}
        aria-controls="lp-menu-panel"
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={open ? 'x' : 'menu'} size={22} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="lp-menu-backdrop"
            aria-label="Fermer le menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <nav id="lp-menu-panel" className="lp-menu-panel" aria-label="Menu">
            {links.map(link => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
                <Icon name="chevron" size={18} />
              </a>
            ))}
            <a
              className="lp-btn lp-btn-sun"
              href="/connexion?mode=register"
              onClick={() => setOpen(false)}
            >
              Commencer gratuitement
            </a>
          </nav>
        </>
      ) : null}
    </div>
  );
}

/* ---------- La démo dans le téléphone : la vraie application, écran après écran ---------- */

export type DemoFrame = {
  src: string;
  caption: string;
  tap?: [number, number]; // endroit touché, en % de l'écran
  enter?: 'slide' | 'fade';
  still?: boolean; // l'écran montré seul quand le téléphone demande moins d'animations
};

const HOLD = 2300;
const LAST_HOLD = 3400;
const TAP = 520;

export function LandingDemo({ frames, label }: { frames: DemoFrame[]; label: string }) {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [tapping, setTapping] = useState(false);
  const [box, visible] = useOnScreen<HTMLElement>(0.3);
  const reduce = useReducedMotion();
  const [pageVisible, setPageVisible] = useState(true);
  const playing = visible && pageVisible && !reduce;

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Les écrans suivants se chargent une fois la page affichée.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const frame of frames.slice(1)) {
        const img = new Image();
        img.src = frame.src;
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [frames]);

  useEffect(() => {
    if (!playing) return;
    const frame = frames[index];
    let next = 0;
    const hold = window.setTimeout(
      () => {
        if (frame.tap) setTapping(true);
        next = window.setTimeout(
          () => {
            setTapping(false);
            setPrev(index);
            setIndex(i => (i + 1) % frames.length);
          },
          frame.tap ? TAP : 0
        );
      },
      index === frames.length - 1 ? LAST_HOLD : HOLD
    );
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(next);
    };
  }, [playing, index, frames]);

  // L'écran précédent reste dessous le temps que le nouveau arrive.
  useEffect(() => {
    if (prev === null) return;
    const timer = window.setTimeout(() => setPrev(null), 500);
    return () => window.clearTimeout(timer);
  }, [prev]);

  const shown = reduce
    ? Math.max(
        0,
        frames.findIndex(f => f.still)
      )
    : index;
  const current = frames[Math.max(0, shown)];

  return (
    <figure className="lp-demo" ref={box} data-playing={playing ? 'true' : 'false'}>
      <div className="lp-progress" aria-hidden="true">
        {frames.map((_, i) => (
          <i
            key={i}
            className={i < shown ? 'done' : i === shown ? 'now' : ''}
            style={
              i === shown
                ? ({
                    '--lp-d': `${(i === frames.length - 1 ? LAST_HOLD : HOLD) + (frames[i].tap ? TAP : 0)}ms`,
                  } as React.CSSProperties)
                : undefined
            }
          />
        ))}
      </div>
      <div className="lp-phone" role="img" aria-label={label}>
        <div className="lp-screen">
          {frames.map((frame, i) => (
            <img
              key={frame.src}
              src={frame.src}
              alt=""
              width={540}
              height={1169}
              decoding="async"
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : 'low'}
              className={`lp-frame ${frame.enter === 'slide' ? 'slide' : 'fade'} ${
                i === Math.max(0, shown) ? 'on' : i === prev ? 'prev' : ''
              }`}
            />
          ))}
          {tapping && current.tap ? (
            <span
              className="lp-tap"
              style={{ left: `${current.tap[0]}%`, top: `${current.tap[1]}%` }}
            />
          ) : null}
        </div>
      </div>
      <figcaption key={shown} className="lp-caption">
        {current.caption}
      </figcaption>
    </figure>
  );
}

/* ---------- Compte à rebours ---------- */

export type CountdownTarget = { title: string; date: string; caption: string };

const pad = (n: number) => String(n).padStart(2, '0');

export function ExamCountdown({
  targets,
  serverNow,
  more,
}: {
  targets: CountdownTarget[];
  serverNow: number;
  more?: { href: string; label: string };
}) {
  const [now, setNow] = useState(serverNow);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const target = targets[selected] || targets[0];
  if (!target) return null;
  const left = Math.max(0, examTime(target.date) - now);
  const parts = [
    { value: Math.floor(left / 86400000), unit: left >= 172800000 ? 'jours' : 'jour' },
    { value: Math.floor(left / 3600000) % 24, unit: 'heures' },
    { value: Math.floor(left / 60000) % 60, unit: 'minutes' },
    { value: Math.floor(left / 1000) % 60, unit: 'secondes' },
  ];
  return (
    <div className="lp-count">
      {targets.length > 1 ? (
        <div className="lp-count-tabs" role="tablist" aria-label="Examen">
          {targets.map((t, i) => (
            <button
              key={t.title}
              type="button"
              role="tab"
              aria-selected={i === selected}
              onClick={() => setSelected(i)}
            >
              {t.title}
            </button>
          ))}
        </div>
      ) : (
        <h2 className="lp-count-title">{target.title}</h2>
      )}
      <div
        className="lp-board"
        role="timer"
        aria-label={`${target.title} : ${parts[0].value} jours, ${parts[1].value} heures`}
      >
        {parts.map((part, i) => (
          <div key={part.unit} className="lp-tile">
            <span className="lp-digits" aria-hidden="true">
              <span key={i === 3 ? part.value : undefined} className={i === 3 ? 'tick' : ''}>
                {i === 0 ? String(part.value) : pad(part.value)}
              </span>
            </span>
            <span className="lp-unit" aria-hidden="true">
              {part.unit}
            </span>
          </div>
        ))}
      </div>
      <p className="lp-count-caption">
        {target.caption}
        {more ? (
          <>
            {' '}
            <a href={more.href}>{more.label}</a>
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ---------- Les sujets déjà disponibles ---------- */

export function SubjectExplorer({ catalog }: { catalog: CatalogExam[] }) {
  const [exam, setExam] = useState(0);
  const [subject, setSubject] = useState(0);
  const current = catalog[exam] || catalog[0];
  if (!current) return null;
  const chosen = current.subjects[subject] || current.subjects[0];
  return (
    <div className="lp-explorer">
      {catalog.length > 1 ? (
        <div className="lp-seg" role="tablist" aria-label="Examen">
          {catalog.map((c, i) => (
            <button
              key={c.exam}
              type="button"
              role="tab"
              aria-selected={i === exam}
              onClick={() => {
                setExam(i);
                setSubject(0);
              }}
            >
              {c.exam}
            </button>
          ))}
        </div>
      ) : null}
      <div className="lp-explorer-body">
        <div className="lp-subjects" role="list">
          {current.subjects.map((s, i) => {
            const total = s.years.reduce((sum, y) => sum + y.count, 0);
            return (
              <button
                key={s.name}
                type="button"
                role="listitem"
                aria-pressed={i === subject}
                onClick={() => setSubject(i)}
              >
                <span className="grow">{s.name}</span>
                <small>
                  {total} {total > 1 ? 'sujets' : 'sujet'}
                </small>
              </button>
            );
          })}
        </div>
        <div className="lp-years" aria-live="polite">
          <p className="lp-years-title">
            {chosen.name}, {current.exam}
          </p>
          <ul>
            {chosen.years.map(y => (
              <li key={y.year}>
                <div className="lp-year">
                  <b>{y.year}</b>
                  {y.fresh ? <em className="lp-new">Nouveau</em> : null}
                </div>
                <span>
                  {y.count > 1 ? `${y.count} sujets` : 'Sujet'}
                  {y.corrected ? ' et correction' : ''}
                </span>
                {y.corrected ? <Icon name="check" size={18} /> : null}
              </li>
            ))}
          </ul>
          <a className="lp-btn lp-btn-forest" href="/connexion?mode=register">
            Créer mon compte pour les ouvrir
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Ce que fait l'application (écrans réels) ---------- */

export type ShowcaseItem = { title: string; text: string; src: string; alt: string };

export function Showcase({ items }: { items: ShowcaseItem[] }) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(false);
  const [box, visible] = useOnScreen<HTMLDivElement>(0.4);
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement | null>(null);
  // Sur téléphone, les onglets défilent : l'onglet choisi reste visible.
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const tab = list.children[index] as HTMLElement | undefined;
    if (tab) list.scrollTo({ left: tab.offsetLeft - 20, behavior: reduce ? 'auto' : 'smooth' });
  }, [index, reduce]);
  useEffect(() => {
    if (chosen || reduce || !visible) return;
    const timer = window.setTimeout(() => setIndex(i => (i + 1) % items.length), 5200);
    return () => window.clearTimeout(timer);
  }, [chosen, reduce, visible, index, items.length]);
  return (
    <div className="lp-show" ref={box}>
      <div className="lp-show-phone">
        <div className="lp-phone small">
          <div className="lp-screen">
            {items.map((item, i) => (
              <img
                key={item.src}
                src={item.src}
                alt={i === index ? item.alt : ''}
                aria-hidden={i === index ? undefined : true}
                width={540}
                height={1169}
                loading="lazy"
                decoding="async"
                className={`lp-frame fade ${i === index ? 'on' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="lp-show-list" role="tablist" aria-label="Fonctions" ref={listRef}>
        {items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => {
              setChosen(true);
              setIndex(i);
            }}
          >
            <b>{item.title}</b>
            <span>{item.text}</span>
            {i === index && !chosen && !reduce && visible ? (
              <i className="lp-show-timer" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>
      <p className="lp-show-text" aria-live="polite">
        {items[index].text}
      </p>
    </div>
  );
}

/* ---------- Bouton « Commencer » fixe (téléphone) et WhatsApp ---------- */

export function StickyActions({ whatsapp }: { whatsapp: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById('lp-hero-cta');
    const final = document.getElementById('lp-final');
    let heroOn = true;
    let finalOn = false;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === hero) heroOn = entry.isIntersecting;
        if (entry.target === final) finalOn = entry.isIntersecting;
      }
      setShow(!heroOn && !finalOn);
    });
    if (hero) observer.observe(hero);
    if (final) observer.observe(final);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div className={`lp-sticky ${show ? 'on' : ''}`}>
        <a className="lp-btn lp-btn-sun" href="/connexion?mode=register" tabIndex={show ? 0 : -1}>
          Commencer gratuitement
        </a>
        {whatsapp ? (
          <a
            className="lp-sticky-wa"
            href={whatsapp}
            target="_blank"
            rel="noopener"
            tabIndex={show ? 0 : -1}
            aria-label="Poser une question sur WhatsApp"
          >
            <Icon name="chat" size={22} />
          </a>
        ) : null}
      </div>
      {whatsapp ? (
        <a
          className={`lp-wa ${show ? 'raised' : ''}`}
          href={whatsapp}
          target="_blank"
          rel="noopener"
          aria-label="Poser une question sur WhatsApp"
        >
          <Icon name="chat" size={22} />
          <span>Une question ?</span>
        </a>
      ) : null}
    </>
  );
}
