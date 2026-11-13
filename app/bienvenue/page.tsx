import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { db } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { getSiteSettings, type SiteSettings } from '@/lib/settings';
import { assistantConfigured } from '@/lib/assistant';
import { examName, examTargets, OFFICIAL_EXAM_PERIOD } from '@/lib/exams';
import { Icon } from '@/components/icons';
import {
  ExamCountdown,
  ExamWord,
  LandingDemo,
  Showcase,
  StickyActions,
  SubjectExplorer,
  type CatalogExam,
  type CountdownTarget,
  type DemoFrame,
  type ShowcaseItem,
} from '@/components/landing';
import './landing.css';

// Page de présentation publique. Les données viennent de la base (mises à jour toutes les 10 minutes).
export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: 'Exam237 : les vrais sujets corrigés du BEPC, du Probatoire et du Bac' },
  description:
    'Les sujets des années passées et leurs corrections détaillées, sur ton téléphone. Mode examen avec chrono, chat de ta classe, lecture sans connexion.',
  alternates: { canonical: '/bienvenue' },
};

// Titres : Bricolage Grotesque (licence OFL, fichier dans app/fonts).
const display = localFont({
  src: '../fonts/bricolage-grotesque-latin-wght.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--lp-display',
  fallback: ['system-ui', 'sans-serif'],
});

const PLAN_LABELS: Array<[keyof SiteSettings['prices'], string]> = [
  ['1', '1 mois'],
  ['3', '3 mois'],
  ['6', '6 mois'],
  ['12', '12 mois'],
];

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

type Data = {
  site: SiteSettings | null;
  papers: number;
  corrections: number;
  subjects: number;
  students: number;
  catalog: CatalogExam[];
  recent: Array<{ subject: string; exam: string | null; year: number; at: string }>;
};

async function loadPage(): Promise<Data> {
  const data: Data = {
    site: null,
    papers: 0,
    corrections: 0,
    subjects: 0,
    students: 0,
    catalog: [],
    recent: [],
  };
  try {
    await ensureSchema();
    const sql = db();
    const [totals, rows, recent, students] = await Promise.all([
      sql`SELECT COUNT(*)::int AS papers,COUNT(DISTINCT p.subject_id)::int AS subjects,
                 (SELECT COUNT(*)::int FROM ex237_corrections cor JOIN ex237_papers pp ON pp.id=cor.paper_id
                  WHERE cor.status='published' AND pp.status='published') AS corrections
          FROM ex237_papers p WHERE p.status='published'`,
      sql`SELECT g.exam_type,s.name AS subject,p.exam_year,COUNT(DISTINCT p.id)::int AS n,
                 BOOL_OR(EXISTS(SELECT 1 FROM ex237_corrections cor
                                WHERE cor.paper_id=p.id AND cor.status='published')) AS corrected
          FROM ex237_papers p
          JOIN ex237_subjects s ON s.id=p.subject_id
          JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE p.status='published'
          GROUP BY g.exam_type,s.name,p.exam_year
          ORDER BY s.name,p.exam_year DESC`,
      sql`SELECT s.name AS subject,g.exam_type,p.exam_year,COALESCE(p.published_at,p.created_at) AS at
          FROM ex237_papers p
          JOIN ex237_subjects s ON s.id=p.subject_id
          JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE p.status='published'
          ORDER BY COALESCE(p.published_at,p.created_at) DESC LIMIT 10`,
      sql`SELECT COUNT(*)::int AS n FROM ex237_user_profiles`,
      getSiteSettings().then(s => (data.site = s)),
    ]);
    const t: any = (totals as any[])[0] || {};
    data.papers = t.papers || 0;
    data.corrections = t.corrections || 0;
    data.subjects = t.subjects || 0;
    data.students = (students as any[])[0]?.n || 0;
    // Examen → matière → années.
    const order = ['BEPC', 'Probatoire', 'Bac', 'CAP', 'GCE'];
    const byExam = new Map<string, Map<string, CatalogExam['subjects'][number]>>();
    for (const r of rows as any[]) {
      const exam = examName(r.exam_type);
      if (!exam) continue;
      if (!byExam.has(exam)) byExam.set(exam, new Map());
      const subjects = byExam.get(exam)!;
      if (!subjects.has(r.subject)) subjects.set(r.subject, { name: r.subject, years: [] });
      subjects
        .get(r.subject)!
        .years.push({ year: r.exam_year, count: r.n, corrected: !!r.corrected });
    }
    data.catalog = [...byExam.entries()]
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      .map(([exam, subjects]) => ({
        exam,
        subjects: [...subjects.values()].sort(
          (a, b) => b.years.length - a.years.length || a.name.localeCompare(b.name, 'fr')
        ),
      }));
    data.recent = (recent as any[]).map(r => ({
      subject: r.subject,
      exam: examName(r.exam_type),
      year: r.exam_year,
      at: new Date(r.at).toISOString(),
    }));
  } catch (error) {
    console.error('Page de présentation : données indisponibles', error);
  }
  return data;
}

