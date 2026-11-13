'use client';

/*
  Adresses de l'application.
  Chaque écran a sa propre adresse (/sujets/…, /chat, /profil…), mais on reste dans la même
  page : on change seulement l'adresse avec l'historique du navigateur. Le bouton « retour »
  du téléphone revient donc à l'écran précédent, et un lien partagé ouvre le bon écran.

  Chaque entrée de l'historique garde la liste des écrans ouverts avant elle (« pile »),
  pour savoir si l'on peut revenir en arrière sans sortir de l'application.
*/

const EVENT = 'exam237-nav';
const MAX_STACK = 40;

type Entry = { stack: string[] };

function key(path: string, modal?: string | null) {
  return modal ? `${path}#${modal}` : path;
}

function entry(): Entry {
  const saved = typeof window !== 'undefined' ? window.history.state?.exam237 : null;
  if (saved && Array.isArray(saved.stack) && saved.stack.length) return saved;
  return { stack: [key(window.location.pathname)] };
}

export function currentModal(): string | null {
  return (typeof window !== 'undefined' && window.history.state?.exam237?.modal) || null;
}

// Nombre d'écrans de l'application derrière celui-ci.
export function depth() {
  return entry().stack.length - 1;
}

export function navigate(path: string, options: { replace?: boolean; modal?: string | null } = {}) {
  const modal = options.modal || null;
  const { stack } = entry();
  const next = options.replace
    ? [...stack.slice(0, -1), key(path, modal)]
    : [...stack, key(path, modal)].slice(-MAX_STACK);
  const state = { exam237: { stack: next, modal } };
  if (options.replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
  window.dispatchEvent(new Event(EVENT));
}

// Ferme l'écran actuel : retour en arrière s'il a été ouvert depuis l'application,
// sinon (lien ouvert depuis WhatsApp, par exemple) on affiche l'écran parent.
export function close(fallback: string) {
  if (depth() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

// Revient à un écran déjà ouvert plus tôt (l'accueil, la liste des sujets…) sans empiler
// de nouvelles entrées ; s'il n'est pas dans l'historique, on le remplace.
export function backTo(path: string) {
  const { stack } = entry();
  const target = key(path);
  for (let i = stack.length - 2; i >= 0; i--)
    if (stack[i] === target) {
      window.history.go(i - (stack.length - 1));
      return;
    }
  navigate(path, { replace: true });
}

export function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function snapshot() {
  return key(window.location.pathname, currentModal());
}

// Pendant le premier affichage (avant que la page lise l'adresse) : adresse encore inconnue.
export function serverSnapshot() {
  return '';
}

/* ---------- Écrans ---------- */

export type View = 'home' | 'subjects' | 'chat' | 'tutor' | 'admin' | 'profile';
export type Layer = 'sheet' | 'read' | 'exam';

export type Route = {
  view: View;
  subject: string | null; // /sujets/matiere/<id>
  paperId: string | null; // /sujets/<id>
  layer: Layer | null;
  doc: string | null; // 'paper' ou l'identifiant d'une correction
};

export const VIEW_PATH: Record<View, string> = {
  home: '/',
  subjects: '/sujets',
  chat: '/chat',
  tutor: '/prof-ia',
  admin: '/admin',
  profile: '/profil',
};

const enc = encodeURIComponent;

export const paths = {
  subject: (id: string) => `/sujets/matiere/${enc(id)}`,
  paper: (id: string) => `/sujets/${enc(id)}`,
  read: (id: string, doc: string) =>
    doc === 'paper' ? `/sujets/${enc(id)}/lire` : `/sujets/${enc(id)}/correction/${enc(doc)}`,
  exam: (id: string) => `/sujets/${enc(id)}/examen`,
};

export function parseRoute(path: string): Route {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const route: Route = { view: 'home', subject: null, paperId: null, layer: null, doc: null };
  const [first, second, third, fourth] = parts;
  if (first === 'sujets') {
    route.view = 'subjects';
    if (second === 'matiere') route.subject = third || null;
    else if (second) {
      route.paperId = second;
      if (third === 'lire') {
        route.layer = 'read';
        route.doc = 'paper';
      } else if (third === 'correction' && fourth) {
        route.layer = 'read';
        route.doc = fourth;
      } else if (third === 'examen') route.layer = 'exam';
      else route.layer = 'sheet';
    }
  } else if (first === 'chat') route.view = 'chat';
  else if (first === 'prof-ia') route.view = 'tutor';
  else if (first === 'profil') route.view = 'profile';
  else if (first === 'admin') route.view = 'admin';
  return route;
}

export function routePath(route: Route): string {
  if (route.paperId) {
    if (route.layer === 'read') return paths.read(route.paperId, route.doc || 'paper');
    if (route.layer === 'exam') return paths.exam(route.paperId);
    return paths.paper(route.paperId);
  }
  if (route.view === 'subjects' && route.subject) return paths.subject(route.subject);
  return VIEW_PATH[route.view];
}

// Adresse « suivante » acceptée après la connexion (jamais un autre site).
export function safeNext(raw: string | null | undefined) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  try {
    const url = new URL(raw, 'https://exam237.local');
    if (url.origin !== 'https://exam237.local') return '/';
    if (!/^\/(?:(?:sujets|chat|prof-ia|profil|admin)(?:\/.*)?)?$/.test(url.pathname)) return '/';
    return url.pathname;
  } catch {
    return '/';
  }
}
