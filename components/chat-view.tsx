'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { api, copyText, post, type Notify, type Viewer } from './lib';
import styles from './chat-view.module.css';

/*
  Chat de la classe, en temps réel.
  - Le message envoyé s'affiche tout de suite (🕓 puis ✓).
  - Les messages des autres arrivent complets par Ably, scellés avec la clé du salon :
    pas besoin de recharger la discussion.
  - Sans Ably, ou après une coupure réseau, seule la suite manquante est récupérée.
*/

type Reaction = { emoji: string; count: number };
type Msg = {
  id: string;
  roomId: string;
  senderUserId: string | null;
  senderName: string;
  isAssistant: boolean;
  text: string;
  replyToId: string | null;
  replySender: string | null;
  replyText: string | null;
  isPinned: boolean;
  createdAt: string;
  reactions: Reaction[];
  myReaction: string | null;
  nonce?: string | null;
  status?: 'sending' | 'failed';
};

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = [
  '😀',
  '😂',
  '🥰',
  '😍',
  '👍',
  '🙏',
  '🔥',
  '🎉',
  '❤️',
  '👏',
  '😅',
  '😢',
  '🤔',
  '💪',
  '✅',
  '📚',
];
const PALETTE: Array<[string, string]> = [
  ['#dbe6fd', '#1d4ed8'],
  ['#ede4fd', '#6d28d9'],
  ['#fbe1ea', '#b4235a'],
  ['#fde8d7', '#9a3412'],
  ['#d9f2ee', '#0f766e'],
  ['#e8ecf2', '#334155'],
];
const REPORT_REASONS: Array<{ label: string; assistantOnly?: boolean }> = [
  { label: 'Réponse fausse de l’assistant', assistantOnly: true },
  { label: 'Insulte ou harcèlement' },
  { label: 'Contenu inapproprié' },
  { label: 'Spam ou publicité' },
  { label: 'Autre raison' },
];

function colorFor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean)
      .map(w => w.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'E'
  );
}
const byTime = (a: Msg, b: Msg) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id);
function sameDay(a: string, b: string) {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}
function dayLabel(value: string) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(value, today.toISOString())) return 'Aujourd’hui';
  if (sameDay(value, yesterday.toISOString())) return 'Hier';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}
const time = (value: string) =>
  new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* ---------- Déchiffrement des messages reçus en temps réel (WebCrypto) ---------- */

function fromB64url(value: string) {
  let s = value.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function importRoomKey(b64: string) {
  if (!window.crypto?.subtle) return null;
  return window.crypto.subtle.importKey('raw', fromB64url(b64), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
}
async function openSealed(key: CryptoKey, sealed: { iv: string; ct: string }) {
  const plain = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64url(sealed.iv) },
    key,
    fromB64url(sealed.ct)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function loadAbly(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Ably) return resolve(w.Ably);
    const existing = document.querySelector(
      'script[data-exam237-ably]'
    ) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve((window as any).Ably), { once: true });
    script.addEventListener('error', () => reject(new Error('Ably indisponible')), { once: true });
    if (!existing) {
      script.src = 'https://cdn.ably.com/lib/ably.min-2.js';
      script.async = true;
      script.dataset.exam237Ably = 'true';
      document.head.appendChild(script);
    }
  });
}

// Petit son de notification, sans fichier à télécharger.
let audio: AudioContext | null = null;
function ping() {
  try {
    audio = audio || new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audio.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.25);
  } catch {}
}

