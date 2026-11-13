'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { api, copyText, post, type Notify, type Viewer } from './lib';
import chat from './chat-view.module.css';
import styles from './tutor-view.module.css';

/*
  Prof IA privé (Premium) : l'élève pose une question ou envoie la photo d'un exercice.
  Le Prof donne d'abord des indices, puis la solution complète si l'élève la demande.
*/

type TutorImage = { mediaType: string; data: string };
type TMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  hasImage: boolean;
  createdAt: string;
  preview?: string;
  status?: 'sending' | 'failed';
  retry?: { text: string; image: TutorImage | null; preview?: string };
};
type State = {
  configured: boolean;
  premium: boolean;
  limit: number;
  used: number;
};

const STARTERS = [
  { icon: 'book', label: 'Explique-moi une leçon', text: 'Explique-moi simplement : ' },
  {
    icon: 'sparkles',
    label: 'Un indice pour mon exercice',
    text: 'Donne-moi un indice pour cet exercice : ',
  },
  { icon: 'check', label: 'Vérifie ma réponse', text: 'Voici ma réponse, est-elle juste ? ' },
  { icon: 'cap', label: 'Fais-moi réviser', text: 'Pose-moi 5 questions pour réviser : ' },
];
const FOLLOW_UPS = [
  'Un autre indice',
  'Je n’ai pas compris',
  'Montre-moi la solution complète',
  'Donne-moi un exercice du même type',
];

const time = (value: string) =>
  new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

// Réduit la photo dans le téléphone avant l'envoi : plus rapide, même en 3G.
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Photo illisible. Essaie une autre image (JPG ou PNG).'));
    };
    img.src = url;
  });
}
async function prepareImage(file: File): Promise<{ image: TutorImage; preview: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une photo (JPG ou PNG).');
  const img = await loadImage(file);
  for (const [max, quality] of [
    [1600, 0.82],
    [1280, 0.72],
    [1000, 0.62],
  ] as const) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (data.length <= 3_800_000)
      return { image: { mediaType: 'image/jpeg', data }, preview: dataUrl };
  }
  throw new Error('Photo trop lourde. Essaie de la recadrer.');
}

