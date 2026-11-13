'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import PdfReader, { clearReaderCache } from './pdf-reader';
import { Icon } from './icons';
import { api, post, type Bootstrap, type Paper } from './lib';
import * as nav from './nav';
import { paths, parseRoute, routePath, VIEW_PATH, type Route, type View } from './nav';

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

const TAB_ICONS: Record<View, string> = {
  home: 'home',
  subjects: 'book',
  chat: 'chat',
  tutor: 'sparkles',
  admin: 'settings',
  profile: 'user',
};

const TITLES: Record<View, string> = {
  home: 'Exam237',
  subjects: 'Sujets',
  chat: 'Chat',
  tutor: 'Prof IA',
  admin: 'Administration',
  profile: 'Profil',
};

export default function ExamApp() {
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type?: 'error' } | null>(null);
  const [unread, setUnread] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollByTab = useRef<Record<string, number>>({});
  const restoring = useRef(false);
  const toastTimer = useRef<number | null>(null);

  // L'adresse décide de l'écran affiché (voir nav.ts).
  const location = useSyncExternalStore(nav.subscribe, nav.snapshot, nav.serverSnapshot);
  const known = location !== '';
  const hashAt = location.indexOf('#');
  const path = (hashAt >= 0 ? location.slice(0, hashAt) : location) || '/';
  const modal = hashAt >= 0 ? location.slice(hashAt + 1) : null;
  const route = useMemo(() => parseRoute(path), [path]);

  // L'écran resté derrière un sujet ouvert (accueil, liste des sujets…).
  const [base, setBase] = useState<Route | null>(null);
  useEffect(() => {
    if (known && !route.layer) setBase(route);
  }, [known, route]);

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
        clearReaderCache();
        // Un lien partagé (un sujet, le chat…) : on y revient après la connexion.
        const here = window.location.pathname;
        router.replace(here === '/' ? '/bienvenue' : `/connexion?next=${encodeURIComponent(here)}`);
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
  const homeView: View = isAdmin ? 'admin' : 'home';
  const hasChat = !!(data?.rooms && data.rooms.length);

  const tabs = useMemo(() => {
    if (!viewer) return [] as Array<{ id: View; label: string }>;
    if (isAdmin)
      return [
        { id: 'admin' as View, label: 'Admin' },
        { id: 'chat' as View, label: 'Chats' },
        { id: 'profile' as View, label: 'Profil' },
      ];
    const list: Array<{ id: View; label: string }> = [
      { id: 'home', label: 'Accueil' },
      { id: 'subjects', label: 'Sujets' },
    ];
    if (hasChat) list.push({ id: 'chat', label: 'Chat' });
    if (data?.assistant?.tutor) list.push({ id: 'tutor', label: 'Prof IA' });
    list.push({ id: 'profile', label: 'Profil' });
    return list;
  }, [viewer, isAdmin, hasChat, data?.assistant?.tutor]);

  const paper = route.paperId ? data?.papers.find(p => p.id === route.paperId) || null : null;

  // Écran affiché sous un sujet ouvert ; pour un lien partagé, la matière du sujet.
  const shown: Route = route.layer
    ? base || {
        view: isAdmin ? 'admin' : 'subjects',
        subject: paper?.subjectId || null,
        paperId: null,
        layer: null,
        doc: null,
      }
    : route;
  const wanted: View = shown.view === 'home' && isAdmin ? 'admin' : shown.view;
  const tab: View = tabs.some(t => t.id === wanted) ? wanted : homeView;
  const subjectFocus = tab === 'subjects' ? shown.subject : null;

  // Adresse inconnue pour ce compte (chat absent, page admin…) : on la corrige.
  useEffect(() => {
    if (!viewer || route.layer) return;
    if (wanted !== tab) nav.navigate(VIEW_PATH[tab], { replace: true });
    else if (isAdmin && path === '/') nav.navigate('/admin', { replace: true });
  }, [viewer, route.layer, wanted, tab, isAdmin, path]);

  // Sujet introuvable (retiré, ou d'une autre classe).
  useEffect(() => {
    if (!data || !route.paperId || paper) return;
    notify('Ce sujet n’est pas disponible.', 'error');
    nav.navigate(isAdmin ? '/admin' : '/sujets', { replace: true });
  }, [data, route.paperId, paper, isAdmin, notify]);

  // Titre de l'onglet du navigateur.
  useEffect(() => {
    if (!data) return;
    let title = TITLES[tab];
    if (paper && route.layer) {
      const name = `${paper.subjectName} ${paper.year}`;
      title =
        route.layer === 'read'
          ? `${name}, ${route.doc === 'paper' ? 'sujet' : 'correction'}`
          : route.layer === 'exam'
            ? `${name}, mode examen`
            : name;
    } else if (subjectFocus) {
      title = data.papers.find(p => p.subjectId === subjectFocus)?.subjectName || title;
    }
    document.title = title === 'Exam237' ? title : `${title} | Exam237`;
  }, [data, tab, paper, route.layer, route.doc, subjectFocus]);

  // Chaque onglet retrouve l'endroit où l'élève l'avait laissé.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    restoring.current = true;
    el.scrollTop = scrollByTab.current[tab] || 0;
    const timer = window.setTimeout(() => {
      restoring.current = false;
    }, 150);
    return () => window.clearTimeout(timer);
  }, [tab, !!data]);

  const goView = useCallback(
    (next: View) => {
      if (next === tab) {
        if (next === 'subjects' && subjectFocus) return nav.backTo('/sujets');
        mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      // Accueil : on revient en arrière plutôt que d'empiler les écrans.
      if (next === homeView) return nav.backTo(VIEW_PATH[homeView]);
      // Depuis l'accueil, un onglet s'ouvre par-dessus ; entre deux onglets, il remplace.
      nav.navigate(VIEW_PATH[next], { replace: tab !== homeView });
    },
    [tab, homeView, subjectFocus]
  );

  const updatePaper = useCallback((id: string, patch: Partial<Paper>) => {
    setData(current =>
      current
        ? { ...current, papers: current.papers.map(p => (p.id === id ? { ...p, ...patch } : p)) }
        : current
    );
  }, []);

  const setPaperState = useCallback(
    async (target: Paper, patch: { favorite?: boolean; status?: 'done' | 'review' | null }) => {
      const before = { favorite: target.favorite, status: target.status };
      updatePaper(target.id, patch as Partial<Paper>);
      try {
        await post('/api/me', { action: 'paper_state', paperId: target.id, ...patch });
      } catch (e: any) {
        updatePaper(target.id, before);
        notify(e.message, 'error');
      }
    },
    [notify, updatePaper]
  );

  const logout = async () => {
    try {
      await post('/api/auth?action=logout', {});
    } finally {
      clearReaderCache();
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

  const immersive = tab === 'chat' || tab === 'tutor';
  const basePath = base ? routePath(base) : paper ? paths.subject(paper.subjectId) : '/sujets';
  const openPaper = (p: Paper) => nav.navigate(paths.paper(p.id));
  const openPremium = (renew = false) =>
    nav.navigate(path, { modal: renew ? 'premium-renew' : 'premium' });
  const closeModal = () => nav.close(path);
  const storyIndex = modal?.startsWith('video:') ? Number(modal.slice(6)) : null;

  // Un fichier enregistré sur le téléphone s'ouvre dans le lecteur.
  const openSaved = (url: string) => {
    const params = new URL(url, window.location.origin).searchParams;
    const id = params.get('id') || '';
    const owner =
      params.get('kind') === 'paper'
        ? data.papers.find(p => p.id === id)
        : data.papers.find(p => p.corrections.some(c => c.id === id));
    if (!owner) return false;
    nav.navigate(paths.read(owner.id, params.get('kind') === 'paper' ? 'paper' : id));
    return true;
  };

  return (
    <div className="app" data-immersive={immersive ? 'true' : 'false'}>
      <main
        ref={mainRef}
        className={`app-main ${immersive ? 'immersive' : ''}`}
        onScroll={e => {
          if (!restoring.current) scrollByTab.current[tab] = e.currentTarget.scrollTop;
        }}
      >
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
            onOpenStory={index => nav.navigate(path, { modal: `video:${index}` })}
            onPremium={openPremium}
            onOpenSubjects={subjectId =>
              nav.navigate(subjectId ? paths.subject(subjectId) : '/sujets')
            }
            onOpenProfile={() => goView('profile')}
          />
        ) : null}

        {tab === 'subjects' ? (
          <SubjectsView
            papers={data.papers}
            focusSubject={subjectFocus}
            onFocusSubject={id =>
              id
                ? nav.navigate(paths.subject(id), { replace: !!subjectFocus })
                : nav.backTo('/sujets')
            }
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
              onBack={() => nav.backTo(VIEW_PATH[homeView])}
              onPremium={() => openPremium()}
            />
          </div>
        ) : null}

        {tab === 'tutor' ? (
          <TutorView
            viewer={viewer}
            notify={notify}
            onBack={() => nav.backTo('/')}
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
            onOpenSaved={openSaved}
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
            onClick={() => goView(t.id)}
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

      {paper && route.layer === 'sheet' ? (
        <PaperSheet
          paper={paper}
          viewer={viewer}
          onClose={() => !modal && nav.close(basePath)}
          onPremium={() => openPremium()}
          onState={patch => setPaperState(paper, patch)}
          onExam={() => nav.navigate(paths.exam(paper.id))}
          onRead={doc => nav.navigate(paths.read(paper.id, doc))}
          notify={notify}
        />
      ) : null}

      {paper && route.layer === 'read' ? (
        <PdfReader
          paper={paper}
          doc={route.doc || 'paper'}
          onClose={() => !modal && nav.close(paths.paper(paper.id))}
          onSwitch={doc => nav.navigate(paths.read(paper.id, doc), { replace: true })}
          onPremium={() => openPremium()}
        />
      ) : null}

      {paper && route.layer === 'exam' ? (
        <ExamMode
          paper={paper}
          onClose={() => nav.close(paths.paper(paper.id))}
          onRead={() => nav.navigate(paths.read(paper.id, 'paper'))}
          onDone={() => {
            if (paper.status !== 'done') setPaperState(paper, { status: 'done' });
          }}
          onCorrection={() => {
            const correction = paper.corrections.find(c => c.pdfUrl);
            if (correction) nav.navigate(paths.read(paper.id, correction.id), { replace: true });
            else nav.close(paths.paper(paper.id));
          }}
        />
      ) : null}

      {storyIndex !== null && data.promos[storyIndex] ? (
        <StoryViewer
          promos={data.promos}
          start={storyIndex}
          site={data.site}
          viewer={viewer}
          onClose={closeModal}
          onPremium={() => nav.navigate(path, { replace: true, modal: 'premium' })}
        />
      ) : null}

      {modal === 'premium' || modal === 'premium-renew' ? (
        <PremiumSheet
          viewer={viewer}
          site={data.site}
          renew={modal === 'premium-renew'}
          onClose={closeModal}
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
