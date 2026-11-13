import type { Metadata } from 'next';
import { Icon } from '@/components/icons';
import { getSiteSettings, type SiteSettings } from '@/lib/settings';

// Page de présentation publique : ce que voit un élève qui découvre Exam237.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Exam237 · Sujets corrigés BEPC, Probatoire et Bac au Cameroun',
  description:
    'Les vrais sujets d’examen du Cameroun, corrigés et expliqués comme en classe. Chat de ta classe, vidéos, Prof IA et lecture hors ligne.',
  alternates: { canonical: '/bienvenue' },
};

const FEATURES = [
  {
    icon: 'book',
    title: 'Les vrais sujets d’examen',
    text: 'BEPC, Probatoire et Baccalauréat, rangés par matière et par année. Tu trouves ton sujet en deux touches.',
  },
  {
    icon: 'check',
    title: 'Des corrections expliquées',
    text: 'Chaque étape est détaillée comme en classe, et tu sais qui a relu la correction.',
  },
  {
    icon: 'video',
    title: 'Des vidéos de correction',
    text: 'Pour les exercices difficiles, regarde la méthode expliquée en vidéo.',
  },
  {
    icon: 'chat',
    title: 'Le chat de ta classe',
    text: 'Pose tes questions et entraide-toi avec les élèves de ton niveau, en direct. Le chat est surveillé.',
  },
  {
    icon: 'cap',
    title: 'Ton Prof IA privé',
    text: 'Envoie la photo d’un exercice : il te donne d’abord des indices pour que tu trouves toi-même.',
  },
  {
    icon: 'download',
    title: 'Même sans connexion',
    text: 'Enregistre tes sujets sur ton téléphone et révise partout, même sans forfait internet.',
  },
];

const STEPS = [
  {
    title: 'Crée ton compte gratuit',
    text: 'Ton nom, ton e-mail, ta classe : c’est prêt en moins d’une minute.',
  },
  {
    title: 'Essaie Exam237',
    text: 'Un sujet corrigé par matière et le chat de ta classe sont gratuits.',
  },
  {
    title: 'Passe Premium sur WhatsApp',
    text: 'Tu choisis ta formule, tu paies par MTN MoMo ou Orange Money, Exam237 active ton compte.',
  },
];

const PLAN_LABELS: Array<[keyof SiteSettings['prices'], string]> = [
  ['1', '1 mois'],
  ['3', '3 mois'],
  ['6', '6 mois'],
  ['12', '12 mois'],
];

async function loadPrices() {
  try {
    const settings = await getSiteSettings();
    return { prices: settings.prices, whatsapp: settings.whatsapp };
  } catch {
    return { prices: null, whatsapp: '' };
  }
}

export default async function Bienvenue() {
  const { prices, whatsapp } = await loadPrices();
  const pricedPlans = prices ? PLAN_LABELS.filter(([months]) => prices[months]) : [];
  const year = new Date().getFullYear();

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
              <span className="slogan">Sujets • Corrections • Réussite</span>
              <h1>Réussis ton examen avec les vrais sujets corrigés.</h1>
              <p>
                Exam237 réunit les anciens sujets du BEPC, du Probatoire et du Baccalauréat, avec
                des corrections expliquées comme en classe, le chat de ta classe et un Prof IA qui
                t’aide à comprendre.
              </p>
              <div className="ctas">
                <a className="btn btn-gold btn-lg" href="/connexion?mode=register">
                  Créer mon compte gratuit
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
            <img className="logo-big" src="/logo.png" alt="Logo Exam237" width={300} height={300} />
          </div>
        </div>
      </div>

      <section className="public-section public-wrap">
        <h2>Tout pour réviser, au même endroit</h2>
        <div className="features">
          {FEATURES.map(f => (
            <article key={f.title} className="card feature">
              <span className="ico">
                <Icon name={f.icon} size={22} />
              </span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section public-wrap">
        <h2>Comment ça marche</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card step">
              <span className="step-n">{i + 1}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="public-section public-wrap">
        <h2>Gratuit ou Premium</h2>
        <div className="compare">
          <article className="card">
            <span className="tag">Gratuit</span>
            <h3>Pour découvrir</h3>
            <ul className="ticks">
              <li>Le chat de ta classe</li>
              <li>Un sujet corrigé par matière</li>
              <li>Ta progression et tes favoris</li>
            </ul>
            <a className="btn btn-light" href="/connexion?mode=register">
              Commencer gratuitement
            </a>
          </article>
          <article className="card gold">
            <span className="tag gold">Premium</span>
            <h3>Pour réussir</h3>
            <ul className="ticks">
              <li>Tous les sujets et toutes les corrections</li>
              <li>Les vidéos de correction</li>
              <li>Le Prof IA, même avec une photo</li>
              <li>La lecture sans connexion</li>
              <li>Sans publicité</li>
            </ul>
            {pricedPlans.length ? (
              <div className="price-list">
                {pricedPlans.map(([months, label]) => (
                  <span key={months}>
                    <b>{label}</b> {prices![months]}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--gold-text)', fontWeight: 700 }}>
                Formules de 1, 3, 6 ou 12 mois. Prix sur WhatsApp.
              </p>
            )}
            <a className="btn btn-primary" href="/connexion?mode=register">
              Créer mon compte puis passer Premium
            </a>
          </article>
        </div>
        <p className="fine" style={{ marginTop: 12 }}>
          Paiement par MTN Mobile Money ou Orange Money. Pas de carte bancaire.
        </p>
      </section>

      <footer className="public-foot">
        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
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
              Nous écrire sur WhatsApp
            </a>
          ) : null}
        </div>
        © {year} Exam237 · Fait au Cameroun, pour les élèves du Cameroun.
      </footer>
    </main>
  );
}
