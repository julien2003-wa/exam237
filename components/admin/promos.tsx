'use client';

import { useState } from 'react';
import { Icon } from '../icons';
import {
  Badge,
  formatDate,
  MAX_VIDEO_MB,
  Progress,
  Section,
  uploadVideo,
  type Act,
  type Notify,
} from './shared';

/*
  Vidéos promo affichées en « statuts » en haut de l'accueil des élèves.
  - Exam237 : tes propres promos (nouveaux sujets, offre Premium…).
  - Partenaire : publicités ; jamais montrées aux membres Premium (« Premium sans pub »).
*/

type Draft = {
  kind: 'own' | 'partner';
  title: string;
  source: 'file' | 'youtube';
  youtubeUrl: string;
  ctaType: 'none' | 'premium' | 'whatsapp' | 'link';
  ctaLabel: string;
  ctaUrl: string;
  audience: 'all' | 'free';
  groupId: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY: Draft = {
  kind: 'own',
  title: '',
  source: 'file',
  youtubeUrl: '',
  ctaType: 'premium',
  ctaLabel: '',
  ctaUrl: '',
  audience: 'all',
  groupId: '',
  startsAt: '',
  endsAt: '',
};

const CTA_PLACEHOLDER: Record<Draft['ctaType'], string> = {
  none: '',
  premium: 'Passer Premium',
  whatsapp: 'Écrire sur WhatsApp',
  link: 'En savoir plus',
};

const day = (value: string | null | undefined) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

function draftOf(promo: any): Draft {
  return {
    kind: promo.kind === 'partner' ? 'partner' : 'own',
    title: promo.title || '',
    source: promo.video_path ? 'file' : 'youtube',
    youtubeUrl: promo.youtube_url || '',
    ctaType: ['none', 'premium', 'whatsapp', 'link'].includes(promo.cta_type)
      ? promo.cta_type
      : 'none',
    ctaLabel: promo.cta_label || '',
    ctaUrl: promo.cta_url || '',
    audience: promo.audience === 'free' ? 'free' : 'all',
    groupId: promo.group_id || '',
    startsAt: day(promo.starts_at),
    endsAt: day(promo.ends_at),
  };
}

function statusOf(promo: any): { label: string; tone: 'green' | 'gold' | 'grey' | 'red' | 'blue' } {
  const now = Date.now();
  if (!promo.active) return { label: 'Désactivée', tone: 'grey' };
  if (promo.ends_at && new Date(promo.ends_at).getTime() < now)
    return { label: 'Terminée', tone: 'red' };
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now)
    return { label: 'Programmée', tone: 'blue' };
  return { label: 'En ligne', tone: 'green' };
}

export default function Promos({ data, act, notify }: { data: any; act: Act; notify: Notify }) {
  const promos: any[] = data.promos || [];
  const groups: any[] = data.groups || [];
  const live = promos.filter(p => statusOf(p).label === 'En ligne').length;

  return (
    <div className="adm-stack">
      <p className="adm-note">
        Elles apparaissent en haut de l’accueil, comme les statuts WhatsApp, et ne se lancent que si
        l’élève les touche. Les vidéos <b>Partenaire</b> ne sont pas montrées aux membres Premium.
      </p>
      <PromoForm groups={groups} act={act} notify={notify} />
      <Section title="Vidéos" count={`${live} en ligne / ${promos.length}`}>
        <div className="adm-list">
          {promos.map((p, i) => (
            <PromoCard
              key={p.id}
              promo={p}
              groups={groups}
              first={i === 0}
              last={i === promos.length - 1}
              act={act}
              notify={notify}
            />
          ))}
          {!promos.length ? <div className="adm-empty">Aucune vidéo pour l’instant.</div> : null}
        </div>
      </Section>
    </div>
  );
}