export default function ChatView({
  viewer,
  rooms: initialRooms,
  active,
  assistantEnabled,
  notify,
  onUnread,
  onBack,
  onPremium,
}: {
  viewer: Viewer;
  rooms: any[];
  active: boolean;
  assistantEnabled: boolean;
  notify: Notify;
  onUnread: (n: number) => void;
  onBack: () => void;
  onPremium: () => void;
}) {
  const isAdmin = viewer.role === 'admin';
  const [rooms] = useState<any[]>(initialRooms || []);
  const [roomId, setRoomId] = useState<string>(initialRooms?.[0]?.id || '');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Msg | null>(null);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [online, setOnline] = useState(0);
  // live : Ably connecté ; polling : mise à jour toutes les 4 s (Ably absent ou coupé).
  const [mode, setMode] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const liveRef = useRef(false);
  const [menu, setMenu] = useState<Msg | null>(null);
  const [reportTarget, setReportTarget] = useState<Msg | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [assistantWaiting, setAssistantWaiting] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const channelRef = useRef<any>(null);
  const atBottom = useRef(true);
  const activeRef = useRef(active);
  const unreadRef = useRef(0);
  const lastTyping = useRef(0);
  const holdTimer = useRef<number | null>(null);
  const holdFired = useRef(false);
  const swipe = useRef<{ id: string; x: number; y: number; dx: number; el: HTMLElement } | null>(
    null
  );
  const loadingOlderRef = useRef(false);

  const room = useMemo(() => rooms.find(r => r.id === roomId) || rooms[0], [rooms, roomId]);
  const mineOf = useCallback(
    (m: Msg) =>
      isAdmin
        ? !m.senderUserId && m.senderName === 'Exam237' && !m.isAssistant
        : !!m.senderUserId && m.senderUserId === viewer.userId,
    [isAdmin, viewer.userId]
  );

  /* ---------- Défilement ---------- */

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      atBottom.current = true;
      setShowJump(false);
      setNewCount(0);
    });
  }, []);

  /* ---------- Compteur de non-lus ---------- */

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      unreadRef.current = 0;
      onUnread(0);
      scrollToBottom();
    }
  }, [active, onUnread, scrollToBottom]);

  /* ---------- Fusion des messages ---------- */

  const upsert = useCallback(
    (incoming: Msg[], fromOthers = false) => {
      if (!incoming.length) return;
      let added = 0;
      setMessages(current => {
        let list = current;
        for (const msg of incoming) {
          if (msg.nonce)
            list = list.filter(m => !(m.id.startsWith('tmp-') && m.nonce === msg.nonce));
          const index = list.findIndex(m => m.id === msg.id);
          if (index >= 0) {
            const copy = list.slice();
            copy[index] = { ...copy[index], ...msg, status: undefined };
            list = copy;
          } else {
            list = [...list, { ...msg, status: undefined }];
            if (fromOthers && !mineOf(msg)) added += 1;
          }
        }
        return list.slice().sort(byTime);
      });
      if (added && fromOthers) {
        if (!activeRef.current || document.hidden) {
          unreadRef.current += added;
          onUnread(unreadRef.current);
          ping();
          try {
            navigator.vibrate?.(30);
          } catch {}
        }
        if (atBottom.current && activeRef.current) scrollToBottom(true);
        else if (activeRef.current) {
          setNewCount(n => n + added);
          setShowJump(true);
        }
      }
      if (incoming.some(m => m.isAssistant)) setAssistantWaiting(null);
    },
    [mineOf, onUnread, scrollToBottom]
  );

  const lastServerTime = useCallback(() => {
    const real = messages.filter(m => !m.id.startsWith('tmp-'));
    return real.length ? real[real.length - 1].createdAt : null;
  }, [messages]);
  const lastTimeRef = useRef<string | null>(null);
  lastTimeRef.current = lastServerTime();

  const fetchNew = useCallback(async () => {
    if (!room?.id) return;
    const after = lastTimeRef.current;
    try {
      const d = await api(
        `/api/chat?action=messages&roomId=${encodeURIComponent(room.id)}${after ? `&after=${encodeURIComponent(after)}` : ''}`
      );
      upsert(d.messages || [], true);
    } catch {}
  }, [room?.id, upsert]);

  /* ---------- Chargement initial ---------- */

  useEffect(() => {
    if (!room?.id) return;
    let cancelled = false;
    setMessages([]);
    setLoaded(false);
    setSelected([]);
    setHasMore(true);
    (async () => {
      try {
        const d = await api(`/api/chat?action=messages&roomId=${encodeURIComponent(room.id)}`);
        if (cancelled) return;
        setMessages((d.messages || []).sort(byTime));
        setHasMore((d.messages || []).length >= 50);
        keyRef.current = d.transportKey
          ? await importRoomKey(d.transportKey).catch(() => null)
          : null;
        liveRef.current = !!d.realtimeConfigured;
        setLoaded(true);
        scrollToBottom();
      } catch (e: any) {
        if (!cancelled) {
          setLoaded(true);
          notify(e.message, 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room?.id, notify, scrollToBottom]);

  /* ---------- Temps réel (Ably) + secours ---------- */

  useEffect(() => {
    if (!room?.id || !loaded) return;
    let closed = false;
    let client: any;
    let channel: any;
    let poll: number | undefined;
    let wasDisconnected = false;

    const startPolling = () => {
      if (poll) return;
      poll = window.setInterval(() => {
        if (!document.hidden) fetchNew();
      }, 4000);
    };
    const stopPolling = () => {
      if (poll) window.clearInterval(poll);
      poll = undefined;
    };

    (async () => {
      if (!liveRef.current) {
        setMode('polling');
        startPolling();
        return;
      }
      try {
        const Ably = await loadAbly();
        if (closed) return;
        client = new Ably.Realtime({
          authUrl: '/api/chat?action=token',
          clientId: viewer.userId || 'admin',
        });
        client.connection.on((change: any) => {
          if (change.current === 'connected') {
            setMode('live');
            stopPolling();
            if (wasDisconnected) fetchNew();
            wasDisconnected = false;
          } else if (['disconnected', 'suspended', 'failed'].includes(change.current)) {
            // Réseau coupé ou Ably indisponible : on continue en mise à jour régulière.
            setMode('polling');
            wasDisconnected = true;
            startPolling();
          }
        });
        channel = client.channels.get(`exam237:chat:${room.id}`);
        channelRef.current = channel;
        await channel.attach();

        channel.subscribe('message', async (event: any) => {
          const data = event?.data || {};
          const deleted: string[] = Array.isArray(data.deletedIds)
            ? data.deletedIds.map(String)
            : data.deletedId
              ? [String(data.deletedId)]
              : [];
          if (deleted.length) {
            const gone = new Set(deleted);
            setMessages(cur => cur.filter(m => !gone.has(m.id)));
            setSelected(cur => cur.filter(id => !gone.has(id)));
            return;
          }
          if (data.sealed && keyRef.current) {
            try {
              const msg = await openSealed(keyRef.current, data.sealed);
              upsert([{ ...msg, myReaction: null, reactions: msg.reactions || [] }], true);
              return;
            } catch {}
          }
          fetchNew();
        });
        channel.subscribe('reaction', (event: any) => {
          const d = event?.data || {};
          setMessages(cur =>
            cur.map(m =>
              m.id === d.messageId
                ? {
                    ...m,
                    reactions: d.reactions || [],
                    myReaction:
                      d.userId === (isAdmin ? 'admin' : viewer.userId)
                        ? d.emoji || null
                        : m.myReaction,
                  }
                : m
            )
          );
        });
        channel.subscribe('pin', (event: any) => {
          const d = event?.data || {};
          setMessages(cur =>
            cur.map(m => (m.id === d.messageId ? { ...m, isPinned: !!d.pinned } : m))
          );
        });
        channel.subscribe('typing', (event: any) => {
          const d = event?.data || {};
          const who = String(d.userId || '');
          if (!who || who === (viewer.userId || 'admin')) return;
          setTyping(cur => {
            const next = { ...cur };
            if (d.active) next[who] = { name: d.name || 'Quelqu’un', at: Date.now() };
            else delete next[who];
            return next;
          });
        });
        try {
          await channel.presence.enter({ name: viewer.displayName || 'Exam237' });
          const refresh = async () => {
            try {
              setOnline((await channel.presence.get()).length);
            } catch {}
          };
          await refresh();
          channel.presence.subscribe(refresh);
        } catch {}
      } catch {
        setMode('polling');
        startPolling();
      }
    })();

    const onVisible = () => {
      if (!document.hidden) fetchNew();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      closed = true;
      if (poll) window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      channelRef.current = null;
      try {
        channel?.presence.leave();
      } catch {}
      try {
        client?.close();
      } catch {}
    };
  }, [room?.id, loaded, viewer.userId, viewer.displayName, isAdmin, fetchNew, upsert]);

  // « … écrit » disparaît tout seul après quelques secondes sans nouvelle.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = window.setInterval(() => {
      setTyping(cur => {
        const next: typeof cur = {};
        for (const [k, v] of Object.entries(cur)) if (Date.now() - v.at < 3500) next[k] = v;
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typing]);

  useEffect(() => {
    if (!assistantWaiting) return;
    const timer = window.setTimeout(() => setAssistantWaiting(null), 75000);
    return () => window.clearTimeout(timer);
  }, [assistantWaiting]);

  /* ---------- Envoi ---------- */

  const publishTyping = (activeTyping: boolean) => {
    const now = Date.now();
    if (activeTyping && now - lastTyping.current < 1500) return;
    lastTyping.current = activeTyping ? now : 0;
    try {
      channelRef.current?.publish('typing', {
        userId: viewer.userId || 'admin',
        name: viewer.displayName || 'Exam237',
        active: activeTyping,
      });
    } catch {}
  };

  const deliver = async (temp: Msg) => {
    try {
      const d = await post('/api/chat', {
        action: 'send',
        roomId: temp.roomId,
        text: temp.text,
        replyToId: temp.replyToId,
        nonce: temp.nonce,
      });
      upsert([d.message]);
      if (d.assistant) setAssistantWaiting(Date.now());
      if (d.assistantBlocked === 'premium') {
        notify('L’assistant IA est réservé aux membres Premium.');
        onPremium();
      }
    } catch (e: any) {
      setMessages(cur => cur.map(m => (m.id === temp.id ? { ...m, status: 'failed' } : m)));
      notify(e.message || 'Message non envoyé. Touche-le pour réessayer.', 'error');
    }
  };

  const send = () => {
    const value = text.trim();
    if (!value || !room?.id) return;
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const temp: Msg = {
      id: `tmp-${nonce}`,
      nonce,
      roomId: room.id,
      senderUserId: viewer.userId,
      senderName: isAdmin ? 'Exam237' : viewer.displayName || 'Moi',
      isAssistant: false,
      text: value,
      replyToId: reply && !reply.id.startsWith('tmp-') ? reply.id : null,
      replySender: reply?.senderName || null,
      replyText: reply?.text || null,
      isPinned: false,
      createdAt: new Date().toISOString(),
      reactions: [],
      myReaction: null,
      status: 'sending',
    };
    setMessages(cur => [...cur, temp]);
    setText('');
    setReply(null);
    setShowEmoji(false);
    publishTyping(false);
    scrollToBottom(true);
    if (inputRef.current) inputRef.current.style.height = '';
    deliver(temp);
  };

  /* ---------- Actions sur un message ---------- */

  const react = async (m: Msg, emoji: string) => {
    setMenu(null);
    if (m.id.startsWith('tmp-')) return;
    const previous = { reactions: m.reactions, myReaction: m.myReaction };
    // Mise à jour immédiate, corrigée par la réponse du serveur.
    setMessages(cur =>
      cur.map(x => {
        if (x.id !== m.id) return x;
        const counts = new Map(x.reactions.map(r => [r.emoji, r.count]));
        if (x.myReaction)
          counts.set(x.myReaction, Math.max(0, (counts.get(x.myReaction) || 1) - 1));
        const mine = x.myReaction === emoji ? null : emoji;
        if (mine) counts.set(mine, (counts.get(mine) || 0) + 1);
        return {
          ...x,
          myReaction: mine,
          reactions: [...counts.entries()]
            .filter(([, n]) => n > 0)
            .map(([e, n]) => ({ emoji: e, count: n })),
        };
      })
    );
    try {
      const d = await post('/api/chat', { action: 'react', messageId: m.id, emoji });
      setMessages(cur =>
        cur.map(x =>
          x.id === m.id ? { ...x, reactions: d.reactions, myReaction: d.myReaction } : x
        )
      );
    } catch (e: any) {
      setMessages(cur => cur.map(x => (x.id === m.id ? { ...x, ...previous } : x)));
      notify(e.message, 'error');
    }
  };

  const remove = async (ids: string[]) => {
    const real = ids.filter(id => !id.startsWith('tmp-'));
    setMenu(null);
    setSelected([]);
    setMessages(cur => cur.filter(m => !ids.includes(m.id)));
    if (!real.length) return;
    try {
      await post('/api/chat', { action: 'delete_many', messageIds: real });
      notify(real.length === 1 ? 'Message supprimé.' : `${real.length} messages supprimés.`);
    } catch (e: any) {
      notify(e.message, 'error');
      fetchNew();
    }
  };

  const pin = async (m: Msg) => {
    setMenu(null);
    try {
      await post('/api/chat', { action: 'pin', messageId: m.id, pinned: !m.isPinned });
      setMessages(cur => cur.map(x => (x.id === m.id ? { ...x, isPinned: !m.isPinned } : x)));
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const report = async (m: Msg, reason: string) => {
    setReportTarget(null);
    try {
      const d = await post('/api/chat', { action: 'report', messageId: m.id, reason });
      notify(
        d?.already ? 'Tu as déjà signalé ce message.' : 'Merci, le message a été signalé à Exam237.'
      );
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const askAssistant = async (m: Msg) => {
    setMenu(null);
    try {
      await post('/api/chat', { action: 'assistant_reply', messageId: m.id });
      setAssistantWaiting(Date.now());
      notify('L’assistant prépare sa réponse…');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const copySelection = async (list: Msg[]) => {
    const ok = await copyText(list.map(m => m.text).join('\n'));
    setSelected([]);
    setMenu(null);
    notify(
      ok
        ? list.length > 1
          ? `${list.length} messages copiés.`
          : 'Message copié.'
        : 'Copie impossible.'
    );
  };

  /* ---------- Gestes : appui long, glisser pour répondre ---------- */

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, m: Msg) => {
    holdFired.current = false;
    swipe.current = { id: m.id, x: e.clientX, y: e.clientY, dx: 0, el: e.currentTarget };
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true;
      if (!m.id.startsWith('tmp-')) setSelected(cur => (cur.includes(m.id) ? cur : [...cur, m.id]));
      try {
        navigator.vibrate?.(18);
      } catch {}
    }, 450);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (dx > 10 && Math.abs(dx) > Math.abs(dy) * 1.5 && !selected.length) {
      s.dx = Math.min(dx, 80);
      s.el.style.transform = `translateX(${s.dx}px)`;
    }
  };
  const onPointerEnd = (m: Msg) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    const s = swipe.current;
    swipe.current = null;
    if (s) {
      s.el.style.transform = '';
      if (s.dx > 56) {
        holdFired.current = true;
        setReply(m);
        inputRef.current?.focus();
        try {
          navigator.vibrate?.(12);
        } catch {}
      }
    }
  };
  const onTap = (m: Msg) => {
    if (holdFired.current) {
      holdFired.current = false;
      return;
    }
    if (m.status === 'failed') {
      setMessages(cur => cur.map(x => (x.id === m.id ? { ...x, status: 'sending' } : x)));
      deliver({ ...m, status: 'sending' });
      return;
    }
    if (selected.length) {
      setSelected(cur => (cur.includes(m.id) ? cur.filter(id => id !== m.id) : [...cur, m.id]));
      return;
    }
    setMenu(m);
  };

  /* ---------- Historique ---------- */

  const loadOlder = async () => {
    if (!room?.id || !hasMore || loadingOlderRef.current) return;
    const oldest = messages.find(m => !m.id.startsWith('tmp-'));
    const el = listRef.current;
    if (!oldest || !el) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
      const d = await api(
        `/api/chat?action=messages&roomId=${encodeURIComponent(room.id)}&before=${encodeURIComponent(oldest.createdAt)}`
      );
      const older: Msg[] = d.messages || [];
      if (older.length < 50) setHasMore(false);
      if (older.length) {
        setMessages(cur => {
          const ids = new Set(cur.map(m => m.id));
          return [...older.filter(m => !ids.has(m.id)), ...cur].sort(byTime);
        });
        requestAnimationFrame(() => {
          const now = listRef.current;
          if (now) now.scrollTop = prevTop + (now.scrollHeight - prevHeight);
        });
      }
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 90;
    if (atBottom.current) {
      setShowJump(false);
      setNewCount(0);
    } else if (distance > 240) setShowJump(true);
    if (el.scrollTop < 120) loadOlder();
  };

  /* ---------- Affichage ---------- */

  const pinned = [...messages].reverse().find(m => m.isPinned) || null;
  const typingNames = Object.values(typing).map(t => t.name);
  const status = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length > 1 ? 'écrivent' : 'écrit'}…`
    : assistantWaiting
      ? 'L’assistant prépare sa réponse…'
      : mode === 'live'
        ? online > 1
          ? `${online} en ligne`
          : 'En ligne'
        : mode === 'polling'
          ? isAdmin
            ? 'Mise à jour automatique'
            : 'Discussion de ta classe'
          : 'Connexion…';
  const selectedMsgs = messages.filter(m => selected.includes(m.id));
  const canDelete = (m: Msg) => isAdmin || mineOf(m);

  if (!rooms.length) return <div className="empty">Aucune discussion disponible.</div>;

  return (
    <section className={styles.chat} onContextMenu={e => e.preventDefault()}>
      {selected.length ? (
        <header className={styles.header}>
          <button
            type="button"
            className={styles.back}
            style={{ display: 'flex' }}
            aria-label="Annuler la sélection"
            onClick={() => setSelected([])}
          >
            <Icon name="x" />
          </button>
          <span className={styles.selCount}>{selected.length}</span>
          {selected.length === 1 ? (
            <button
              type="button"
              className={styles.headBtn}
              aria-label="Répondre"
              onClick={() => {
                setReply(selectedMsgs[0] || null);
                setSelected([]);
                inputRef.current?.focus();
              }}
            >
              <Icon name="reply" />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.headBtn}
            aria-label="Copier"
            onClick={() => copySelection(selectedMsgs)}
          >
            <Icon name="copy" />
          </button>
          {selectedMsgs.length && selectedMsgs.every(canDelete) ? (
            <button
              type="button"
              className={styles.headBtn}
              aria-label="Supprimer"
              onClick={() => remove(selected)}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </header>
      ) : (
        <header className={styles.header}>
          <button type="button" className={styles.back} aria-label="Retour" onClick={onBack}>
            <Icon name="back" strokeWidth={2.4} />
          </button>
          <span className={styles.groupAvatar}>
            {initials(room?.group_label || room?.title || 'E')}
          </span>
          <div className={styles.headText}>
            <b>{room?.title || room?.group_label || 'Chat'}</b>
            <span className={typingNames.length || assistantWaiting ? styles.live : ''}>
              {status}
            </span>
          </div>
        </header>
      )}

      {isAdmin && rooms.length > 1 ? (
        <div className={styles.rooms}>
          {rooms.map(r => (
            <button
              key={r.id}
              type="button"
              className={styles.room}
              aria-pressed={r.id === room?.id}
              onClick={() => setRoomId(r.id)}
            >
              {r.group_label || r.title}
            </button>
          ))}
        </div>
      ) : null}

      {pinned ? (
        <button
          type="button"
          className={styles.pinned}
          onClick={() =>
            document
              .getElementById(`m-${pinned.id}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        >
          <span className={styles.pinIcon}>
            <Icon name="pin" size={16} />
          </span>
          <span className={styles.pinText}>
            <b>Message épinglé · {pinned.senderName}</b>
            <span>{pinned.text}</span>
          </span>
        </button>
      ) : null}

      <div ref={listRef} className={styles.list} onScroll={onScroll}>
        <div className={styles.spacer} />
        {loadingOlder ? (
          <div className={styles.history}>
            <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Anciens
            messages…
          </div>
        ) : !hasMore && messages.length ? (
          <div className={styles.history}>Début de la discussion</div>
        ) : null}

        {loaded && !messages.length ? (
          <div className={styles.empty}>
            <b>Bienvenue dans le chat de ta classe</b>
            <span>Pose tes questions, entraide-toi avec tes camarades.</span>
            {assistantEnabled ? <span>Astuce : écris @assistant suivi de ta question.</span> : null}
          </div>
        ) : null}
        {!loaded ? (
          <div style={{ display: 'grid', gap: 10, padding: 10 }}>
            <div className="skeleton" style={{ height: 48, width: '60%' }} />
            <div className="skeleton" style={{ height: 64, width: '70%', justifySelf: 'end' }} />
            <div className="skeleton" style={{ height: 48, width: '50%' }} />
          </div>
        ) : null}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = mineOf(m);
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const grouped =
            !newDay &&
            prev &&
            prev.senderUserId === m.senderUserId &&
            prev.senderName === m.senderName &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60000;
          const first = !grouped;
          const [bg, fg] = m.isAssistant
            ? ['#f5c518', '#3d3200']
            : !m.senderUserId
              ? ['#064b3a', '#ffffff']
              : colorFor(m.senderUserId);
          const nameColor = m.isAssistant ? 'var(--gold-text)' : !m.senderUserId ? 'var(--g8)' : fg;
          return (
            <div key={m.id}>
              {newDay ? (
                <div
                  className={styles.dateChip}
                  style={{ width: 'fit-content', margin: '10px auto 8px' }}
                >
                  {dayLabel(m.createdAt)}
                </div>
              ) : null}
              <div
                id={`m-${m.id}`}
                className={`${styles.row} ${first ? styles.first : ''} ${mine ? styles.mine : ''} ${selected.includes(m.id) ? styles.selected : ''}`}
              >
                {!mine ? (
                  first ? (
                    <span
                      className={styles.avatar}
                      style={{ background: bg, color: fg }}
                      aria-hidden="true"
                    >
                      {m.isAssistant ? (
                        <Icon name="cap" size={17} />
                      ) : !m.senderUserId ? (
                        'E'
                      ) : (
                        initials(m.senderName)
                      )}
                    </span>
                  ) : (
                    <span className={styles.avatarGap} />
                  )
                ) : null}
                <div className={styles.col}>
                  <button
                    type="button"
                    className={`${styles.bubble} ${m.isAssistant ? styles.ai : ''}`}
                    onClick={() => onTap(m)}
                    onPointerDown={e => onPointerDown(e, m)}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => onPointerEnd(m)}
                    onPointerCancel={() => onPointerEnd(m)}
                    onPointerLeave={() => onPointerEnd(m)}
                    aria-label={`Message de ${mine ? 'moi' : m.senderName}`}
                  >
                    {first ? (
                      <svg className={styles.tail} viewBox="0 0 8 13" aria-hidden="true">
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
                      <span className={styles.sender} style={{ color: nameColor }}>
                        {m.senderName}
                        {!m.senderUserId && !m.isAssistant ? (
                          <span className={styles.badge}>Admin</span>
                        ) : null}
                      </span>
                    ) : null}
                    {m.replyText ? (
                      <span className={styles.quote}>
                        <b>{m.replySender || 'Message'}</b>
                        <span>{m.replyText}</span>
                      </span>
                    ) : null}
                    <span className={styles.text}>
                      <Linkified text={m.text} />
                    </span>
                    <span className={styles.meta}>
                      {m.isAssistant ? (
                        <span className={styles.aiNote}>IA · peut se tromper</span>
                      ) : null}
                      {m.isPinned ? <Icon name="pin" size={11} /> : null}
                      {m.status === 'failed' ? (
                        <span className={styles.failed}>Non envoyé · toucher pour réessayer</span>
                      ) : (
                        time(m.createdAt)
                      )}
                      {mine && m.status !== 'failed' ? (
                        m.status === 'sending' ? (
                          <Icon name="clock" size={12} label="Envoi en cours" />
                        ) : (
                          <Icon name="checks" size={15} label="Envoyé" />
                        )
                      ) : null}
                    </span>
                  </button>
                  {m.reactions.length ? (
                    <span className={styles.reactions}>
                      {m.reactions.map(r => (
                        <button
                          key={r.emoji}
                          type="button"
                          className={`${styles.reaction} ${m.myReaction === r.emoji ? styles.on : ''}`}
                          onClick={() => react(m, r.emoji)}
                          aria-label={`${r.emoji} ${r.count}`}
                        >
                          {r.emoji} {r.count > 1 ? r.count : ''}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {typingNames.length ? (
          <div className={styles.typing} aria-live="polite">
            <span className={styles.avatarGap} />
            <span className={styles.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className={styles.typingName}>{typingNames[0]}</span>
          </div>
        ) : null}
      </div>

      {showJump ? (
        <button
          type="button"
          className={styles.jump}
          aria-label="Aller aux derniers messages"
          onClick={() => scrollToBottom(true)}
        >
          {newCount ? (
            <span className={styles.jumpCount}>{newCount > 99 ? '99+' : newCount}</span>
          ) : null}
          <Icon name="down" size={22} />
        </button>
      ) : null}

      {reply ? (
        <div className={styles.replyBar}>
          <div>
            <b>Réponse à {mineOf(reply) ? 'toi' : reply.senderName}</b>
            <span>{reply.text}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Annuler la réponse"
            onClick={() => setReply(null)}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      ) : null}

      {showEmoji ? (
        <div className={styles.emojiPanel}>
          {EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => setText(v => `${v}${emoji}`)}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.composer}>
        <div className={styles.inputShell}>
          <button
            type="button"
            className={styles.inputBtn}
            aria-label="Émojis"
            onClick={() => setShowEmoji(v => !v)}
          >
            <Icon name="smile" />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            className={styles.input}
            aria-label="Écrire un message"
            placeholder={assistantEnabled ? 'Message ou @assistant…' : 'Message'}
            onChange={e => {
              setText(e.target.value);
              publishTyping(!!e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onFocus={() => {
              setShowEmoji(false);
              window.setTimeout(() => scrollToBottom(), 250);
            }}
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
          {assistantEnabled ? (
            <button
              type="button"
              className={`${styles.inputBtn} ${styles.ai}`}
              aria-label="Poser une question à l’assistant IA"
              onClick={() => {
                setText(v => (/@\s*(exam\s*237|assistant)\b/i.test(v) ? v : `@assistant ${v}`));
                inputRef.current?.focus();
              }}
            >
              <Icon name="cap" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.send}
          onClick={send}
          disabled={!text.trim()}
          aria-label="Envoyer"
        >
          <Icon name="send" strokeWidth={2.2} />
        </button>
      </div>

      {menu ? (
        <div className={styles.menuBackdrop} onClick={() => setMenu(null)}>
          <div
            className={styles.menu}
            role="dialog"
            aria-label="Options du message"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className={styles.menuPreview}>{menu.text}</div>
            {!menu.id.startsWith('tmp-') ? (
              <div className={styles.reactBar} role="group" aria-label="Réagir">
                {REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={menu.myReaction === emoji}
                    onClick={() => react(menu, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={styles.menuList}>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setReply(menu);
                  setMenu(null);
                  inputRef.current?.focus();
                }}
              >
                <Icon name="reply" /> Répondre
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => copySelection([menu])}
              >
                <Icon name="copy" /> Copier
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setSelected([menu.id]);
                  setMenu(null);
                }}
              >
                <Icon name="check" /> Sélectionner
              </button>
              {isAdmin ? (
                <button type="button" className={styles.menuItem} onClick={() => pin(menu)}>
                  <Icon name="pin" /> {menu.isPinned ? 'Désépingler' : 'Épingler'}
                </button>
              ) : null}
              {isAdmin && assistantEnabled && !menu.isAssistant ? (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => askAssistant(menu)}
                >
                  <Icon name="cap" /> Faire répondre l’assistant
                </button>
              ) : null}
              {!isAdmin && !mineOf(menu) ? (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setReportTarget(menu);
                    setMenu(null);
                  }}
                >
                  <Icon name="flag" /> Signaler
                </button>
              ) : null}
              {canDelete(menu) ? (
                <button
                  type="button"
                  className={`${styles.menuItem} ${styles.danger}`}
                  onClick={() => remove([menu.id])}
                >
                  <Icon name="trash" /> Supprimer
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {reportTarget ? (
        <div className={styles.menuBackdrop} onClick={() => setReportTarget(null)}>
          <div
            className={styles.menu}
            role="dialog"
            aria-label="Signaler le message"
            onClick={e => e.stopPropagation()}
          >
            <div className="sheet-handle" />
            <b>Pourquoi signales-tu ce message ?</b>
            <div className={styles.menuList}>
              {REPORT_REASONS.filter(r => !r.assistantOnly || reportTarget.isAssistant).map(r => (
                <button
                  key={r.label}
                  type="button"
                  className={styles.menuItem}
                  onClick={() => report(reportTarget, r.label)}
                >
                  <Icon name="flag" /> {r.label}
                </button>
              ))}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => setReportTarget(null)}
              >
                <Icon name="x" /> Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
