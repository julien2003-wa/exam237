import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { ensureSchema } from '@/lib/schema';
import { getSiteSettings, type SiteSettings } from '@/lib/settings';

// Page de présentation publique. Les chiffres viennent de la base (mis à jour toutes les 10 minutes).
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Exam237 : sujets corrigés du BEPC, du Probatoire et du Bac',
  description:
    'Les anciens sujets du BEPC, du Probatoire et du Bac avec leurs corrections, sur ton téléphone. Chat de classe, vidéos et Prof IA.',
  alternates: { canonical: '/bienvenue' },
};

const EXAMS: Record<string, string> = {
  BEPC: 'BEPC',
  PROBATOIRE: 'Probatoire',
  BAC: 'Bac',
  CAP: 'CAP',
  GCE: 'GCE',
};

const PLAN_LABELS: Array<[keyof SiteSettings['prices'], string]> = [
  ['1', '1 mois'],
  ['3', '3 mois'],
  ['6', '6 mois'],
  ['12', '12 mois'],
];

const SHOTS = [
  { src: '/apercu/annees.webp', text: 'Choisis ta matière, puis l’année.' },
  { src: '/apercu/sujet.webp', text: 'Ouvre le sujet, puis sa correction.' },
  { src: '/apercu/examen.webp', text: 'Ou compose avec le chrono, comme le jour de l’examen.' },
];

type Figures = {
  papers: number;
  corrections: number;
  subjects: number;
  firstYear: number | null;
  lastYear: number | null;
  exams: Array<{ exam: string; n: number }>;
};

