'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import {
  post,
  readLocal,
  SEEN_EVENT,
  whatsappUrl,
  writeLocal,
  type Promo,
  type Site,
  type Viewer,
} from './lib';

/*
  Statuts comme sur WhatsApp : l'image de la vidéo s'affiche tout de suite et la vidéo démarre
  seule, en plein écran.
  - Toucher à droite : statut suivant. Toucher à gauche : précédent (ou recommencer le premier).
  - Appui long : pause (les barres et le bouton disparaissent, comme sur WhatsApp).
  - Glisser vers le bas : fermer. À la fin d'une vidéo, la suivante démarre.
  - Si le téléphone refuse le son automatique, la vidéo part sans le son : un appui le remet.
*/

const SEEN_KEY = 'exam237-promos-vues';
const HOLD_MS = 220;
const SWIPE_CLOSE = 90;

function markSeen(id: string) {
  const seen = readLocal<string[]>(SEEN_KEY, []);
  if (seen.includes(id)) return;
  writeLocal(SEEN_KEY, [id, ...seen].slice(0, 100));
  window.dispatchEvent(new Event(SEEN_EVENT));
}

const counted = new Set<string>();

// « il y a 5 min », « il y a 3 h », « hier », puis la date.
function ago(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return new Date(time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

type Press = { x: number; y: number; held: boolean; dragged: boolean; timer: number };

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
  const [holding, setHolding] = useState(false); // appui long : pause, interface cachée
  const [hidden, setHidden] = useState(false); // application en arrière-plan
  const [manualPause, setManualPause] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [drag, setDrag] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const press = useRef<Press | null>(null);
  const promo = promos[index];
  const paused = holding || hidden || manualPause || drag > 0;

  // Une vue comptée par statut et par visite ; l'image du suivant est préparée.
  useEffect(() => {
    if (!promo) return;
    markSeen(promo.id);
    setLoading(true);
    setFailed(false);
    setManualPause(false);
    if (barRef.current) barRef.current.style.width = '0%';
    if (!counted.has(promo.id)) {
      counted.add(promo.id);
      post('/api/me', { action: 'promo_event', promoId: promo.id, kind: 'view' }).catch(() => {});
    }
    const following = promos[index + 1]?.posterUrl;
    if (following) new Image().src = following;
  }, [promo, index, promos]);

  const next = useCallback(() => {
    if (index < promos.length - 1) setIndex(i => i + 1);
    else onClose();
  }, [index, promos.length, onClose]);

  const prev = useCallback(() => {
    if (index > 0) return setIndex(i => i - 1);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }, [index]);

  // Démarrage : avec le son si le téléphone l'accepte, sinon sans le son.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !promo?.videoUrl) return;
    video.muted = muted;
    video.play().catch(error => {
      if (error?.name !== 'NotAllowedError') return;
      video.muted = true;
      setMuted(true);
      setSoundBlocked(true);
      video.play().catch(() => {});
    });
    // `muted` volontairement absent : couper le son ne doit pas relancer la vidéo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promo?.id, attempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else if (!failed) video.play().catch(() => {});
  }, [paused, failed]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Barre du statut en cours : avance avec la vidéo (sans redessiner tout l'écran).
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && video.duration && barRef.current)
        barRef.current.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index]);

  // Comme WhatsApp : pause quand on quitte l'application, reprise au retour.
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') {
        e.preventDefault();
        setManualPause(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  if (!promo) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const state: Press = { x: e.clientX, y: e.clientY, held: false, dragged: false, timer: 0 };
    state.timer = window.setTimeout(() => {
      state.held = true;
      setHolding(true);
    }, HOLD_MS);
    press.current = state;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = press.current;
    if (!state) return;
    const dx = e.clientX - state.x;
    const dy = e.clientY - state.y;
    if (!state.dragged && dy > 12 && dy > Math.abs(dx)) {
      state.dragged = true;
      window.clearTimeout(state.timer);
    }
    if (state.dragged) setDrag(Math.max(0, dy));
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const state = press.current;
    press.current = null;
    if (!state) return;
    window.clearTimeout(state.timer);
    const dx = e.clientX - state.x;
    const dy = e.clientY - state.y;
    if (state.dragged) {
      if (!cancelled && dy > SWIPE_CLOSE) return onClose();
      return setDrag(0);
    }
    if (state.held) return setHolding(false);
    if (cancelled || Math.abs(dx) > 30 || Math.abs(dy) > 30) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (e.clientX - box.left < box.width / 3) prev();
    else next();
  };

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
  // Un élève déjà Premium ne voit pas « Passer Premium ».
  const ctaLabel =
    promo.ctaType === 'premium' && viewer.premium
      ? ''
      : promo.ctaLabel ||
        (promo.ctaType === 'premium'
          ? 'Passer Premium'
          : promo.ctaType === 'whatsapp'
            ? 'Écrire sur WhatsApp'
            : promo.ctaType === 'link'
              ? 'En savoir plus'
              : '');
  const when = ago(promo.createdAt);
  const isYoutube = !promo.videoUrl && !!promo.youtubeId;

  return (
    <div
      className={`story-view ${drag ? 'dragging' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={promo.title}
      style={
        drag
          ? { transform: `translateY(${drag}px)`, opacity: Math.max(0.35, 1 - drag / 500) }
          : undefined
      }
    >
      {promo.videoUrl ? (
        <video
          key={`${promo.id}-${attempt}`}
          ref={videoRef}
          className="story-media"
          src={promo.videoUrl}
          poster={promo.posterUrl || undefined}
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onEnded={next}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
        />
      ) : (
        <>
          {promo.posterUrl && loading ? (
            <img className="story-media" src={promo.posterUrl} alt="" />
          ) : null}
          {promo.youtubeId ? (
            <iframe
              key={promo.id}
              className="story-media"
              src={`https://www.youtube-nocookie.com/embed/${promo.youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
              title={promo.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              onLoad={() => {
                setLoading(false);
                if (barRef.current) barRef.current.style.width = '100%';
              }}
            />
          ) : null}
        </>
      )}

      {loading && !failed ? <span className="story-spinner" aria-hidden="true" /> : null}

      <div
        className={`story-tap ${isYoutube ? 'edges' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => endPress(e)}
        onPointerCancel={e => endPress(e, true)}
        onContextMenu={e => e.preventDefault()}
        aria-hidden="true"
      >
        {isYoutube ? (
          <>
            <span className="left" />
            <span className="right" />
          </>
        ) : null}
      </div>

      {failed ? (
        <div className="story-error" role="alert">
          <p>La vidéo ne se lit pas. Vérifie ta connexion internet.</p>
          <button
            type="button"
            className="btn btn-light"
            onClick={() => {
              setFailed(false);
              setLoading(true);
              setAttempt(a => a + 1);
            }}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {soundBlocked && muted && !failed ? (
        <button
          type="button"
          className="story-sound"
          onClick={() => {
            setMuted(false);
            setSoundBlocked(false);
          }}
        >
          <Icon name="volumeOff" size={18} />
          Toucher pour le son
        </button>
      ) : null}

      <div className={`story-top ${holding ? 'hide' : ''}`}>
        <div
          className="story-bars"
          style={{ gridTemplateColumns: `repeat(${promos.length}, minmax(0, 1fr))` }}
          aria-label={`Statut ${index + 1} sur ${promos.length}`}
        >
          {promos.map((p, i) => (
            <span key={p.id}>
              {i === index ? (
                <i ref={barRef} />
              ) : (
                <i style={{ width: i < index ? '100%' : '0%' }} />
              )}
            </span>
          ))}
        </div>
        <div className="story-head">
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="back" size={24} strokeWidth={2.2} />
          </button>
          <span className="who">
            <img src="/logo.png" alt="" />
          </span>
          <div className="t">
            <b>{promo.kind === 'partner' ? 'Partenaire d’Exam237' : 'Exam237'}</b>
            {when ? <small>{when}</small> : null}
          </div>
          {promo.videoUrl ? (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label={manualPause ? 'Reprendre' : 'Pause'}
                onClick={() => setManualPause(v => !v)}
              >
                <Icon name={manualPause ? 'play' : 'pause'} size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={muted ? 'Activer le son' : 'Couper le son'}
                onClick={() => {
                  setMuted(v => !v);
                  setSoundBlocked(false);
                }}
              >
                <Icon name={muted ? 'volumeOff' : 'volume'} size={22} />
              </button>
            </>
          ) : null}
        </div>
        <button type="button" className="sr-only" onClick={prev}>
          Statut précédent
        </button>
        <button type="button" className="sr-only" onClick={next}>
          Statut suivant
        </button>
      </div>

      <div className={`story-bottom ${holding ? 'hide' : ''}`}>
        <p className="story-caption">{promo.title}</p>
        {ctaLabel ? (
          <button type="button" className="btn btn-gold btn-lg" onClick={cta}>
            {promo.ctaType === 'premium' ? <Icon name="star" size={18} /> : null}
            {ctaLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
