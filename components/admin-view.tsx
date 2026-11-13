'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { api, type Act, type Notify } from './admin/shared';
import Dashboard from './admin/dashboard';
import Students, { type StudentFilter } from './admin/students';
import Organisation from './admin/organisation';
import Contents from './admin/contents';
import Promos from './admin/promos';
import Reports from './admin/reports';
import Assistant from './admin/assistant';
import Settings from './admin/settings';

export type Pane =
  | 'dashboard'
  | 'students'
  | 'content'
  | 'promos'
  | 'classes'
  | 'reports'
  | 'assistant'
  | 'settings';

export default function AdminView({ notify }: { notify: Notify }) {
  const [data, setData] = useState<any>(null);
  const [pane, setPane] = useState<Pane>('dashboard');
  const [studentFilter, setStudentFilter] = useState<StudentFilter | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api('/api/data?action=admin'));
    } catch (e: any) {
      notifyRef.current(e.message, 'error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Renvoie la réponse du serveur en cas de succès, null en cas d'erreur (déjà affichée).
  const act: Act = useCallback(
    async (body, message = 'Opération effectuée.') => {
      try {
        const result = await api('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (message) notifyRef.current(message);
        await load();
        return result;
      } catch (e: any) {
        notifyRef.current(e.message, 'error');
        return null;
      }
    },
    [load]
  );

  if (!data) return <div className="adm-empty">Chargement de l’administration…</div>;
  const stats = data.stats || {};

  const openStudents = (filter: StudentFilter) => {
    setStudentFilter(filter);
    setPane('students');
  };

  const tabs: Array<{
    id: Pane;
    label: string;
    badge?: number;
    tone?: 'gold' | 'red';
    dot?: 'on' | 'warn';
  }> = [
    { id: 'dashboard', label: 'Tableau de bord' },
    { id: 'students', label: 'Élèves', badge: stats.expiring || 0, tone: 'gold' },
    { id: 'content', label: 'Sujets & corrections' },
    { id: 'promos', label: 'Vidéos promo' },
    { id: 'classes', label: 'Classes & groupes' },
    {
      id: 'reports',
      label: 'Signalements',
      badge: (stats.reports || 0) + (stats.contentReports || 0),
      tone: 'red',
    },
    { id: 'assistant', label: 'Assistant IA', dot: data.assistantConfigured ? 'on' : 'warn' },
    { id: 'settings', label: 'Réglages', dot: data.site?.whatsapp ? undefined : 'warn' },
  ];

  return (
    <section>
      <div className="adm-head">
        <div>
          <h2>Administration</h2>
        </div>
        <button
          className="btn btn-light btn-sm"
          onClick={load}
          disabled={refreshing}
          aria-label="Actualiser"
        >
          <Icon name="refresh" size={16} />
          <span className="adm-hide-mobile">{refreshing ? 'Actualisation…' : 'Actualiser'}</span>
        </button>
      </div>

      <div className="adm-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={pane === t.id}
            className={`adm-tab ${pane === t.id ? 'active' : ''}`}
            onClick={() => setPane(t.id)}
          >
            {t.dot ? <span className={`adm-dot ${t.dot}`} aria-hidden="true" /> : null}
            {t.label}
            {t.badge ? (
              <span className={`adm-count ${t.tone === 'gold' ? 'gold' : ''}`}>
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {pane === 'dashboard' ? (
        <Dashboard
          data={data}
          act={act}
          notify={notify}
          onStudents={openStudents}
          onPane={setPane}
        />
      ) : null}
      {pane === 'students' ? (
        <Students
          data={data}
          act={act}
          notify={notify}
          filter={studentFilter}
          onFilter={setStudentFilter}
        />
      ) : null}
      {pane === 'content' ? <Contents data={data} act={act} notify={notify} /> : null}
      {pane === 'promos' ? <Promos data={data} act={act} notify={notify} /> : null}
      {pane === 'classes' ? <Organisation data={data} act={act} /> : null}
      {pane === 'reports' ? <Reports act={act} onChanged={load} /> : null}
      {pane === 'assistant' ? <Assistant data={data} act={act} notify={notify} /> : null}
      {pane === 'settings' ? <Settings data={data} act={act} notify={notify} /> : null}
    </section>
  );
}