const longDate = (date: string) => {
  const text = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Douala',
  }).format(new Date(`${date}T12:00:00+01:00`));
  return text.replace(/^(\S+) 1 /, '$1 1er ');
};

function ago(iso: string, now: number) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  const weeks = Math.round(days / 7);
  return weeks <= 1 ? 'il y a une semaine' : `il y a ${weeks} semaines`;
}

const list = (words: string[]) =>
  words.length <= 1
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} et ${words[words.length - 1]}`;

export default async function Bienvenue() {
  const data = await loadPage();
  const site = data.site;
  const now = Date.now();
  const year = new Date().getFullYear();

  const exams = data.catalog.map(c => c.exam);
  const words = exams.length ? exams : ['BEPC', 'Probatoire', 'Bac'];
  const wordsSpoken = `ton ${words.join(', ton ').replace(/, ton ([^,]+)$/, ' ou ton $1')}`;

  const whatsapp = site?.whatsapp
    ? `https://wa.me/${site.whatsapp}?text=${encodeURIComponent('Bonjour Exam237, j’ai une question.')}`
    : null;
  const prices = PLAN_LABELS.filter(([months]) => site?.prices?.[months]).map(
    ([months, label]) => ({
      months,
      label,
      price: site!.prices[months],
    })
  );

  // Compte à rebours : dates de Réglages, sinon le début officiel de la période d'examens.
  const targets: CountdownTarget[] = examTargets(site?.examDates || {}, now).map(t => ({
    title: t.title,
    date: t.date,
    caption: t.exact
      ? `Premier jour des épreuves : ${longDate(t.date)}.`
      : `Les examens officiels du secondaire commencent le ${longDate(t.date)}, d’après le calendrier scolaire ${OFFICIAL_EXAM_PERIOD.year - 1}-${OFFICIAL_EXAM_PERIOD.year}. Les dates exactes du BEPC, du Probatoire et du Bac seront publiées plus tard.`,
  }));

  // « Ajoutés récemment » seulement si des sujets ont vraiment été ajoutés ces dernières semaines.
  const fresh = data.recent.filter(r => now - new Date(r.at).getTime() < 45 * 86400000);
  const showFresh = fresh.length >= 2;
  const showFigures = data.papers >= 20;

  const tutor = assistantConfigured();
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

  const premiumPerks = [
    'Tous les sujets et toutes les corrections',
    'Les vidéos d’explication',
    ...(tutor ? ['Le Prof IA, pour débloquer un exercice'] : []),
    'La lecture sans connexion',
    'Aucune publicité',
  ];

  const faq: Array<{ q: string; a: string }> = [
    {
      q: 'C’est vraiment gratuit ?',
      a: 'Oui. Le compte est gratuit et sans engagement : tu as un sujet corrigé offert dans chaque matière, le chat de ta classe et le mode examen. Le Premium débloque tout le reste.',
    },
    {
      q: 'Comment payer le Premium ?',
      a: 'Dans l’appli, touche « Passer Premium ». WhatsApp s’ouvre avec un message déjà rempli (ton nom, ta classe, la formule). Tu paies par MTN Mobile Money ou Orange Money, puis Exam237 active ton Premium. Pas besoin de carte bancaire.',
    },
    {
      q: 'Pour quelles classes ?',
      a: exams.length
        ? `Pour les élèves qui préparent le ${list(exams)}. Tu choisis ta classe à l’inscription et tu vois les sujets de ton examen.`
        : 'Pour les élèves qui préparent le BEPC, le Probatoire ou le Bac. Tu choisis ta classe à l’inscription et tu vois les sujets de ton examen.',
    },
    {
      q: 'Est-ce que ça consomme beaucoup de données ?',
      a: 'Non. La taille de chaque fichier est affichée avant l’ouverture, seules les pages que tu lis sont téléchargées, et tu peux choisir de télécharger seulement en Wi-Fi.',
    },
    {
      q: 'Ça marche sans internet ?',
      a: 'Il faut internet pour créer ton compte et ouvrir un sujet la première fois. Avec le Premium, tu enregistres un sujet et sa correction sur ton téléphone, et tu les lis sans connexion.',
    },
    {
      q: 'Faut-il passer par le Play Store ?',
      a: 'Non. Exam237 s’installe depuis le navigateur, en ajoutant le site à l’écran d’accueil de ton téléphone. Les instructions sont dans ton profil, une fois connecté.',
    },
  ];

  return (
    <main className={`lp ${display.variable}`}>
      <header className="lp-bar">
        <a className="lp-brand" href="/bienvenue" aria-label="Exam237, accueil">
          <img src="/logo.png" alt="" width={36} height={36} />
          <span>Exam237</span>
        </a>
        <a className="lp-login" href="/connexion">
          Se connecter
        </a>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text">
          <h1>
            Prépare <span className="lp-nowrap">ton</span> <ExamWord words={words} />
            <span className="sr-only">{wordsSpoken.replace(/^ton /, '')}</span> avec les vrais
            sujets corrigés
          </h1>
          <p className="lp-lead">
            Les sujets des années passées et leurs corrections détaillées, dans une appli faite pour
            ton téléphone. Compose avec le chrono, pose tes questions à ta classe.
          </p>
          <div className="lp-ctas" id="lp-hero-cta">
            <a className="lp-btn lp-btn-sun lp-btn-big" href="/connexion?mode=register">
              Commencer gratuitement
            </a>
            <a className="lp-link" href="/connexion">
              J’ai déjà un compte
            </a>
          </div>
          <ul className="lp-promises">
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              Compte gratuit, sans engagement
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              Premium payé par MTN MoMo ou Orange Money
            </li>
            {whatsapp ? (
              <li>
                <Icon name="check" size={18} strokeWidth={2.6} />
                Une vraie personne te répond sur WhatsApp
              </li>
            ) : null}
          </ul>
        </div>
        <LandingDemo
          frames={DEMO}
          label="Démonstration d’Exam237 : on choisit Mathématiques, on ouvre le sujet, puis sa correction."
        />
      </section>

      {targets.length ? (
        <section className="lp-countband" aria-label="Compte à rebours">
          <ExamCountdown targets={targets} serverNow={now} />
        </section>
      ) : null}

      {showFresh ? (
        <section className="lp-fresh" aria-label="Sujets ajoutés récemment">
          <p className="lp-fresh-title">Ajoutés récemment</p>
          <div className="lp-fresh-track">
            <ul className="lp-fresh-list">
              {[...fresh, ...fresh].map((r, i) => (
                <li key={i} aria-hidden={i >= fresh.length ? true : undefined}>
                  <b>
                    {r.subject}
                    {r.exam ? `, ${r.exam}` : ''} {r.year}
                  </b>
                  <span>{ago(r.at, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {data.catalog.length ? (
        <section className="lp-section" id="sujets">
          <div className="lp-head">
            <h2>Les sujets déjà dans l’appli</h2>
            <p>
              Choisis ton examen et ta matière : voici les années disponibles aujourd’hui.
              {showFigures
                ? ` En tout, ${data.papers} sujets et ${data.corrections} corrections dans ${data.subjects} matières${
                    data.students >= 100
                      ? `, déjà utilisés par plus de ${Math.floor(data.students / 10) * 10} élèves`
                      : ''
                  }.`
                : ''}
            </p>
          </div>
          <SubjectExplorer catalog={data.catalog} />
        </section>
      ) : null}

      <section className="lp-section lp-copy-wrap">
        <div className="lp-copy">
          <h2>Comment ça marche</h2>
          <ol>
            <li>
              <b>Crée ton compte</b>
              <span>
                Ton nom, ton e-mail et ta classe. C’est gratuit, et c’est fait en une minute.
              </span>
            </li>
            <li>
              <b>Choisis ta matière et l’année</b>
              <span>
                Les sujets de ton examen sont rangés par matière, du plus récent au plus ancien.
              </span>
            </li>
            <li>
              <b>Compose, puis corrige-toi</b>
              <span>
                Lance le chrono comme le jour J, puis compare ta copie avec la correction.
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-head">
          <h2>Révise comme le jour de l’examen</h2>
          <p>Des écrans de l’application, avec un compte de démonstration.</p>
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
            {prices.length ? (
              <ul className="lp-prices">
                {prices.map(p => (
                  <li key={p.months} className={p.months === '3' ? 'best' : ''}>
                    <span>{p.label}</span>
                    <b>{p.price}</b>
                    {p.months === '3' ? <em>Conseillé</em> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lp-plan-price small">Les prix sont donnés sur WhatsApp</p>
            )}
            <ul>
              {premiumPerks.map(perk => (
                <li key={perk}>
                  <Icon name="check" size={18} strokeWidth={2.6} />
                  {perk}
                </li>
              ))}
            </ul>
            <p className="lp-pay">
              <Icon name="phone" size={18} />
              Paiement par MTN Mobile Money ou Orange Money, activation par WhatsApp.
            </p>
            <a className="lp-btn lp-btn-sun" href="/connexion?mode=register">
              Commencer, puis passer Premium
            </a>
          </article>
        </div>
      </section>

      <section className="lp-section" id="questions">
        <div className="lp-head">
          <h2>Tes questions</h2>
        </div>
        <div className="lp-faq">
          {faq.map(item => (
            <details key={item.q}>
              <summary>
                <span>{item.q}</span>
                <Icon name="down" size={20} />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
        {whatsapp ? (
          <p className="lp-ask">
            Une autre question ?{' '}
            <a href={whatsapp} target="_blank" rel="noopener">
              Écris-nous sur WhatsApp
            </a>
          </p>
        ) : null}
      </section>

      <section className="lp-final" id="lp-final">
        <h2>
          {targets.length ? 'Le jour J approche. Commence aujourd’hui.' : 'Commence aujourd’hui.'}
        </h2>
        <a className="lp-btn lp-btn-sun lp-btn-big" href="/connexion?mode=register">
          Commencer gratuitement
        </a>
        <a className="lp-link" href="/connexion">
          J’ai déjà un compte
        </a>
      </section>

      <footer className="lp-foot">
        <div className="lp-brand">
          <img src="/logo.png" alt="" width={28} height={28} />
          <span>Exam237</span>
        </div>
        <p>Fait au Cameroun, pour les élèves du BEPC, du Probatoire et du Bac.</p>
        <nav aria-label="Liens">
          <a href="/connexion?mode=register">Créer un compte</a>
          <a href="/connexion">Se connecter</a>
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noopener">
              WhatsApp
            </a>
          ) : null}
        </nav>
        <small>© {year} Exam237</small>
      </footer>

      <StickyActions whatsapp={whatsapp} />
    </main>
  );
}