function PromoFields({
  draft,
  setDraft,
  groups,
  file,
  setFile,
  progress,
  editing,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  groups: any[];
  file: File | null;
  setFile: (f: File | null) => void;
  progress: number | null;
  editing?: boolean;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className="adm-grid2">
      <div className="field full">
        <label>Type</label>
        <div className="adm-radio adm-radio-row">
          <label className={draft.kind === 'own' ? 'active' : ''}>
            <input
              type="radio"
              checked={draft.kind === 'own'}
              onChange={() => set({ kind: 'own' })}
            />
            <span>
              <b>Exam237</b>
              <small>Tes promos : nouveaux sujets, offre Premium…</small>
            </span>
          </label>
          <label className={draft.kind === 'partner' ? 'active' : ''}>
            <input
              type="radio"
              checked={draft.kind === 'partner'}
              onChange={() =>
                set({
                  kind: 'partner',
                  ctaType: draft.ctaType === 'premium' ? 'link' : draft.ctaType,
                })
              }
            />
            <span>
              <b>Partenaire</b>
              <small>Publicité d’une école, d’une librairie… Cachée aux membres Premium.</small>
            </span>
          </label>
        </div>
      </div>

      <div className="field full">
        <label>Titre affiché</label>
        <input
          className="input"
          value={draft.title}
          maxLength={80}
          onChange={e => set({ title: e.target.value })}
          placeholder="Ex. Nouveaux sujets du BEPC 2026"
        />
      </div>

      <div className="field full">
        <label>Vidéo</label>
        <div className="seg" style={{ maxWidth: 360 }}>
          <button
            type="button"
            aria-pressed={draft.source === 'file'}
            onClick={() => set({ source: 'file' })}
          >
            Fichier vidéo
          </button>
          <button
            type="button"
            aria-pressed={draft.source === 'youtube'}
            onClick={() => set({ source: 'youtube' })}
          >
            Lien YouTube
          </button>
        </div>
        {draft.source === 'file' ? (
          <>
            <input
              className="input"
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
            <small>
              {file
                ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} Mo`
                : editing
                  ? 'Laisse vide pour garder la vidéo actuelle.'
                  : `MP4 conseillé, format vertical, 15 à 30 secondes, ${MAX_VIDEO_MB} Mo maximum.`}
            </small>
            <Progress value={progress} />
          </>
        ) : (
          <>
            <input
              className="input"
              type="url"
              value={draft.youtubeUrl}
              onChange={e => set({ youtubeUrl: e.target.value })}
              placeholder="https://youtube.com/shorts/…"
            />
            <small>Vidéo YouTube ou YouTube Shorts (publique ou non répertoriée).</small>
          </>
        )}
      </div>

      <div className="field">
        <label>Bouton sous la vidéo</label>
        <select
          className="select"
          value={draft.ctaType}
          onChange={e => set({ ctaType: e.target.value as Draft['ctaType'] })}
        >
          <option value="none">Aucun bouton</option>
          {draft.kind === 'own' ? <option value="premium">Passer Premium</option> : null}
          <option value="whatsapp">Écrire à Exam237 sur WhatsApp</option>
          <option value="link">Ouvrir un lien</option>
        </select>
      </div>
      {draft.ctaType !== 'none' ? (
        <div className="field">
          <label>Texte du bouton</label>
          <input
            className="input"
            value={draft.ctaLabel}
            maxLength={40}
            onChange={e => set({ ctaLabel: e.target.value })}
            placeholder={CTA_PLACEHOLDER[draft.ctaType]}
          />
        </div>
      ) : (
        <div />
      )}
      {draft.ctaType === 'link' ? (
        <div className="field full">
          <label>Lien du bouton</label>
          <input
            className="input"
            type="url"
            value={draft.ctaUrl}
            onChange={e => set({ ctaUrl: e.target.value })}
            placeholder="https://…"
          />
        </div>
      ) : null}

      <div className="field">
        <label>Qui la voit ?</label>
        <select
          className="select"
          value={draft.audience}
          onChange={e => set({ audience: e.target.value as Draft['audience'] })}
        >
          <option value="all">
            {draft.kind === 'partner' ? 'Tous les comptes gratuits' : 'Tous les élèves'}
          </option>
          <option value="free">Seulement les comptes gratuits</option>
        </select>
      </div>
      <div className="field">
        <label>Groupe</label>
        <select
          className="select"
          value={draft.groupId}
          onChange={e => set({ groupId: e.target.value })}
        >
          <option value="">Tous les groupes</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Début (facultatif)</label>
        <input
          className="input"
          type="date"
          value={draft.startsAt}
          onChange={e => set({ startsAt: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Fin (facultatif)</label>
        <input
          className="input"
          type="date"
          value={draft.endsAt}
          onChange={e => set({ endsAt: e.target.value })}
        />
      </div>
    </div>
  );
}

function payload(draft: Draft, videoPath: string | null) {
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    videoPath: draft.source === 'file' ? videoPath : null,
    youtubeUrl: draft.source === 'youtube' ? draft.youtubeUrl.trim() : null,
    ctaType: draft.ctaType,
    ctaLabel:
      draft.ctaType === 'none' ? null : draft.ctaLabel.trim() || CTA_PLACEHOLDER[draft.ctaType],
    ctaUrl: draft.ctaType === 'link' ? draft.ctaUrl.trim() : null,
    audience: draft.audience,
    groupId: draft.groupId || null,
    startsAt: draft.startsAt || null,
    endsAt: draft.endsAt || null,
  };
}

function PromoForm({ groups, act, notify }: { groups: any[]; act: Act; notify: Notify }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const save = async () => {
    if (draft.title.trim().length < 2) return notify('Donne un titre à la vidéo.', 'error');
    if (draft.source === 'file' && !file) return notify('Choisis le fichier vidéo.', 'error');
    if (draft.source === 'youtube' && !draft.youtubeUrl.trim())
      return notify('Colle le lien YouTube.', 'error');
    setBusy(true);
    try {
      let videoPath: string | null = null;
      if (draft.source === 'file' && file) {
        setProgress(0);
        videoPath = await uploadVideo(file, setProgress);
      }
      const r = await act(
        { action: 'create_promo', ...payload(draft, videoPath) },
        'Vidéo publiée sur l’accueil.'
      );
      if (r) {
        setDraft(EMPTY);
        setFile(null);
        setFormKey(k => k + 1);
      }
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Section title="Ajouter une vidéo" defaultOpen={false}>
      <div className="adm-form" key={formKey}>
        <PromoFields
          draft={draft}
          setDraft={setDraft}
          groups={groups}
          file={file}
          setFile={setFile}
          progress={progress}
        />
        <div className="adm-form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy
              ? progress !== null
                ? `Envoi de la vidéo… ${progress} %`
                : 'Publication…'
              : 'Publier la vidéo'}
          </button>
        </div>
      </div>
    </Section>
  );
}

function PromoCard({
  promo,
  groups,
  first,
  last,
  act,
  notify,
}: {
  promo: any;
  groups: any[];
  first: boolean;
  last: boolean;
  act: Act;
  notify: Notify;
}) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(promo));
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const status = statusOf(promo);
  const group = groups.find(g => g.id === promo.group_id);
  const views = Number(promo.views || 0);
  const clicks = Number(promo.clicks || 0);

  const run = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    const r = await act(body, message);
    setBusy(false);
    return r;
  };

  const save = async () => {
    if (draft.title.trim().length < 2) return notify('Donne un titre à la vidéo.', 'error');
    if (draft.source === 'file' && !file && !promo.video_path)
      return notify('Choisis le fichier vidéo.', 'error');
    if (draft.source === 'youtube' && !draft.youtubeUrl.trim())
      return notify('Colle le lien YouTube.', 'error');
    setBusy(true);
    try {
      let videoPath: string | null = null;
      if (draft.source === 'file' && file) {
        setProgress(0);
        videoPath = await uploadVideo(file, setProgress);
      }
      const body = payload(draft, videoPath);
      // Fichier gardé tel quel : ni nouveau fichier, ni lien YouTube.
      if (draft.source === 'file' && !videoPath) body.youtubeUrl = null;
      const r = await act({ action: 'update_promo', id: promo.id, ...body }, 'Vidéo modifiée.');
      if (r) {
        setEditing(false);
        setFile(null);
      }
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <article className="adm-item">
      <div className="adm-item-head">
        <div className="adm-item-title">
          <b>{promo.title}</b>
          <span className="adm-sub">
            {promo.video_path ? 'Fichier vidéo' : 'YouTube'} ·{' '}
            {promo.audience === 'free' || promo.kind === 'partner'
              ? 'comptes gratuits'
              : 'tous les élèves'}{' '}
            · {group ? group.label : 'tous les groupes'}
          </span>
        </div>
        <div className="adm-badges">
          <Badge tone={promo.kind === 'partner' ? 'gold' : 'green'}>
            {promo.kind === 'partner' ? 'Partenaire' : 'Exam237'}
          </Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>
      <div className="adm-kv">
        <span>
          <b>{views}</b> vue{views > 1 ? 's' : ''}
        </span>
        <span>
          <b>{clicks}</b> clic{clicks > 1 ? 's' : ''}
          {views ? ` (${Math.round((clicks / views) * 100)} %)` : ''}
        </span>
        {promo.starts_at || promo.ends_at ? (
          <span>
            {promo.starts_at ? `du ${formatDate(promo.starts_at)} ` : ''}
            {promo.ends_at ? `au ${formatDate(promo.ends_at)}` : ''}
          </span>
        ) : null}
        {promo.cta_type && promo.cta_type !== 'none' ? (
          <span>
            Bouton : « {promo.cta_label || CTA_PLACEHOLDER[promo.cta_type as Draft['ctaType']]} »
          </span>
        ) : null}
      </div>

      {preview ? (
        <div className="adm-video">
          {promo.video_path ? (
            <video
              src={`/api/files?kind=promo&id=${encodeURIComponent(promo.id)}`}
              controls
              playsInline
              preload="metadata"
            />
          ) : promo.youtube_id ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${promo.youtube_id}?rel=0&playsinline=1`}
              title={promo.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <span className="adm-sub">Vidéo introuvable.</span>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="adm-inline">
          <PromoFields
            draft={draft}
            setDraft={setDraft}
            groups={groups}
            file={file}
            setFile={setFile}
            progress={progress}
            editing
          />
          <div className="adm-form-actions">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              className="btn btn-light btn-sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(draftOf(promo));
                setFile(null);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-actions">
          <button
            className="btn btn-light btn-sm"
            disabled={busy || first}
            aria-label="Monter"
            onClick={() => run({ action: 'move_promo', id: promo.id, direction: 'up' }, '')}
          >
            <Icon name="up" size={16} />
          </button>
          <button
            className="btn btn-light btn-sm"
            disabled={busy || last}
            aria-label="Descendre"
            onClick={() => run({ action: 'move_promo', id: promo.id, direction: 'down' }, '')}
          >
            <Icon name="down" size={16} />
          </button>
          <button className="btn btn-light btn-sm" onClick={() => setPreview(v => !v)}>
            {preview ? 'Masquer' : 'Aperçu'}
          </button>
          <button className="btn btn-light btn-sm" onClick={() => setEditing(true)}>
            Modifier
          </button>
          <button
            className="btn btn-light btn-sm"
            disabled={busy}
            onClick={() =>
              run(
                { action: 'set_promo_active', id: promo.id, active: !promo.active },
                promo.active ? 'Vidéo retirée de l’accueil.' : 'Vidéo remise sur l’accueil.'
              )
            }
          >
            {promo.active ? 'Désactiver' : 'Activer'}
          </button>
          <button
            className="btn btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              if (confirm(`Supprimer définitivement la vidéo « ${promo.title} » ?`))
                run({ action: 'delete_promo', id: promo.id }, 'Vidéo supprimée.');
            }}
          >
            Supprimer
          </button>
        </div>
      )}
    </article>
  );
}
