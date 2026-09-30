'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Viewer } from './exam-app';
import styles from './chat-view.module.css';

async function jfetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { ...opts, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur');
  return d;
}

function loadAblyBrowser(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Ably) return resolve(w.Ably);

    const existing = document.querySelector('script[data-exam237-ably]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).Ably), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.ably.com/lib/ably.min-2.js';
    script.async = true;
    script.dataset.exam237Ably = 'true';
    script.onload = () => resolve((window as any).Ably);
    script.onerror = () => reject(new Error('Impossible de charger Ably'));
    document.head.appendChild(script);
  });
}

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

function dateLabel(value: string) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(value, today.toISOString())) return "Aujourd’hui";
  if (sameDay(value, yesterday.toISOString())) return 'Hier';

  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear()
      ? { year: 'numeric' as const }
      : {})
  });
}

export default function ChatView({
  viewer,
  rooms: initialRooms,
  notify,
  onUnread
}: {
  viewer: Viewer;
  rooms: any[];
  notify: (m: string, t?: 'error') => void;
  onUnread: (n: number) => void;
}) {
  const [rooms, setRooms] = useState<any[]>(initialRooms || []);
  const [roomId, setRoomId] = useState(initialRooms?.[0]?.id || '');
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<any | null>(null);
  const [typing, setTyping] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [realtime, setRealtime] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; align: 'left' | 'right' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<any>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);

  const selected = useMemo(
    () => rooms.find(r => r.id === roomId) || rooms[0],
    [rooms, roomId]
  );

  const scrollBottom = useCallback((smooth = true) => {
    window.setTimeout(() => {
      endRef.current?.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
      setShowJump(false);
      setNewMessageCount(0);
      atBottomRef.current = true;
    }, 30);
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const d = await jfetch('/api/chat?action=rooms');
      setRooms(d.rooms || []);
      if (!roomId && d.rooms?.[0]) setRoomId(d.rooms[0].id);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }, [notify, roomId]);

  const loadMessages = useCallback(async (scroll = true) => {
    if (!selected?.id) return;

    try {
      const d = await jfetch(
        `/api/chat?action=messages&roomId=${encodeURIComponent(selected.id)}`
      );

      const latest = d.messages || [];

      setMessages(current => {
        if (scroll || current.length === 0) return latest;

        const merged = new Map<string, any>();
        current.forEach((message: any) => merged.set(message.id, message));
        latest.forEach((message: any) => merged.set(message.id, message));

        return Array.from(merged.values()).sort(
          (a: any, b: any) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

      setHasMore(latest.length >= 50);
      onUnread(0);

      if (scroll) {
        setNewMessageCount(0);
        scrollBottom(false);
      }
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }, [notify, onUnread, scrollBottom, selected?.id]);

  const loadOlder = useCallback(async () => {
    if (
      !selected?.id ||
      !messages.length ||
      !hasMore ||
      loadingOlderRef.current
    ) {
      return;
    }

    const el = messagesRef.current;
    if (!el) return;

    const oldest = messages[0];
    if (!oldest?.createdAt) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const previousScrollHeight = el.scrollHeight;
    const previousScrollTop = el.scrollTop;

    try {
      const d = await jfetch(
        `/api/chat?action=messages&roomId=${encodeURIComponent(
          selected.id
        )}&before=${encodeURIComponent(oldest.createdAt)}`
      );

      const older = d.messages || [];

      if (!older.length) {
        setHasMore(false);
        return;
      }

      setMessages(current => {
        const merged = new Map<string, any>();

        older.forEach((message: any) => merged.set(message.id, message));
        current.forEach((message: any) => merged.set(message.id, message));

        return Array.from(merged.values()).sort(
          (a: any, b: any) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

      if (older.length < 50) setHasMore(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const currentEl = messagesRef.current;
          if (!currentEl) return;

          const addedHeight = currentEl.scrollHeight - previousScrollHeight;
          currentEl.scrollTop = previousScrollTop + addedHeight;
        });
      });
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore, messages, notify, selected?.id]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => {
    if (!selected?.id) return;
    setMessages([]);
    setHasMore(true);
    setNewMessageCount(0);
    atBottomRef.current = true;
    loadMessages();
  }, [loadMessages, selected?.id]);

  useEffect(() => {
    if (!selected?.id) return;

    let closed = false;
    let client: any;
    let channel: any;
    let poll: ReturnType<typeof setInterval> | undefined;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const tokenCheck = await fetch('/api/chat?action=token', { cache: 'no-store' });
        if (!tokenCheck.ok) throw new Error('fallback');

        const Ably = await loadAblyBrowser();
        if (closed) return;

        client = new Ably.Realtime({
          authUrl: '/api/chat?action=token',
          clientId: viewer.userId || 'admin'
        });

        channel = client.channels.get(`exam237:chat:${selected.id}`);
        channelRef.current = channel;
        await channel.attach();

        channel.subscribe('message', async (event: any) => {
          if (event?.data?.deletedId) {
            setMessages(current =>
              current.filter(message => message.id !== event.data.deletedId)
            );
            return;
          }

          const wasAtBottom = atBottomRef.current;
          await loadMessages(false);

          if (wasAtBottom) {
            setNewMessageCount(0);
            scrollBottom();
          } else {
            setNewMessageCount(count => count + 1);
            setShowJump(true);
          }
        });

        channel.subscribe('typing', (m: any) => {
          if (m.data?.userId === viewer.userId) return;
          clearTimeout(typingTimer);

          if (m.data?.active) {
            setTyping(`${m.data?.name || 'Quelqu’un'} écrit…`);
            typingTimer = setTimeout(() => setTyping(''), 2400);
          } else {
            setTyping('');
          }
        });

        try {
          await channel.presence.enter({ name: viewer.displayName || 'Exam237' });

          const refreshPresence = async () => {
            try {
              const members = await channel.presence.get();
              setOnlineCount(members.length);
            } catch {}
          };

          await refreshPresence();
          channel.presence.subscribe(() => refreshPresence());
        } catch {}

        setRealtime(true);
      } catch {
        setRealtime(false);
        poll = setInterval(() => loadMessages(false), 3500);
      }
    })();

    return () => {
      closed = true;
      if (poll) clearInterval(poll);
      if (typingTimer) clearTimeout(typingTimer);
      channelRef.current = null;
      try { channel?.presence.leave(); } catch {}
      try { client?.close(); } catch {}
    };
  }, [loadMessages, selected?.id, viewer.displayName, viewer.userId]);

  const publishTyping = () => {
    try {
      channelRef.current?.publish('typing', {
        userId: viewer.userId || 'admin',
        name: viewer.displayName || 'Exam237',
        active: true
      });

      if (typingStopRef.current) clearTimeout(typingStopRef.current);

      typingStopRef.current = setTimeout(() => {
        try {
          channelRef.current?.publish('typing', {
            userId: viewer.userId || 'admin',
            active: false
          });
        } catch {}
      }, 1600);
    } catch {}
  };

  const send = async () => {
    const value = text.trim();
    if (!value || !selected?.id) return;

    setText('');
    setShowEmoji(false);

    try {
      await jfetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          roomId: selected.id,
          text: value,
          replyToId: reply?.id || null
        })
      });

      setReply(null);

      try {
        channelRef.current?.publish('typing', {
          userId: viewer.userId || 'admin',
          active: false
        });
      } catch {}

      await loadMessages(false);
      scrollBottom();
    } catch (e: any) {
      setText(value);
      notify(e.message, 'error');
    }
  };


  const remove = async (id: string) => {
    try {
      await jfetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          messageId: id
        })
      });

      setDeleteTarget(null);
      setSelectedMessage(null);
      await loadMessages(false);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };




  const pin = async (id: string, pinned: boolean) => {
    try {
      await jfetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pin',
          messageId: id,
          pinned: !pinned
        })
      });

      setSelectedMessage(null);
      setMenuPos(null);
      await loadMessages(false);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const copyMessage = async (message: any) => {
    const value = String(message?.text || '');

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }

    setSelectedMessage(null);
    setMenuPos(null);
    notify('Message copié.');
  };

  const openMessageMenu = (event: React.MouseEvent<HTMLElement>, message: any) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = viewer.role === 'admin' ? 260 : 210;
    const gap = 8;

    let left = message.mine
      ? Math.max(8, rect.right - menuWidth)
      : Math.min(window.innerWidth - menuWidth - 8, rect.left);

    let top = rect.top - 52 - gap;

    if (top < 8) {
      top = rect.bottom + gap;
    }

    setSelectedMessage(message);
    setMenuPos({
      top,
      left,
      align: message.mine ? 'right' : 'left'
    });
  };

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;

    const isAtBottom = distanceFromBottom < 90;
    atBottomRef.current = isAtBottom;

    if (isAtBottom) {
      setShowJump(false);
      setNewMessageCount(0);
    } else {
      setShowJump(distanceFromBottom > 220);
    }

    if (el.scrollTop < 140 && hasMore && !loadingOlderRef.current) {
      loadOlder();
    }
  };


  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const syncViewport = () => {
      const keyboardHeight = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );

      setKeyboardOpen(keyboardHeight > 120);

      document.documentElement.style.setProperty(
        '--exam237-visual-height',
        `${viewport.height}px`
      );

      document.documentElement.style.setProperty(
        '--exam237-visual-top',
        `${viewport.offsetTop}px`
      );
    };

    syncViewport();

    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);

    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
      document.documentElement.style.removeProperty('--exam237-visual-height');
      document.documentElement.style.removeProperty('--exam237-visual-top');
    };
  }, []);

  const statusText = typing
    ? typing
    : realtime && onlineCount > 1
      ? `${onlineCount} en ligne`
      : 'En ligne';

  if (!rooms.length) {
    return <div className="empty">Aucun groupe de discussion disponible.</div>;
  }

  return (
    <section
      className={`${styles.page} ${keyboardOpen ? styles.keyboardOpen : ''}`}
      onContextMenu={e => e.preventDefault()}
    >
      {viewer.role === 'admin' && rooms.length > 1 ? (
        <div className={styles.roomStrip}>
          {rooms.map(r => (
            <button
              key={r.id}
              className={`${styles.roomChip} ${
                r.id === selected?.id ? styles.roomChipActive : ''
              }`}
              onClick={() => setRoomId(r.id)}
            >
              {r.group_label || r.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.chat}>
        <header className={styles.header}>
          <div className={styles.contact}>
            <div className={styles.avatar}>
              {String(selected?.group_label || selected?.title || 'E')
                .slice(0, 2)
                .toUpperCase()}
            </div>

            <div className={styles.contactText}>
              <strong>{selected?.title || selected?.group_label || 'Chat'}</strong>
              <span className={typing ? styles.typing : ''}>{statusText}</span>
            </div>
          </div>
        </header>

        <div
          ref={messagesRef}
          className={styles.messages}
          onScroll={onMessagesScroll}
          onContextMenu={e => e.preventDefault()}
        >
          {loadingOlder ? (
            <div className={styles.historyStatus}>
              <span className={styles.historySpinner} />
              Chargement des anciens messages…
            </div>
          ) : !hasMore && messages.length > 0 ? (
            <div className={styles.historyStatus}>
              Début de la discussion
            </div>
          ) : null}
          {messages.length === 0 ? (
            <div className={styles.emptyConversation}>
              <span>💬</span>
              <strong>Discussion Exam237</strong>
              <small>Les nouveaux messages apparaîtront ici.</small>
            </div>
          ) : null}

          {messages.map((m, index) => {
            const previous = messages[index - 1];
            const showDate =
              !previous || !sameDay(previous.createdAt, m.createdAt);

            return (
              <div key={m.id}>
                {showDate ? (
                  <div className={styles.dateRow}>
                    <span>{dateLabel(m.createdAt)}</span>
                  </div>
                ) : null}

                <div className={`${styles.row} ${m.mine ? styles.mineRow : ''}`}>
                  <button
                    type="button"
                    className={`${styles.bubble} ${
                      m.mine ? styles.mineBubble : styles.otherBubble
                    } ${
                      m.senderUserId === null ? styles.adminBubble : ''
                    }`}
                    onClick={e => openMessageMenu(e, m)}
                    onContextMenu={e => e.preventDefault()}
                    aria-label="Options du message"
                  >
                    {!m.mine ? (
                      <div className={styles.sender}>{m.senderName}</div>
                    ) : null}

                    {m.isPinned ? (
                      <div className={styles.pinned}>📌 Épinglé</div>
                    ) : null}

                    {m.replyText ? (
                      <div className={styles.replyPreview}>
                        <b>{m.replySender || 'Message'}</b>
                        <span>{String(m.replyText).slice(0, 120)}</span>
                      </div>
                    ) : null}

                    <div className={styles.messageText}>{m.text}</div>

                    <div className={styles.meta}>
                      <span>
                        {new Date(m.createdAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>

                      {m.mine ? (
                        <span className={styles.checks} title="Envoyé">✓✓</span>
                      ) : null}
                    </div>
                  </button>
                </div>
              </div>
            );
          })}

          <div ref={endRef} />
        </div>

        {showJump ? (
          <button
            className={styles.jump}
            onClick={() => scrollBottom()}
            aria-label="Aller aux derniers messages"
          >
            {newMessageCount > 0 ? (
              <span className={styles.jumpBadge}>
                {newMessageCount > 99 ? '99+' : newMessageCount}
              </span>
            ) : null}
            ↓
          </button>
        ) : null}

        {reply ? (
          <div className={styles.replyBar}>
            <div>
              <b>Réponse à {reply.senderName || 'Message'}</b>
              <span>{String(reply.text).slice(0, 95)}</span>
            </div>
            <button onClick={() => setReply(null)} aria-label="Annuler la réponse">×</button>
          </div>
        ) : null}

        {showEmoji ? (
          <div className={styles.emojiPanel}>
            {['😀','😂','🥰','😍','👍','🙏','🔥','🎉','❤️','👏','😅','😢'].map(
              emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setText(v => `${v}${emoji}`);
                    setShowEmoji(false);
                  }}
                >
                  {emoji}
                </button>
              )
            )}
          </div>
        ) : null}

        <div className={styles.composer}>
          <div className={styles.inputShell}>
            <button
              className={styles.iconButton}
              type="button"
              onClick={() => setShowEmoji(v => !v)}
              aria-label="Emoji"
            >
              ☺
            </button>

            <textarea
              rows={1}
              value={text}
              placeholder="Message"
              className={styles.input}
              onChange={e => {
                setText(e.target.value);
                publishTyping();
              }}
              onFocus={() => {
                setShowEmoji(false);
                window.setTimeout(() => scrollBottom(false), 180);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>

          <button
            className={`${styles.sendButton} ${
              !text.trim() ? styles.sendButtonDisabled : ''
            }`}
            type="button"
            onClick={send}
            disabled={!text.trim()}
            aria-label="Envoyer"
          >
            ➤
          </button>
        </div>
      </div>

      {selectedMessage && menuPos ? (
        <>
          <button
            type="button"
            className={styles.menuDismiss}
            aria-label="Fermer le menu du message"
            onClick={() => {
              setSelectedMessage(null);
              setMenuPos(null);
            }}
          />

          <div
            className={styles.messageMenu}
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={e => e.stopPropagation()}
          >
            {(selectedMessage.mine || viewer.role === 'admin') ? (
              <button
                type="button"
                className={styles.menuDanger}
                onClick={() => {
                  setDeleteTarget(selectedMessage);
                  setSelectedMessage(null);
                  setMenuPos(null);
                }}
                aria-label="Supprimer"
                title="Supprimer"
              >
                <span>🗑</span>
                <small>Supprimer</small>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setReply(selectedMessage);
                setSelectedMessage(null);
                setMenuPos(null);
              }}
              aria-label="Répondre"
              title="Répondre"
            >
              <span>↩</span>
              <small>Répondre</small>
            </button>

            <button
              type="button"
              onClick={() => {
                copyMessage(selectedMessage);
                setMenuPos(null);
              }}
              aria-label="Copier"
              title="Copier"
            >
              <span>⧉</span>
              <small>Copier</small>
            </button>

            {viewer.role === 'admin' ? (
              <button
                type="button"
                onClick={() => {
                  pin(selectedMessage.id, selectedMessage.isPinned);
                  setMenuPos(null);
                }}
                aria-label={selectedMessage.isPinned ? 'Désépingler' : 'Épingler'}
                title={selectedMessage.isPinned ? 'Désépingler' : 'Épingler'}
              >
                <span>📌</span>
                <small>{selectedMessage.isPinned ? 'Désépingler' : 'Épingler'}</small>
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {deleteTarget ? (
        <div className={styles.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.deleteSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <h3>Supprimer le message ?</h3>

            <button
              className={styles.deleteForEveryone}
              onClick={() => remove(deleteTarget.id)}
            >
              Supprimer pour tout le monde
            </button>

            <button
              className={styles.cancelDelete}
              onClick={() => setDeleteTarget(null)}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
