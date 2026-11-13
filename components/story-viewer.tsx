'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import {
  post,
  readLocal,
  whatsappUrl,
  writeLocal,
  type Promo,
  type Site,
  type Viewer,
} from './lib';

const SEEN_KEY = 'exam237-promos-vues';

function markSeen(id: string) {
  const seen = readLocal<string[]>(SEEN_KEY, []);
  if (!seen.includes(id)) writeLocal(SEEN_KEY, [id, ...seen].slice(0, 100));
}

const counted = new Set<string>();

export default function StoryViewer({
  promos,
  start,
  site,
  viewer,
  onClose,
  onPremium,
}: {
  promos: Promo[];
  start: number;
  site: Site;
  viewer: Viewer;
  onClose: () => void;
  onPremium: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const promo = promos[index];

  // Une vue comptée par vidéo et par visite ; aucune lecture automatique (économie de données).
  useEffect(() => {
    if (!promo) return;
    markSeen(promo.id);
    setPlaying(false);
    setProgress(0);
    if (!counted.has(promo.id)) {
      counted.add(promo.id);
      post('/api/me', { action: 'promo_event', promoId: promo.id, kind: 'view' }).catch(() => {});
    }
  }, [promo]);

  const next = useCallback(() => {
    if (index < promos.length - 1) setIndex(i => i + 1);
    else onClose();
  }, [index, promos.length, onClose]);
  const prev = () => setIndex(i => Math.max(0, i - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onClose]);

  if (!promo) return null;

  const cta = () => {
    post('/api/me', { action: 'promo_event', promoId: promo.id, kind: 'click' }).catch(() => {});
    if (promo.ctaType === 'premium') return onPremium();
    if (promo.ctaType === 'whatsapp')
      return window.open(
        whatsappUrl(
          site.whatsapp,
          `Bonjour Exam237, j’ai vu la vidéo « ${promo.title} ». Je m’appelle ${viewer.displayName || ''}.`
        ),
        '_blank',
        'noopener'
      );
    if (promo.ctaType === 'link' && promo.ctaUrl) window.open(promo.ctaUrl, '_blank', 'noopener');
  };
  const ctaLabel =
    promo.ctaLabel ||
    (promo.ctaType === 'premium'
      ? 'Passer Premium'
      : promo.ctaType === 'whatsapp'
        ? 'Écrire sur WhatsApp'
        : promo.ctaType === 'link'
          ? 'En savoir plus'
          : '');

  return (
    <div className="story-view" role="dialog" aria-modal="true" aria-label={promo.title}>
      <div
        className="story-bars"
        style={{ gridTemplateColumns: `repeat(${promos.length}, minmax(0, 1fr))` }}
        aria-label={`Vidéo ${index + 1} sur ${promos.length}`}
      >
        {promos.map((p, i) => (
          <span key={p.id}>
            <i style={{ width: i < index ? '100%' : i === index ? `${progress}%` : '0%' }} />
          </span>
        ))}
      </div>

      <div className="story-head">
        <span className="who">
          <img src="/logo.png" alt="" />
        </span>
        <div className="t">
          <b>{promo.kind === 'partner' ? 'Partenaire d’Exam237' : 'Exam237'}</b>
          <small>{promo.title}</small>
        </div>
        <button type="button" className="icon-btn" aria-label="Fermer la vidéo" onClick={onClose}>
          <Icon name="x" size={24} strokeWidth={2.2} />
        </button>
      </div>

      <div className="story-stage">
        {!playing ? (
          <>
            {index > 0 ? (
              <button
                type="button"
                className="story-nav prev"
                aria-label="Vidéo précédente"
                onClick={prev}
              />
            ) : null}
            {promos.length > 1 ? (
              <button
                type="button"
                className="story-nav next"
                aria-label="Vidéo suivante"
                onClick={next}
              />
            ) : null}
            <div className="title">{promo.title}</div>
            <button
              type="button"
              className="story-play"
              aria-label="Lire la vidéo"
              style={{ position: 'relative', zIndex: 3 }}
              onClick={() => setPlaying(true)}
            >
              <Icon name="play" size={36} />
            </button>
            <div className="hint">La vidéo se charge seulement quand tu appuies.</div>
          </>
        ) : promo.videoUrl ? (
          <video
            ref={videoRef}
            src={promo.videoUrl}
            autoPlay
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={e => {
              const v = e.currentTarget;
              if (v.duration) setProgress(Math.min(100, (v.currentTime / v.duration) * 100));
            }}
            onEnded={() => {
              setProgress(100);
              window.setTimeout(next, 600);
            }}
          />
        ) : promo.youtubeId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${promo.youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
            title={promo.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            onLoad={() => setProgress(100)}
          />
        ) : null}
      </div>

      {ctaLabel ? (
        <button type="button" className="btn btn-gold btn-lg" onClick={cta}>
          {promo.ctaType === 'premium' ? <Icon name="star" size={18} /> : null}
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
