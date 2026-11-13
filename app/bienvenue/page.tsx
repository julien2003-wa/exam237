import type { Metadata } from 'next';
import { assistantConfigured } from '@/lib/assistant';
import { examTargets } from '@/lib/exams';
import { loadLandingData } from '@/lib/landing-data';
import { Icon } from '@/components/icons';
import {
  display,
  examsPhrase,
  FinalCall,
  LandingFooter,
  LandingHeader,
  PremiumPerks,
  PriceList,
  whatsappLink,
} from '@/components/landing-parts';
import {
  ExamCountdown,
  LandingDemo,
  Showcase,
  StickyActions,
  SubjectExplorer,
  type CountdownTarget,
  type DemoFrame,
  type ShowcaseItem,
} from '@/components/landing';
import './landing.css';

// Page de présentation publique. Les données viennent de la base (mises à jour toutes les 10 minutes).
// Le détail (fonctionnement, paiement, calendrier, questions) est sur la page À propos.
export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: 'Exam237 : les vrais sujets corrigés du BEPC, du Probatoire et du Bac' },
  description:
    'Les sujets des années passées et leurs corrections détaillées, sur ton téléphone. Mode examen avec chrono, chat de ta classe, lecture sans connexion.',
  alternates: { canonical: '/bienvenue' },
};

// Démo : de vraies captures de l'application, enchaînées comme si on la touchait.
const DEMO: DemoFrame[] = [
  {
    src: '/apercu/demo-1.webp',
    caption: 'Ton accueil : ton examen, ta progression',
    tap: [50, 78.2],
  },
  {
    src: '/apercu/demo-2.webp',
    caption: 'Choisis la matière, puis l’année',
    tap: [50, 35.9],
    enter: 'slide',
  },
  { src: '/apercu/demo-3.webp', caption: 'La fiche du sujet', tap: [50, 55.9], enter: 'fade' },
  {
    src: '/apercu/demo-4.webp',
    caption: 'Le sujet s’ouvre dans l’appli',
    tap: [36, 8.8],
    enter: 'slide',
    still: true,
  },
  { src: '/apercu/demo-5.webp', caption: 'Puis compare avec la correction', enter: 'fade' },
];