async function loadPage() {
  let figures: Figures | null = null;
  let site: SiteSettings | null = null;
  try {
    await ensureSchema();
    const sql = db();
    const [totals, byExam] = await Promise.all([
      sql`SELECT COUNT(*)::int AS papers,COUNT(DISTINCT p.subject_id)::int AS subjects,
                 MIN(p.exam_year)::int AS first_year,MAX(p.exam_year)::int AS last_year,
                 (SELECT COUNT(*)::int FROM ex237_corrections cor JOIN ex237_papers pp ON pp.id=cor.paper_id
                  WHERE cor.status='published' AND pp.status='published') AS corrections
          FROM ex237_papers p WHERE p.status='published'`,
      sql`SELECT UPPER(COALESCE(g.exam_type,'AUTRE')) AS exam,COUNT(*)::int AS n
          FROM ex237_papers p JOIN ex237_classes c ON c.code=p.class_code
          LEFT JOIN ex237_groups g ON g.id=c.group_id
          WHERE p.status='published' GROUP BY 1 ORDER BY n DESC`,
    ]);
    const t: any = (totals as any[])[0] || {};
    figures = {
      papers: Number(t.papers) || 0,
      corrections: Number(t.corrections) || 0,
      subjects: Number(t.subjects) || 0,
      firstYear: t.first_year ? Number(t.first_year) : null,
      lastYear: t.last_year ? Number(t.last_year) : null,
      exams: (byExam as any[])
        .filter(r => EXAMS[r.exam])
        .map(r => ({ exam: EXAMS[r.exam], n: Number(r.n) || 0 })),
    };
  } catch {
    figures = null;
  }
  try {
    site = await getSiteSettings();
  } catch {
    site = null;
  }
  return { figures, site };
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export default async function Bienvenue() {
  const { figures, site } = await loadPage();
  const prices = site?.prices || null;
  const pricedPlans = prices ? PLAN_LABELS.filter(([months]) => prices[months]) : [];
  const whatsapp = site?.whatsapp || '';
  const year = new Date().getFullYear();
  const showFigures = !!figures && figures.papers >= 5;
  const examNames = figures?.exams.length
    ? figures.exams.map(e => e.exam)
    : ['BEPC', 'Probatoire', 'Bac'];
  const withDu = examNames.map(name => `du ${name}`);
  const examList =
    withDu.length > 1
      ? `${withDu.slice(0, -1).join(', ')} et ${withDu[withDu.length - 1]}`
      : withDu[0];

  return (
    <main className="public">
      <div className="public-top">
        <div className="public-wrap">
          <div className="public-bar">
            <img src="/logo.png" alt="" width={44} height={44} />
            <b>EXAM237</b>
            <a
              className="btn btn-sm"
              href="/connexion"
              style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}
            >
              Se connecter
            </a>
          </div>

          <div className="public-hero">
            <div className="stack" style={{ gap: 16 }}>
              <h1>Les anciens sujets {examList}, avec leurs corrections.</h1>
              <p>
                Révise sur ton téléphone, pose tes questions à ta classe et entraîne-toi avec le
                chrono avant le jour J.
              </p>
              <div className="ctas">
                <a className="btn btn-gold btn-lg" href="/connexion?mode=register">
                  Créer un compte gratuit
                </a>
                <a
                  className="btn btn-lg"
                  href="/connexion"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
                >
                  J’ai déjà un compte
                </a>
              </div>
            </div>
            <img
              className="hero-phone"
              src="/apercu/matieres.webp"
              alt="Écran des matières dans Exam237"
              width={540}
              height={1169}
            />
          </div>
        </div>
      </div>

      {showFigures ? (
        <section className="public-section public-wrap">
          <div className="figures">
            <div>
              <b>{figures!.papers}</b>
              <span>sujets</span>
            </div>
            <div>
              <b>{figures!.corrections}</b>
              <span>corrections</span>
            </div>
            <div>
              <b>{figures!.subjects}</b>
              <span>matières</span>
            </div>
            {figures!.firstYear && figures!.lastYear ? (
              <div>
                <b className="years">
                  {figures!.firstYear === figures!.lastYear
                    ? figures!.lastYear
                    : `${figures!.firstYear} à ${figures!.lastYear}`}
                </b>
                <span>{figures!.firstYear === figures!.lastYear ? 'année' : 'années'}</span>
              </div>
            ) : null}
          </div>
          {figures!.exams.length > 1 ? (
            <p className="figures-note">
              {figures!.exams.map(e => `${e.exam} : ${plural(e.n, 'sujet')}`).join(', ')}.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="public-section public-wrap">
        <h2>Dans l’application</h2>
        <div className="shots">
          {SHOTS.map(shot => (
            <figure key={shot.src} className="shot">
              <img src={shot.src} alt={shot.text} width={540} height={1169} loading="lazy" />
              <figcaption>{shot.text}</figcaption>
            </figure>
          ))}
        </div>
        <p className="public-text">
          Il y a aussi le chat de ta classe pour t’entraider avec les autres élèves, et le Prof IA
          quand tu bloques sur un exercice : il te donne des indices avant la solution.
        </p>
      </section>

      <section className="public-section public-wrap">
        <h2>Gratuit ou Premium</h2>
        <div className="offer">
          <article className="card">
            <h3>Gratuit</h3>
            <p>Le chat de ta classe et un sujet corrigé par matière, pour essayer.</p>
            <a className="btn btn-light" href="/connexion?mode=register">
              Créer un compte gratuit
            </a>
          </article>
          <article className="card gold">
            <h3>Premium</h3>
            <p>
              Tous les sujets et leurs corrections, les vidéos, le Prof IA, la lecture sans
              connexion, et aucune publicité.
            </p>
            {pricedPlans.length ? (
              <ul className="prices">
                {pricedPlans.map(([months, label]) => (
                  <li key={months}>
                    <span>{label}</span>
                    <b>{prices![months]}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Formules de 1, 3, 6 ou 12 mois. Les prix sont sur WhatsApp.</p>
            )}
            <p className="muted">
              Tu crées ton compte, tu écris à Exam237 sur WhatsApp depuis l’application, tu paies
              par MTN Mobile Money ou Orange Money, et ton Premium est activé.
            </p>
          </article>
        </div>
      </section>

      <footer className="public-foot">
        <div className="foot-links">
          <a className="text-link" href="/connexion">
            Se connecter
          </a>
          <a className="text-link" href="/connexion?mode=register">
            Créer un compte
          </a>
          {whatsapp ? (
            <a
              className="text-link"
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Écrire à Exam237 sur WhatsApp
            </a>
          ) : null}
        </div>
        © {year} Exam237. Fait au Cameroun.
      </footer>
    </main>
  );
}