export default function TutorView({
  viewer,
  notify,
  onBack,
  onPremium,
}: {
  viewer: Viewer;
  notify: Notify;
  onBack: () => void;
  onPremium: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ image: TutorImage; preview: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selected, setSelected] = useState<TMsg | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api('/api/me?action=tutor');
      setState({
        configured: !!d.configured,
        premium: !!d.premium,
        limit: Number(d.limit) || 0,
        used: Number(d.used) || 0,
      });
      setMessages(d.messages || []);
      scrollToBottom();
    } catch (e: any) {
      setError(e.message);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    load();
  }, [load]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    try {
      setAttachment(await prepareImage(file));
      inputRef.current?.focus();
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const ask = async (
    questionText: string,
    image: TutorImage | null,
    preview?: string,
    retryOf?: string
  ) => {
    if (thinking) return;
    const tempId = retryOf || `tmp-${Date.now().toString(36)}`;
    const temp: TMsg = {
      id: tempId,
      role: 'user',
      text: questionText || 'Aide-moi avec cet exercice.',
      hasImage: !!image,
      createdAt: new Date().toISOString(),
      preview,
      status: 'sending',
    };
    setMessages(cur => (retryOf ? cur.map(m => (m.id === retryOf ? temp : m)) : [...cur, temp]));
    setThinking(true);
    scrollToBottom(true);
    try {
      const d = await post('/api/me', { action: 'tutor_ask', text: questionText, image }, 65000);
      setMessages(cur => [
        ...cur.filter(m => m.id !== tempId),
        { ...d.question, preview },
        d.answer,
      ]);
      setState(s =>
        s ? { ...s, used: Number(d.used) || s.used + 1, limit: Number(d.limit) || s.limit } : s
      );
      scrollToBottom(true);
    } catch (e: any) {
      const data = e?.data || {};
      if (e?.status === 403 && data.premiumRequired) {
        setMessages(cur => cur.filter(m => m.id !== tempId));
        setState(s => (s ? { ...s, limit: 0 } : s));
        onPremium();
        return;
      }
      if (e?.status === 429) {
        setMessages(cur => cur.filter(m => m.id !== tempId));
        setText(questionText);
        if (image && preview) setAttachment({ image, preview });
        setState(s => (s ? { ...s, used: s.limit } : s));
        notify(e.message, 'error');
        if (data.premiumRequired) onPremium();
        return;
      }
      // La question a peut-être été enregistrée : on la garde, avec un bouton « Réessayer ».
      setMessages(cur =>
        cur.map(m =>
          m.id === tempId
            ? {
                ...(data.question ? { ...data.question, preview } : m),
                id: data.question?.id || tempId,
                status: 'failed',
                retry: { text: questionText, image, preview },
              }
            : m
        )
      );
      notify(e.message || 'Le Prof IA n’a pas pu répondre.', 'error');
    } finally {
      setThinking(false);
    }
  };

  const send = (value = text) => {
    const questionText = value.trim();
    if ((!questionText && !attachment) || thinking || !state) return;
    if (state.used >= state.limit) {
      notify(`Tu as utilisé tes ${state.limit} questions du jour. Reviens demain !`, 'error');
      if (!state.premium) onPremium();
      return;
    }
    const current = attachment;
    setText('');
    setAttachment(null);
    if (inputRef.current) inputRef.current.style.height = '';
    ask(questionText, current?.image || null, current?.preview);
  };

  const clear = async () => {
    setConfirmClear(false);
    setMenuOpen(false);
    try {
      await post('/api/me', { action: 'tutor_clear' });
      setMessages([]);
      notify('Conversation effacée.');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const header = (subtitle: string, live = false, withMenu = false) => (
    <header className={chat.header}>
      <button type="button" className={chat.back} aria-label="Retour" onClick={onBack}>
        <Icon name="back" strokeWidth={2.4} />
      </button>
      <span className={chat.groupAvatar}>
        <Icon name="cap" size={22} />
      </span>
      <div className={chat.headText}>
        <b>Prof IA</b>
        <span className={live ? chat.live : ''}>{subtitle}</span>
      </div>
      {withMenu ? (
        <button
          type="button"
          className={chat.headBtn}
          aria-label="Options"
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="more" />
        </button>
      ) : null}
    </header>
  );

  /* ---------- États particuliers ---------- */

  if (error)
    return (
      <section className={chat.chat}>
        {header('Indisponible')}
        <div className={styles.locked}>
          <div className={styles.lockedCard}>
            <p>{error}</p>
            <button type="button" className="btn btn-primary" onClick={load}>
              <Icon name="refresh" size={18} /> Réessayer
            </button>
          </div>
        </div>
      </section>
    );

  if (!state)
    return (
      <section className={chat.chat}>
        {header('Chargement…')}
        <div style={{ display: 'grid', gap: 10, padding: 14 }}>
          <div className="skeleton" style={{ height: 54, width: '70%' }} />
          <div className="skeleton" style={{ height: 40, width: '50%', justifySelf: 'end' }} />
        </div>
      </section>
    );

  if (!state.configured)
    return (
      <section className={chat.chat}>
        {header('Bientôt disponible')}
        <div className={styles.locked}>
          <div className={styles.lockedCard}>
            <span className={styles.bigIcon}>
              <Icon name="cap" size={28} />
            </span>
            <h2>Le Prof IA arrive bientôt</h2>
            <p>Exam237 prépare ton professeur particulier. Reviens un peu plus tard !</p>
          </div>
        </div>
      </section>
    );

  if (state.limit <= 0)
    return (
      <section className={chat.chat}>
        {header('Réservé aux membres Premium')}
        <div className={styles.locked}>
          <div className={styles.lockedCard}>
            <span className={styles.bigIcon}>
              <Icon name="lock" size={26} />
            </span>
            <h2>Le Prof IA, avec Premium</h2>
            <p>
              Pose tes questions ou envoie la <b>photo d’un exercice</b>. Il te donne d’abord des
              indices pour que tu trouves toi-même, puis la solution si tu la demandes.
            </p>
            <div className={styles.sample} aria-hidden="true">
              <span className={styles.sampleMine}>
                Je bloque sur l’exercice 2 : résoudre 2x + 6 = 0
              </span>
              <span className={styles.sampleAi}>
                Indice : que dois-tu faire pour que le 6 passe de l’autre côté du signe égal ?
              </span>
            </div>
            <button type="button" className="btn btn-gold btn-lg btn-block" onClick={onPremium}>
              <Icon name="star" size={18} /> Passer Premium
            </button>
            <p className="fine">Paiement par MTN MoMo ou Orange Money, activation rapide.</p>
          </div>
        </div>
      </section>
    );

  /* ---------- Conversation ---------- */

  const left = Math.max(0, state.limit - state.used);
  const last = messages[messages.length - 1];
  const showFollowUps = !thinking && last?.role === 'assistant' && !text && !attachment;

  return (
    <section className={chat.chat}>
      {header(
        thinking
          ? 'réfléchit…'
          : `${left} question${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} aujourd’hui`,
        thinking,
        true
      )}

      <div ref={listRef} className={chat.list}>
        <div className={chat.spacer} />
        <div className={styles.notice}>
          Conversation privée. Le Prof IA est une intelligence artificielle : il peut se tromper,
          vérifie avec tes cours.
        </div>

        {!messages.length ? (
          <div className={styles.welcome}>
            <span className={styles.bigIcon}>
              <Icon name="cap" size={28} />
            </span>
            <b>Bonjour {viewer.displayName.split(' ')[0] || ''} !</b>
            <p>
              Écris ta question, ou envoie la photo d’un exercice avec{' '}
              <Icon name="camera" size={15} className="inline-icon" />.
            </p>
            <div className={styles.starters}>
              {STARTERS.map(s => (
                <button
                  key={s.label}
                  type="button"
                  className={styles.starter}
                  onClick={() => {
                    setText(s.text);
                    window.setTimeout(() => {
                      const el = inputRef.current;
                      if (el) {
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                      }
                    }, 0);
                  }}
                >
                  <Icon name={s.icon} size={18} /> {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => {
          const mine = m.role === 'user';
          const first = !messages[i - 1] || messages[i - 1].role !== m.role;
          return (
            <div
              key={m.id}
              className={`${chat.row} ${first ? chat.first : ''} ${mine ? chat.mine : ''}`}
            >
              {!mine ? (
                first ? (
                  <span
                    className={chat.avatar}
                    style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}
                    aria-hidden="true"
                  >
                    <Icon name="cap" size={17} />
                  </span>
                ) : (
                  <span className={chat.avatarGap} />
                )
              ) : null}
              <div className={chat.col}>
                <button
                  type="button"
                  className={`${chat.bubble} ${!mine ? chat.ai : ''}`}
                  onClick={() => (m.status === 'failed' && m.retry ? undefined : setSelected(m))}
                  aria-label={mine ? 'Ta question' : 'Réponse du Prof IA'}
                >
                  {first ? (
                    <svg className={chat.tail} viewBox="0 0 8 13" aria-hidden="true">
                      <path
                        d={
                          mine
                            ? 'M0 0h6.5c1.1 0 1.7 1.3 1 2.2L0 12z'
                            : 'M8 0H1.5C.4 0-.2 1.3.5 2.2L8 12z'
                        }
                        fill="currentColor"
                      />
                    </svg>
                  ) : null}
                  {first && !mine ? (
                    <span className={chat.sender} style={{ color: 'var(--gold-text)' }}>
                      Prof IA
                    </span>
                  ) : null}
                  {m.preview ? (
                    <img className={styles.photo} src={m.preview} alt="Photo de l’exercice" />
                  ) : m.hasImage ? (
                    <span className={styles.photoTag}>
                      <Icon name="camera" size={13} /> Photo de l’exercice
                    </span>
                  ) : null}
                  <span className={chat.text}>{m.text}</span>
                  <span className={chat.meta}>
                    {m.status === 'failed' ? (
                      <span className={chat.failed}>Pas de réponse</span>
                    ) : (
                      time(m.createdAt)
                    )}
                    {mine && m.status === 'sending' ? (
                      <Icon name="clock" size={12} label="Envoi en cours" />
                    ) : null}
                    {mine && !m.status ? <Icon name="checks" size={15} label="Envoyé" /> : null}
                  </span>
                </button>
                {m.status === 'failed' && m.retry ? (
                  <button
                    type="button"
                    className={styles.retry}
                    disabled={thinking}
                    onClick={() => ask(m.retry!.text, m.retry!.image, m.retry!.preview, m.id)}
                  >
                    Réessayer
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {thinking ? (
          <div className={chat.typing} aria-live="polite">
            <span
              className={chat.avatar}
              style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}
              aria-hidden="true"
            >
              <Icon name="cap" size={17} />
            </span>
            <span className={chat.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className={chat.typingName}>Le Prof IA réfléchit…</span>
          </div>
        ) : null}
      </div>

      {showFollowUps ? (
        <div className={styles.followUps}>
          {FOLLOW_UPS.map(f => (
            <button key={f} type="button" className={styles.followUp} onClick={() => send(f)}>
              {f}
            </button>
          ))}
        </div>
      ) : null}

      {attachment ? (
        <div className={styles.attach}>
          <img src={attachment.preview} alt="" />
          <div>
            <b>Photo de l’exercice</b>
            <span>Ajoute une précision si tu veux, puis envoie.</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Retirer la photo"
            onClick={() => setAttachment(null)}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      ) : null}

      <div className={chat.composer}>
        <div className={chat.inputShell}>
          <button
            type="button"
            className={chat.inputBtn}
            aria-label="Envoyer la photo d’un exercice"
            disabled={preparing || thinking}
            onClick={() => fileRef.current?.click()}
          >
            {preparing ? (
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            ) : (
              <Icon name="camera" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => pickPhoto(e.target.files?.[0])}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={1500}
            className={chat.input}
            aria-label="Écrire ta question"
            placeholder={attachment ? 'Ajoute une précision…' : 'Pose ta question…'}
            onChange={e => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onFocus={() => window.setTimeout(() => scrollToBottom(), 250)}
            onKeyDown={e => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !window.matchMedia?.('(pointer: coarse)').matches
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        <button
          type="button"
          className={chat.send}
          onClick={() => send()}
          disabled={thinking || (!text.trim() && !attachment)}
          aria-label="Envoyer"
        >
          <Icon name="send" strokeWidth={2.2} />
        </button>
      </div>

      {menuOpen ? (
        <div className={chat.menuBackdrop} onClick={() => setMenuOpen(false)}>
          <div
            className={chat.menu}
            role="dialog"
            aria-label="Options du Prof IA"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className={chat.menuPreview}>
              {state.premium
                ? `Premium : ${state.limit} questions par jour.`
                : `Version gratuite : ${state.limit} question${state.limit > 1 ? 's' : ''} par jour.`}{' '}
              Tu en as utilisé {Math.min(state.used, state.limit)} aujourd’hui.
            </div>
            <div className={chat.menuList}>
              {!state.premium ? (
                <button
                  type="button"
                  className={chat.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onPremium();
                  }}
                >
                  <Icon name="star" /> Plus de questions avec Premium
                </button>
              ) : null}
              <button
                type="button"
                className={`${chat.menuItem} ${chat.danger}`}
                disabled={!messages.length}
                onClick={() => setConfirmClear(true)}
              >
                <Icon name="trash" /> Effacer la conversation
              </button>
              <button type="button" className={chat.menuItem} onClick={() => setMenuOpen(false)}>
                <Icon name="x" /> Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmClear ? (
        <div className={chat.menuBackdrop} onClick={() => setConfirmClear(false)}>
          <div
            className={chat.menu}
            role="alertdialog"
            aria-label="Effacer la conversation"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <b>Effacer toute la conversation avec le Prof IA ?</b>
            <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Cette action est définitive.
            </span>
            <div className={chat.menuList}>
              <button type="button" className={`${chat.menuItem} ${chat.danger}`} onClick={clear}>
                <Icon name="trash" /> Oui, tout effacer
              </button>
              <button
                type="button"
                className={chat.menuItem}
                onClick={() => setConfirmClear(false)}
              >
                <Icon name="x" /> Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className={chat.menuBackdrop} onClick={() => setSelected(null)}>
          <div
            className={chat.menu}
            role="dialog"
            aria-label="Options du message"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className={chat.menuPreview}>{selected.text}</div>
            <div className={chat.menuList}>
              <button
                type="button"
                className={chat.menuItem}
                onClick={async () => {
                  const ok = await copyText(selected.text);
                  setSelected(null);
                  notify(ok ? 'Message copié.' : 'Copie impossible.');
                }}
              >
                <Icon name="copy" /> Copier
              </button>
              {selected.role === 'assistant' ? (
                <button
                  type="button"
                  className={chat.menuItem}
                  onClick={() => {
                    setSelected(null);
                    send('Je n’ai pas compris, peux-tu réexpliquer plus simplement ?');
                  }}
                >
                  <Icon name="refresh" /> Réexpliquer plus simplement
                </button>
              ) : null}
              <button type="button" className={chat.menuItem} onClick={() => setSelected(null)}>
                <Icon name="x" /> Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
