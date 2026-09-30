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
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<any>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setMessages(d.messages || []);
      onUnread(0);
      if (scroll) scrollBottom(false);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }, [notify, onUnread, scrollBottom, selected?.id]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => { if (selected?.id) loadMessages(); }, [loadMessages, selected?.id]);

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

        channel.subscribe('message', () => loadMessages(false));

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
          await channel.presence.enter({
            name: viewer.displayName || 'Exam237'
          });

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

  const report = async (id: string) => {
    try {
      await jfetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          messageId: id,
          reason: 'Signalé depuis le chat'
        })
      });

      notify('Message signalé.');
      setSelectedMessage(null);
    } catch (e: any) {
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
      await loadMessages(false);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const beginLongPress = (m: any) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);

    longPressRef.current = setTimeout(() => {
      navigator.vibrate?.(35);
      setSelectedMessage(m);
    }, 380);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;

    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(distance > 220);
  };

  const statusText = typing
    ? typing
    : realtime && onlineCount > 1
      ? `${onlineCount} en ligne`
      : 'En ligne';

  if (!rooms.length) {
    return <div className="empty">Aucun groupe de discussion disponible.</div>;
  }

  return (
    <section className={styles.page}>
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

          <div className={styles.headerActions}>
            <button type="button" aria-label="Options">⋮</button>
          </div>
        </header>

        <div
          ref={messagesRef}
          className={styles.messages}
          onScroll={onMessagesScroll}
        >
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
                  <div
                    className={`${styles.bubble} ${
                      m.mine ? styles.mineBubble : styles.otherBubble
                    } ${
                      m.senderUserId === null ? styles.adminBubble : ''
                    }`}
                    onPointerDown={() => beginLongPress(m)}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onDoubleClick={() => setReply(m)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setSelectedMessage(m);
                    }}
                    draggable={false}
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
                  </div>
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
            aria-label="Derniers messages"
          >
            ↓
          </button>
        ) : null}

        {reply ? (
          <div className={styles.replyBar}>
            <div>
              <b>Réponse à {reply.senderName || 'Message'}</b>
              <span>{String(reply.text).slice(0, 95)}</span>
            </div>

            <button
              onClick={() => setReply(null)}
              aria-label="Annuler la réponse"
            >
              ×
            </button>
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

      {selectedMessage ? (
        <div
          className={styles.overlay}
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className={styles.actionSheet}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.sheetHandle} />

            <button
              onClick={() => {
                setReply(selectedMessage);
                setSelectedMessage(null);
              }}
            >
              <span>↩</span>
              Répondre
            </button>

            {(selectedMessage.mine || viewer.role === 'admin') ? (
              <button
                className={styles.danger}
                onClick={() => {
                  setDeleteTarget(selectedMessage);
                  setSelectedMessage(null);
                }}
              >
                <span>🗑</span>
                Supprimer
              </button>
            ) : null}

            {viewer.role === 'student' && !selectedMessage.mine ? (
              <button onClick={() => report(selectedMessage.id)}>
                <span>⚑</span>
                Signaler
              </button>
            ) : null}

            {viewer.role === 'admin' ? (
              <button
                onClick={() =>
                  pin(selectedMessage.id, selectedMessage.isPinned)
                }
              >
                <span>📌</span>
                {selectedMessage.isPinned ? 'Désépingler' : 'Épingler'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className={styles.overlay}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className={styles.deleteSheet}
            onClick={e => e.stopPropagation()}
          >
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
