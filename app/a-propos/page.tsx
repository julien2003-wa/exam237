import type { Metadata } from 'next';
import { assistantConfigured } from '@/lib/assistant';
import { examTargets, longDate, OFFICIAL_EXAM_PERIOD } from '@/lib/exams';
import { loadLandingData } from '@/lib/landing-data';
import { Icon } from '@/components/icons';
import {
  display,
  examsPhrase,
  faqItems,
  FinalCall,
  HowItWorks,
  LandingFooter,
  LandingHeader,
  nbsp,
  PremiumPerks,
  PriceList,
  whatsappLink,
} from '@/components/landing-parts';
import { StickyActions } from '@/components/landing';
import '../bienvenue/landing.css';

// Tout le détail retiré de la page d'accueil : fonctionnement, Premium, calendrier, questions.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'À propos',
  description:
    'Comment marche Exam237, le Premium et le paiement, le calendrier des examens officiels, la lecture sans connexion et les questions fréquentes.',
  alternates: { canonical: '/a-propos' },
};

export default async function APropos() {
  const data = await loadLandingData();
  const site = data.site;
  const exams = data.catalog.map(c => c.exam);
  const whatsapp = whatsappLink(site);
  const tutor = assistantConfigured();
  const exact = examTargets(site?.examDates || {}).filter(t => t.exact);
  const period = OFFICIAL_EXAM_PERIOD;

  const sections: Array<[string, string]> = [
    ['exam237', 'Exam237'],
    ['comment', 'Comment ça marche'],
    ['premium', 'Le Premium'],
    ['calendrier', 'Le calendrier des examens'],
    ['donnees', 'Données mobiles'],
    ['installer', 'Installer l’appli'],
    ['questions', 'Questions fréquentes'],
    ...(whatsapp ? ([['contact', 'Nous contacter']] as Array<[string, string]>) : []),
  ];

  return (
    <main className={`lp ${display.variable}`}>
      <LandingHeader current="about" />

      <section className="lp-about-hero" id="lp-hero-cta">
        <h1>À propos d’Exam237</h1>
        <p className="lp-lead">
          Comment ça marche, le Premium, le calendrier des examens et les réponses à tes questions.
        </p>
        <nav className="lp-toc" aria-label="Sommaire">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
      </section>

      <div className="lp-about">
        <section id="exam237">
          <h2>Exam237</h2>
          <p>
            Exam237 réunit les sujets des examens officiels {examsPhrase(exams)} des années passées,
            avec leurs corrections détaillées. Chaque élève peut s’entraîner sur son téléphone, à
            son rythme, même avec peu de données.
          </p>
          {data.papers >= 20 ? (
            <p>
              Aujourd’hui : {data.papers} sujets et {data.corrections} corrections dans{' '}
              {data.subjects} matières
              {data.students >= 100
                ? `, pour plus de ${Math.floor(data.students / 10) * 10} élèves inscrits`
                : ''}
              .
            </p>
          ) : null}
          <p>L’application est faite au Cameroun, pour les élèves du Cameroun.</p>
        </section>

        <section id="comment" className="lp-about-copy">
          <HowItWorks />
        </section>

        <section id="premium">
          <h2>Le Premium</h2>
          <p>
            Le compte gratuit donne un sujet corrigé dans chaque matière, le chat de ta classe et le
            mode examen. Le Premium débloque :
          </p>
          <div className="lp-plan lp-plan-premium lp-about-plan">
            <PremiumPerks tutor={tutor} />
            <PriceList site={site} />
          </div>
          <h3>Comment payer</h3>
          <ol className="lp-steps">
            {[
              'Crée ton compte gratuit.',
              'Dans l’appli, touche « Passer Premium » et choisis ta formule : WhatsApp s’ouvre avec ton message déjà rempli (ton nom, ta classe, la formule).',
              'Paie par MTN Mobile Money ou Orange Money, comme indiqué sur WhatsApp.',
              'Exam237 active ton Premium : tout se débloque sur ton compte.',
            ].map(step => (
              <li key={step}>{nbsp(step)}</li>
            ))}
          </ol>
          <p className="lp-note">Pas besoin de carte bancaire.</p>
        </section>

        <section id="calendrier">
          <h2>Le calendrier des examens</h2>
          {exact.length ? (
            <ul className="lp-dates">
              {exact.map(t => (
                <li key={t.title}>
                  <b>{t.title}</b>
                  <span>À partir du {longDate(t.date)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            D’après le calendrier de l’année scolaire {period.schoolYear} (arrêté conjoint du
            ministère de l’Éducation de base et du ministère des Enseignements secondaires, rendu
            public le {longDate(period.published, false)}) :
          </p>
          <ul className="lp-dates">
            <li>
              <b>Examens officiels du secondaire</b>
              <span>
                Du {longDate(period.start)} au {longDate(period.end)}
              </span>
            </li>
            <li>
              <b>Épreuves pratiques d’EPS</b>
              <span>
                Du {longDate(period.eps.start)} au {longDate(period.eps.end)}
              </span>
            </li>
          </ul>
          <p>
            Les dates exactes de chaque examen sont fixées plus tard : par l’Office du Baccalauréat
            du Cameroun pour le Bac et le Probatoire, par la DECC du Minesec pour le BEPC et le CAP,
            et par le GCE Board pour le GCE. Dès qu’elles sont publiées, le compte à rebours
            d’Exam237 les affiche.
          </p>
        </section>

        <section id="donnees">
          <h2>Données mobiles et lecture sans connexion</h2>
          <ul className="lp-checks">
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              La taille de chaque fichier est affichée avant que tu l’ouvres.
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              Le lecteur ne télécharge que les pages que tu regardes.
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              Dans ton profil, le réglage « Télécharger seulement en Wi-Fi » protège tes données
              mobiles.
            </li>
            <li>
              <Icon name="check" size={18} strokeWidth={2.6} />
              Avec le Premium, tu enregistres un sujet et sa correction sur ton téléphone, puis tu
              les lis sans internet.
            </li>
          </ul>
        </section>

        <section id="installer">
          <h2>Installer l’appli</h2>
          <p>
            Exam237 n’a pas besoin du Play Store : il s’installe depuis le navigateur, en quelques
            secondes.
          </p>
          <ul className="lp-dates">
            <li>
              <b>Android, avec Chrome</b>
              <span>
                Ouvre le site, touche le menu ⋮ en haut à droite, puis « Installer l’application »
                ou « Ajouter à l’écran d’accueil ».
              </span>
            </li>
            <li>
              <b>iPhone, avec Safari</b>
              <span>Touche le bouton Partager, puis « Sur l’écran d’accueil ».</span>
            </li>
          </ul>
          <p className="lp-note">
            Une fois connecté, ton profil te montre les étapes exactes pour ton téléphone.
          </p>
        </section>

        <section id="questions">
          <h2>Questions fréquentes</h2>
          <div className="lp-faq">
            {faqItems(exams).map(item => (
              <details key={item.q}>
                <summary>
                  <span>{item.q}</span>
                  <Icon name="down" size={20} />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {whatsapp ? (
          <section id="contact">
            <h2>Nous contacter</h2>
            <p>
              Une question sur ton compte, le Premium ou un sujet ? Écris-nous sur WhatsApp : une
              vraie personne te répond.
            </p>
            <a className="lp-btn lp-btn-forest" href={whatsapp} target="_blank" rel="noopener">
              <Icon name="chat" size={20} />
              Écrire sur WhatsApp
            </a>
          </section>
        ) : null}
      </div>

      <FinalCall title="Prêt à t’entraîner ? Commence aujourd’hui." />
      <LandingFooter whatsapp={whatsapp} />
      <StickyActions whatsapp={whatsapp} />
    </main>
  );
}
