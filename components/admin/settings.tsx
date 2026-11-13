'use client';

import { useMemo, useState } from 'react';
import { formatPhone as displayNumber, Section, type Act, type Notify } from './shared';

const PLANS: Array<[string, string]> = [
  ['1', '1 mois'],
  ['3', '3 mois'],
  ['6', '6 mois'],
  ['12', '12 mois'],
];

const EXAM_NAMES: Record<string, string> = {
  BEPC: 'BEPC',
  PROBATOIRE: 'Probatoire',
  BAC: 'Baccalauréat',
  CAP: 'CAP',
  GCE: 'GCE',
  AUTRE: 'Autre examen',
};

// Réglages du site : enregistrés dans la base (jamais dans le code, qui est public sur GitHub).
export default function Settings({ data, act, notify }: { data: any; act: Act; notify: Notify }) {
  const site = data.site || {};
  const [whatsapp, setWhatsapp] = useState(site.whatsapp ? displayNumber(site.whatsapp) : '');
  const [prices, setPrices] = useState<Record<string, string>>({
    '1': '',
    '3': '',
    '6': '',
    '12': '',
    ...(site.prices || {}),
  });
  const [examDates, setExamDates] = useState<Record<string, string>>({ ...(site.examDates || {}) });
  const [banned, setBanned] = useState<string>((site.bannedWords || []).join(', '));
  const [saving, setSaving] = useState(false);

  // Un compte à rebours par type d'examen présent dans les groupes (BEPC, PROBATOIRE, BAC…).
  const examTypes = useMemo(() => {
    const types = new Set<string>();
    for (const g of data.groups || [])
      if (g.exam_type) types.add(String(g.exam_type).toUpperCase());
    for (const t of Object.keys(site.examDates || {})) types.add(t);
    return [...types].filter(t => t !== 'AUTRE').sort();
  }, [data.groups, site.examDates]);

  const digits = whatsapp.replace(/\D+/g, '');
  const normalized = /^6\d{8}$/.test(digits)
    ? `237${digits}`
    : digits.startsWith('00')
      ? digits.slice(2)
      : digits;
  const validNumber = !digits || /^\d{10,15}$/.test(normalized);

  const save = async () => {
    if (!validNumber) return notify('Numéro WhatsApp invalide. Exemple : 6 77 12 34 56', 'error');
    setSaving(true);
    const r = await act(
      {
        action: 'save_site_settings',
        settings: { whatsapp: normalized, prices, examDates, bannedWords: banned },
      },
      'Réglages enregistrés.'
    );
    setSaving(false);
    if (r?.site) {
      setWhatsapp(r.site.whatsapp ? displayNumber(r.site.whatsapp) : '');
      setPrices({ '1': '', '3': '', '6': '', '12': '', ...(r.site.prices || {}) });
      setExamDates({ ...(r.site.examDates || {}) });
      setBanned((r.site.bannedWords || []).join(', '));
    }
  };

  return (
    <div className="adm-stack">
      <Section title="WhatsApp d’Exam237">
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Numéro qui reçoit les demandes Premium</label>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={e => setWhatsapp(e.target.value)}
            placeholder="6 77 12 34 56"
          />
          <small>
            {validNumber
              ? 'Numéro camerounais (6XX XX XX XX) ou international (+…). Les élèves t’écriront ici pour payer.'
              : 'Ce numéro ne semble pas valide.'}
          </small>
        </div>
        {normalized && validNumber ? (
          <div className="adm-form-actions">
            <a
              className="btn btn-light btn-sm"
              href={`https://wa.me/${normalized}?text=${encodeURIComponent('Test Exam237 : ce message arrive bien.')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Tester le lien WhatsApp
            </a>
          </div>
        ) : null}
      </Section>

      <Section title="Prix du Premium">
        <p className="adm-sub" style={{ margin: 0 }}>
          Écris le prix comme tu veux qu’il s’affiche (ex. « 1 500 FCFA »). Laisse vide pour
          afficher « Prix sur WhatsApp ».
        </p>
        <div className="adm-prices">
          {PLANS.map(([months, label]) => (
            <div className="field" key={months}>
              <label>{label}</label>
              <input
                className="input"
                value={prices[months] || ''}
                maxLength={40}
                onChange={e => setPrices(p => ({ ...p, [months]: e.target.value }))}
                placeholder="Ex. 2 000 FCFA"
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Dates des examens">
        <p className="adm-sub" style={{ margin: 0 }}>
          Affiche le compte à rebours « Jour J » sur l’accueil des élèves de chaque examen.
        </p>
        {examTypes.length ? (
          <div className="adm-prices">
            {examTypes.map(type => (
              <div className="field" key={type}>
                <label>{EXAM_NAMES[type] || type}</label>
                <input
                  className="input"
                  type="date"
                  value={examDates[type] || ''}
                  onChange={e =>
                    setExamDates(d => {
                      const next = { ...d };
                      if (e.target.value) next[type] = e.target.value;
                      else delete next[type];
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="adm-note warn">
            Ajoute d’abord des groupes avec leur type d’examen (onglet Classes & groupes).
          </p>
        )}
      </Section>

      <Section title="Mots interdits dans le chat" defaultOpen={false}>
        <p className="adm-sub" style={{ margin: 0 }}>
          En plus des insultes courantes déjà filtrées. Sépare les mots par des virgules. Les
          numéros de téléphone, les e-mails et les liens WhatsApp sont toujours masqués pour
          protéger les élèves.
        </p>
        <textarea
          className="textarea"
          rows={3}
          value={banned}
          onChange={e => setBanned(e.target.value)}
          placeholder="mot1, mot2, mot3"
        />
      </Section>

      <div className="adm-form-actions adm-sticky">
        <button className="btn btn-primary btn-lg" disabled={saving} onClick={save}>
          {saving ? 'Enregistrement…' : 'Enregistrer les réglages'}
        </button>
      </div>
    </div>
  );
}
