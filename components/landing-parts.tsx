/*
  Morceaux communs aux pages publiques (présentation et À propos) : police des titres,
  barre du haut, pied de page, prix, questions fréquentes. Rendu côté serveur.
*/

import localFont from 'next/font/local';
import { Icon } from './icons';
import { LandingMenu } from './landing';
import type { SiteSettings } from '@/lib/settings';

// Titres : Bricolage Grotesque (licence OFL, fichier dans app/fonts).
export const display = localFont({
  src: '../app/fonts/bricolage-grotesque-latin-wght.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--lp-display',
  fallback: ['system-ui', 'sans-serif'],
});

// Typographie française : espace insécable avant ? ! : ; et à l'intérieur des guillemets.
export function nbsp(text: string) {
  return text.replace(/ ([?!:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
}

export function whatsappLink(
  site: SiteSettings | null,
  text = 'Bonjour Exam237, j’ai une question.'
) {
  return site?.whatsapp ? `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}` : null;
}

const PLAN_LABELS: Array<[keyof SiteSettings['prices'], string]> = [
  ['1', '1 mois'],
  ['3', '3 mois'],
  ['6', '6 mois'],
  ['12', '12 mois'],
];

export function planPrices(site: SiteSettings | null) {
  return PLAN_LABELS.filter(([months]) => site?.prices?.[months]).map(([months, label]) => ({
    months,
    label,
    price: site!.prices[months],
  }));
}

// « du BEPC », « du BEPC et du Probatoire », « du BEPC, du Probatoire et du Bac ».
export function examsPhrase(exams: string[]) {
  const items = (exams.length ? exams : ['BEPC', 'Probatoire', 'Bac']).map(e => `du ${e}`);
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

const NAV = [
  { href: '/bienvenue#sujets', label: 'Sujets' },
  { href: '/bienvenue#prix', label: 'Prix' },
  { href: '/a-propos', label: 'À propos' },
];

export function LandingHeader({ current }: { current: 'home' | 'about' }) {
  return (
    <header className="lp-bar">
      <a className="lp-brand" href="/bienvenue" aria-label="Exam237, accueil">
        <img src="/logo.png" alt="" width={36} height={36} />
        <span>Exam237</span>
      </a>
      <nav className="lp-nav" aria-label="Menu principal">
        {NAV.map(item => (
          <a
            key={item.href}
            href={item.href}
            aria-current={current === 'about' && item.href === '/a-propos' ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="lp-bar-actions">
        <a className="lp-login" href="/connexion">
          Se connecter
        </a>
        <a className="lp-btn lp-btn-sun lp-bar-cta" href="/connexion?mode=register">
          Commencer
        </a>
        <LandingMenu
          links={[...NAV, { href: '/a-propos#questions', label: 'Questions fréquentes' }]}
        />
      </div>
    </header>
  );
}

export function LandingFooter({ whatsapp }: { whatsapp: string | null }) {
  return (
    <footer className="lp-foot">
      <div className="lp-brand">
        <img src="/logo.png" alt="" width={28} height={28} />
        <span>Exam237</span>
      </div>
      <p>Fait au Cameroun, pour les élèves qui préparent leurs examens officiels.</p>
      <nav aria-label="Liens">
        <a href="/bienvenue#sujets">Sujets</a>
        <a href="/bienvenue#prix">Prix</a>
        <a href="/a-propos">À propos</a>
        <a href="/a-propos#questions">Questions fréquentes</a>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener">
            WhatsApp
          </a>
        ) : null}
        <a href="/connexion">Se connecter</a>
      </nav>
      <small>© {new Date().getFullYear()} Exam237</small>
    </footer>
  );
}

export function FinalCall({ title }: { title: string }) {
  return (
    <section className="lp-final" id="lp-final">
      <h2>{nbsp(title)}</h2>
      <a className="lp-btn lp-btn-sun lp-btn-big" href="/connexion?mode=register">
        Commencer gratuitement
      </a>
      <a className="lp-link" href="/connexion">
        J’ai déjà un compte
      </a>
    </section>
  );
}

export function PremiumPerks({ tutor }: { tutor: boolean }) {
  const perks = [
    'Tous les sujets et toutes les corrections',
    'Les vidéos d’explication',
    ...(tutor ? ['Le Prof IA, pour débloquer un exercice'] : []),
    'La lecture sans connexion',
    'Aucune publicité',
  ];
  return (
    <ul>
      {perks.map(perk => (
        <li key={perk}>
          <Icon name="check" size={18} strokeWidth={2.6} />
          {perk}
        </li>
      ))}
    </ul>
  );
}

export function PriceList({ site }: { site: SiteSettings | null }) {
  const prices = planPrices(site);
  if (!prices.length)
    return <p className="lp-plan-price small">Les prix sont donnés sur WhatsApp</p>;
  return (
    <ul className="lp-prices">
      {prices.map(p => (
        <li key={p.months} className={p.months === '3' ? 'best' : ''}>
          <span>{p.label}</span>
          <b>{p.price}</b>
          {p.months === '3' ? <em>Conseillé</em> : null}
        </li>
      ))}
    </ul>
  );
}

export function HowItWorks() {
  return (
    <div className="lp-copy">
      <h2>Comment ça marche</h2>
      <ol>
        <li>
          <b>Crée ton compte</b>
          <span>Ton nom, ton e-mail et ta classe. C’est gratuit, et c’est fait en une minute.</span>
        </li>
        <li>
          <b>Choisis ta matière et l’année</b>
          <span>
            Les sujets de ton examen sont rangés par matière, du plus récent au plus ancien.
          </span>
        </li>
        <li>
          <b>Compose, puis corrige-toi</b>
          <span>Lance le chrono comme le jour J, puis compare ta copie avec la correction.</span>
        </li>
      </ol>
    </div>
  );
}

export function faqItems(exams: string[]): Array<{ q: string; a: string }> {
  return faqList(exams).map(item => ({ q: nbsp(item.q), a: nbsp(item.a) }));
}

function faqList(exams: string[]): Array<{ q: string; a: string }> {
  return [
    {
      q: 'C’est vraiment gratuit ?',
      a: 'Oui. Le compte est gratuit et sans engagement : tu as un sujet corrigé offert dans chaque matière, le chat de ta classe et le mode examen. Le Premium débloque tout le reste.',
    },
    {
      q: 'Pour quelles classes ?',
      a: `Pour les élèves qui préparent le ${examsPhrase(exams).replace(/^du /, '')}. Tu choisis ta classe à l’inscription et tu vois les sujets de ton examen.`,
    },
    {
      q: 'J’ai oublié mon mot de passe',
      a: 'Sur la page de connexion, touche « Mot de passe oublié ? » : tu écris à Exam237 sur WhatsApp, et tu reçois un lien pour en choisir un nouveau. Le lien marche une seule fois, pendant 24 heures.',
    },
    {
      q: 'Mes informations sont-elles protégées ?',
      a: 'Pour créer ton compte, il faut seulement ton nom, ton e-mail et ta classe. Ton mot de passe est enregistré sous une forme que personne ne peut relire, et les messages du chat sont chiffrés.',
    },
  ];
}
