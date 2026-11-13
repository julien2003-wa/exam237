'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import HomeView from './home-view';
import SubjectsView from './subjects-view';
import ChatView from './chat-view';
import ProfileView from './profile-view';
import PremiumSheet from './premium-sheet';
import PaperSheet from './paper-sheet';
import StoryViewer from './story-viewer';
import ExamMode from './exam-mode';
import { Icon } from './icons';
import { api, post, type Bootstrap, type Paper } from './lib';

// Chargés seulement quand on en a besoin : les élèves ne téléchargent pas l'admin.
const AdminView = dynamic(() => import('./admin-view'), {
  ssr: false,
  loading: () => <div className="empty">Chargement de l’administration…</div>,
});
const TutorView = dynamic(() => import('./tutor-view'), {
  ssr: false,
  loading: () => <div className="empty">Chargement du Prof IA…</div>,
});

export type { Viewer } from './lib';

type Tab = 'home' | 'subjects' | 'chat' | 'tutor' | 'admin' | 'profile';

const TAB_ICONS: Record<Tab, string> = {
  home: 'home',
  subjects: 'book',
  chat: 'chat',
  tutor: 'sparkles',
  admin: 'settings',
  profile: 'user',
};

export default function ExamApp() {
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type?: 'error' } | null>(null);
  const [unread, setUnread] = useState(0);
  const [premiumOpen, setPremiumOpen] = useState<{ renew?: boolean } | null>(null);
  const [sheetPaperId, setSheetPaperId] = useState<string | null>(null);
  const [storyIndex, setStoryIndex] = useState<number | null>(null);
  const [examPaperId, setExamPaperId] = useState<string | null>(null);
  const [subjectFocus, setSubjectFocus] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollByTab = useRef<Record<string, number>>({});
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((text: string, type?: 'error') => {
    setToast({ text, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await api('/api/data?action=bootstrap');
      setData(d);
    } catch (e: any) {
      if (e?.status === 401) {
        router.replace('/bienvenue');
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        window.location.replace('/offline.html');
        return;
      }
      setLoadError(e?.message || 'Impossible de charger Exam237.');
    }
  }, [router]);

  useEffect(() => {
    document.documentElement.classList.add('app-mode');
    load();
    return () => document.documentElement.classList.remove('app-mode');
  }, [load]);

  useEffect(() => {
    const retry = () => {
      if (!data) load();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [data, load]);

  const viewer = data?.viewer;
  const isAdmin = viewer?.role === 'admin';
  const hasChat = !!(data?.rooms && data.rooms.length);

  const tabs = useMemo(() => {
    if (!viewer) return [] as Array<{ id: Tab; label: string }>;
    if (isAdmin)
      return [
        { id: 'admin' as Tab, label: 'Admin' },
        { id: 'chat' as Tab, label: 'Chats' },
        { id: 'profile' as Tab, label: 'Profil' },
      ];
    const list: Array<{ id: Tab; label: string }> = [
      { id: 'home', label: 'Accueil' },
      { id: 'subjects', label: 'Sujets' },
    ];
    if (hasChat) list.push({ id: 'chat', label: 'Chat' });
    if (data?.assistant?.tutor) list.push({ id: 'tutor', label: 'Prof IA' });
    list.push({ id: 'profile', label: 'Profil' });
    return list;
  }, [viewer, isAdmin, hasChat, data?.assistant?.tutor]);

  // L'admin arrive directement sur son tableau de bord.
  useEffect(() => {
    if (tabs.length && !tabs.some(t => t.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);

  const switchTab = useCallback((next: Tab) => {
    setTab(current => {
      if (current === next) return current;
      if (mainRef.current) scrollByTab.current[current] = mainRef.current.scrollTop;
      return next;
    });
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = scrollByTab.current[tab] || 0;
    });
    return () => cancelAnimationFrame(id);
  }, [tab]);

  // Bouton « retour » du téléphone : revient à l'accueil au lieu de quitter l'appli.
  useEffect(() => {
    if (!viewer || isAdmin) return;
    if (tab !== 'home') {
      window.history.pushState({ exam237: tab }, '');
      const onPop = () => setTab('home');
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
  }, [tab, viewer, isAdmin]);

  const updatePaper = useCallback((id: string, patch: Partial<Paper>) => {
    setData(current =>
      current
        ? { ...current, papers: current.papers.map(p => (p.id === id ? { ...p, ...patch } : p)) }
        : current
    );
  }, []);

  const setPaperState = useCallback(
    async (paper: Paper, patch: { favorite?: boolean; status?: 'done' | 'review' | null }) => {
      const before = { favorite: paper.favorite, status: paper.status };
      updatePaper(paper.id, patch as Partial<Paper>);
      try {
        await post('/api/me', { action: 'paper_state', paperId: paper.id, ...patch });
      } catch (e: any) {
        updatePaper(paper.id, before);
        notify(e.message, 'error');
      }
    },
    [notify, updatePaper]
  );

  const logout = async () => {
    try {
      await post('/api/auth?action=logout', {});
    } finally {
      router.replace('/bienvenue');
    }
  };

  if (!data || !viewer) {
    return (
      <main className="splash">
        <div>
          <img src="/logo.png" alt="Exam237" />
          {loadError ? (
            <div className="stack" style={{ justifyItems: 'center' }}>
              <p>{loadError}</p>
              <button className="btn btn-gold" onClick={load}>
                Réessayer
              </button>
            </div>
          ) : (
            <p>Chargement…</p>
          )}
        </div>
      </main>
    );
  }

  const sheetPaper = sheetPaperId ? data.papers.find(p => p.id === sheetPaperId) || null : null;
  const examPaper = examPaperId ? data.papers.find(p => p.id === examPaperId) || null : null;
  const immersive = tab === 'chat' || tab === 'tutor';
  const openPaper = (paper: Paper) => setSheetPaperId(paper.id);
  const openPremium = (renew = false) => setPremiumOpen({ renew });

  return (
    <div className="app" data-immersive={immersive ? 'true' : 'false'}>
      <main ref={mainRef} className={`app-main ${immersive ? 'immersive' : ''}`}>
        {data.warning && tab === 'home' ? (
          <div className="page" style={{ paddingBottom: 0 }}>
            <div className="banner">{data.warning}</div>
          </div>
        ) : null}

        {tab === 'home' && !isAdmin ? (
          <HomeView
            data={data}
            unread={unread}
            onOpenPaper={openPaper}
            onOpenStory={setStoryIndex}
            onPremium={openPremium}
            onOpenSubjects={subjectId => {
              setSubjectFocus(subjectId || null);
              switchTab('subjects');
            }}
            onOpenProfile={() => switchTab('profile')}
          />
        ) : null}

        {tab === 'subjects' ? (
          <SubjectsView
            papers={data.papers}
            focusSubject={subjectFocus}
            onFocusSubject={setSubjectFocus}
            onOpenPaper={openPaper}
            onPremium={() => openPremium()}
            premium={viewer.premium}
          />
        ) : null}

        {/* Le chat reste chargé en arrière-plan : messages instantanés et compteur à jour. */}
        {hasChat ? (
          <div style={{ display: tab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <ChatView
              viewer={viewer}
              rooms={data.rooms}
              active={tab === 'chat'}
              assistantEnabled={data.assistant.chat}
              notify={notify}
              onUnread={setUnread}
              onBack={() => switchTab(isAdmin ? 'admin' : 'home')}
              onPremium={() => openPremium()}
            />
          </div>
        ) : null}

        {tab === 'tutor' ? (
          <TutorView
            viewer={viewer}
            notify={notify}
            onBack={() => switchTab('home')}
            onPremium={() => openPremium()}
          />
        ) : null}

        {tab === 'admin' && isAdmin ? (
          <div className="page" style={{ maxWidth: 1180 }}>
            <AdminView notify={notify} />
          </div>
        ) : null}

        {tab === 'profile' ? (
          <ProfileView
            viewer={viewer}
            site={data.site}
            onLogout={logout}
            onRefresh={load}
            onPremium={openPremium}
            notify={notify}
          />
        ) : null}
      </main>

      <nav
        className="app-nav"
        aria-label="Navigation principale"
        style={{ ['--tabs' as any]: tabs.length }}
      >
        <div className="nav-brand">
          <img src="/logo.png" alt="" />
          <span>EXAM237</span>
        </div>
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => switchTab(t.id)}
          >
            <span className="nav-pill">
              <Icon name={TAB_ICONS[t.id]} size={22} />
            </span>
            {t.label}
            {t.id === 'chat' && unread > 0 && tab !== 'chat' ? (
              <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {sheetPaper ? (
        <PaperSheet
          paper={sheetPaper}
          viewer={viewer}
          onClose={() => setSheetPaperId(null)}
          onPremium={() => {
            setSheetPaperId(null);
            openPremium();
          }}
          onState={patch => setPaperState(sheetPaper, patch)}
          onExam={() => {
            setSheetPaperId(null);
            setExamPaperId(sheetPaper.id);
          }}
          notify={notify}
        />
      ) : null}

      {examPaper ? (
        <ExamMode
          paper={examPaper}
          onClose={() => setExamPaperId(null)}
          onDone={() => {
            if (examPaper.status !== 'done') setPaperState(examPaper, { status: 'done' });
          }}
          onOpenSheet={() => {
            setExamPaperId(null);
            setSheetPaperId(examPaper.id);
          }}
        />
      ) : null}

      {storyIndex !== null && data.promos[storyIndex] ? (
        <StoryViewer
          promos={data.promos}
          start={storyIndex}
          site={data.site}
          viewer={viewer}
          onClose={() => setStoryIndex(null)}
          onPremium={() => {
            setStoryIndex(null);
            openPremium();
          }}
        />
      ) : null}

      {premiumOpen ? (
        <PremiumSheet
          viewer={viewer}
          site={data.site}
          renew={!!premiumOpen.renew}
          onClose={() => setPremiumOpen(null)}
        />
      ) : null}

      {toast ? (
        <div className={`toast ${toast.type === 'error' ? 'error' : ''}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
