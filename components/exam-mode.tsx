'use client';
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { readLocal, writeLocal, type Paper } from './lib';

const KEY = 'exam237-mode-examen';

type Run = { paperId: string; startedAt: number; minutes: number };

function format(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function ExamMode({
  paper,
  onClose,
  onDone,
  onOpenSheet,
}: {
  paper: Paper;
  onClose: () => void;
  onDone: () => void;
  onOpenSheet: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const minutes = paper.durationMinutes || 120;

  // Le chrono continue même si l'élève ouvre le PDF dans un autre onglet.
  useEffect(() => {
    const saved = readLocal<Run | null>(KEY, null);
    if (saved && saved.paperId === paper.id) setRun(saved);
  }, [paper.id]);

  useEffect(() => {
    if (!run || finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run, finished]);

  const left = run ? run.startedAt + run.minutes * 60000 - now : minutes * 60000;
  useEffect(() => {
    if (run && left <= 0 && !finished) {
      setFinished(true);
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {}
    }
  }, [left, run, finished]);

  const start = () => {
    const next = { paperId: paper.id, startedAt: Date.now(), minutes };
    writeLocal(KEY, next);
    setRun(next);
    setNow(Date.now());
    if (paper.paperUrl) window.open(paper.paperUrl, '_blank', 'noopener');
  };

  const stop = () => {
    writeLocal(KEY, null);
    setFinished(true);
  };

  const quit = () => {
    writeLocal(KEY, null);
    onClose();
  };

  return (
    <div className="exam-mode" role="dialog" aria-modal="true" aria-label="Mode examen">
      <h2>
        {paper.subjectName} {paper.year}
      </h2>
      {!run ? (
        <>
          <div className="timer">{format(minutes * 60000)}</div>
          <p>
            Compose comme le jour de l’examen : pas de cours, pas de téléphone. Le chrono démarre et
            le sujet s’ouvre. À la fin, compare avec la correction.
          </p>
          <div className="btns">
            <button type="button" className="btn btn-gold btn-lg" onClick={start}>
              <Icon name="clock" size={18} />
              Commencer
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: '#fff' }}
              onClick={quit}
            >
              Annuler
            </button>
          </div>
        </>
      ) : finished ? (
        <>
          <div className="timer low">{left <= 0 ? 'Terminé' : 'Bravo !'}</div>
          <p>
            Pose ton stylo. Compare maintenant ta copie avec la correction, question par question.
          </p>
          <div className="btns">
            <button
              type="button"
              className="btn btn-gold btn-lg"
              onClick={() => {
                writeLocal(KEY, null);
                onDone();
                onOpenSheet();
              }}
            >
              Voir la correction
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: '#fff' }}
              onClick={quit}
            >
              Fermer
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={`timer ${left < 10 * 60000 ? 'low' : ''}`} aria-live="off">
            {format(left)}
          </div>
          <p>Le chrono continue même si tu ouvres le sujet dans une autre fenêtre.</p>
          <div className="btns">
            <button
              type="button"
              className="btn btn-light btn-lg"
              onClick={() => paper.paperUrl && window.open(paper.paperUrl, '_blank', 'noopener')}
            >
              <Icon name="file" size={18} />
              Rouvrir le sujet
            </button>
            <button type="button" className="btn btn-gold btn-lg" onClick={stop}>
              J’ai fini
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: '#fff' }}
              onClick={quit}
            >
              Abandonner
            </button>
          </div>
        </>
      )}
    </div>
  );
}