export default async function Bienvenue() {
  const data = await loadLandingData();
  const site = data.site;
  const now = Date.now();
  const exams = data.catalog.map(c => c.exam);
  const whatsapp = whatsappLink(site);
  const tutor = assistantConfigured();

  // Compte à rebours : dates de Réglages, sinon le début officiel de la période d'examens.
  const targets: CountdownTarget[] = examTargets(site?.examDates || {}, now).map(t => ({
    title: t.title,
    date: t.date,
    caption: t.exact
      ? 'Premier jour des épreuves.'
      : 'Début officiel des examens. Les dates exactes de chaque examen seront publiées plus tard.',
  }));

  const showcase: ShowcaseItem[] = [
    {
      title: 'Le sujet et sa correction',
      text: 'Ils s’ouvrent dans l’appli. Tu zoomes avec deux doigts, et tu reprends à la page où tu t’étais arrêté.',
      src: '/apercu/demo-5.webp',
      alt: 'Une correction ouverte dans le lecteur d’Exam237',
    },
    {
      title: 'Le mode examen',
      text: 'Le chrono démarre et le sujet s’ouvre, comme le jour J. À la fin, tu compares avec la correction.',
      src: '/apercu/vitrine-examen.webp',
      alt: 'Le chrono du mode examen',
    },
    {
      title: 'Le chat de ta classe',
      text: 'Pose tes questions aux élèves de ta classe et aide les autres. Chaque message peut être signalé.',
      src: '/apercu/vitrine-chat.webp',
      alt: 'Le chat de classe d’Exam237',
    },
    ...(tutor
      ? [
          {
            title: 'Le Prof IA',
            text: 'Bloqué sur un exercice ? Écris ta question ou envoie une photo : il te met sur la piste. Avec le Premium.',
            src: '/apercu/vitrine-prof-ia.webp',
            alt: 'Le Prof IA d’Exam237',
          },
        ]
      : []),
    {
      title: 'Sans connexion',
      text: 'Avec le Premium, enregistre un sujet et sa correction sur ton téléphone, puis lis-les sans internet.',
      src: '/apercu/vitrine-hors-ligne.webp',
      alt: 'Un sujet enregistré sur le téléphone',
    },
  ];

  return (
    <main className={`lp ${display.variable}`}>
      <LandingHeader current="home" />

      <section className="lp-hero">
        <div className="lp-hero-text">
          <h1>Ton nom sur la liste des admis, ça commence ici.</h1>
          <p className="lp-lead">
            Les vrais sujets {examsPhrase(exams)} des années passées, avec leurs corrections
            détaillées, sur ton téléphone.
          </p>
          <div className="lp-ctas" id="lp-hero-cta">
            <a className="lp-btn lp-btn-sun lp-btn-big" href="/connexion?mode=register">
              Commencer gratuitement
            </a>
            <a className="lp-link" href="/connexion">
              J’ai déjà un compte
            </a>
          </div>
          <p className="lp-assure">
            <Icon name="check" size={18} strokeWidth={2.6} />
            Gratuit, sans engagement. Premium payé par MTN MoMo ou Orange Money.
          </p>
        </div>
        <LandingDemo
          frames={DEMO}
          label="Démonstration d’Exam237 : on choisit Mathématiques, on ouvre le sujet, puis sa correction."
        />
      </section>

      {targets.length ? (
        <section className="lp-countband" aria-label="Compte à rebours">
          <ExamCountdown
            targets={targets}
            serverNow={now}
            more={{ href: '/a-propos#calendrier', label: 'Voir le calendrier' }}
          />
        </section>
      ) : null}

      {data.catalog.length ? (
        <section className="lp-section" id="sujets">
          <div className="lp-head">
            <h2>Les sujets déjà dans l’appli</h2>
            <p>Choisis ton examen et ta matière : voici les années disponibles aujourd’hui.</p>
          </div>
          <SubjectExplorer catalog={data.catalog} />
        </section>
      ) : null}

      <section className="lp-section">
        <div className="lp-head">
          <h2>Révise comme le jour de l’examen</h2>
          <p>
            Des écrans de l’application, avec un compte de démonstration.{' '}
            <a className="lp-inline" href="/a-propos#comment">
              Comment ça marche
            </a>
          </p>
        </div>
        <Showcase items={showcase} />
      </section>

      <section className="lp-section" id="prix">
        <div className="lp-head">
          <h2>Gratuit pour commencer</h2>
          <p>Passe au Premium quand tu veux, pour la durée que tu veux.</p>
        </div>
        <div className="lp-plans">
          <article className="lp-plan">
            <h3>Gratuit</h3>
            <p className="lp-plan-price">0 FCFA</p>
            <ul>
              <li>
                <Icon name="check" size={18} strokeWidth={2.6} />
                Un sujet corrigé offert dans chaque matière
              </li>
              <li>
                <Icon name="check" size={18} strokeWidth={2.6} />
                Le chat de ta classe
              </li>
              <li>
                <Icon name="check" size={18} strokeWidth={2.6} />
                Le mode examen avec chrono
              </li>
            </ul>
            <a className="lp-btn lp-btn-forest" href="/connexion?mode=register">
              Créer mon compte
            </a>
          </article>
          <article className="lp-plan lp-plan-premium">
            <h3>Premium</h3>
            <PriceList site={site} />
            <PremiumPerks tutor={tutor} />
            <p className="lp-pay">
              <Icon name="phone" size={18} />
              <span>
                Paiement par MTN Mobile Money ou Orange Money, activation par WhatsApp.{' '}
                <a className="lp-inline" href="/a-propos#premium">
                  Comment payer
                </a>
              </span>
            </p>
            <a className="lp-btn lp-btn-sun" href="/connexion?mode=register">
              Commencer, puis passer Premium
            </a>
          </article>
        </div>
      </section>

      <FinalCall
        title={
          targets.length ? 'Le jour J approche. Commence aujourd’hui.' : 'Commence aujourd’hui.'
        }
      />
      <LandingFooter whatsapp={whatsapp} />
      <StickyActions whatsapp={whatsapp} />
    </main>
  );
}
