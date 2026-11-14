'use client';
import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/durations';
import { Icon } from './icons';
import { readLocal, writeLocal, type Paper } from './lib';

const KEY = 'exam237-mode-examen';
// Sans durée connue : 2 h, et l'élève règle selon la durée écrite en haut du sujet.
const DEFAULT_MINUTES = 120;
const STEP = 15;
const MAX_MINUTES = 360;

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
  onRead,
  onDone,
  onCorrection,
}: {
  paper: Paper;
  onClose: () => void;
  onRead: () => void;
  onDone: () => void;
  onCorrection: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const preset = paper.durationMinutes || null;
  const [minutes, setMinutes] = useState(preset || DEFAULT_MINUTES);
  useEffect(() => setMinutes(preset || DEFAULT_MINUTES), [paper.id, preset]);

  // Le chrono continue pendant que l'élève lit le sujet (il est gardé sur le téléphone).
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
    if (paper.paperUrl) onRead();
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
          <div className="exam-adjust" role="group" aria-label="Régler la durée">
            <button
              type="button"
              onClick={() => setMinutes(m => Math.max(STEP, m - STEP))}
              disabled={minutes <= STEP}
              aria-label="Retirer 15 minutes"
            >
              − 15 min
            </button>
            <button
              type="button"
              onClick={() => setMinutes(m => Math.min(MAX_MINUTES, m + STEP))}
              disabled={minutes >= MAX_MINUTES}
              aria-label="Ajouter 15 minutes"
            >
              + 15 min
            </button>
          </div>
          <p className="exam-duration" aria-live="polite">
            {!preset ? (
              <>
                Durée non indiquée : <b>2 h</b> par défaut. Vérifie la durée écrite en haut du
                sujet, puis règle le chrono.
              </>
            ) : minutes === preset ? (
              <>
                Durée de l’épreuve : <b>{formatDuration(preset)}</b>.
              </>
            ) : (
              <>
                Durée de l’épreuve : {formatDuration(preset)}. Tu as choisi{' '}
                <b>{formatDuration(minutes)}</b>.{' '}
                <button type="button" className="exam-reset" onClick={() => setMinutes(preset)}>
                  Remettre {formatDuration(preset)}
                </button>
              </>
            )}
          </p>
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
                onCorrection();
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
          <p>Le chrono continue pendant que tu lis le sujet.</p>
          <div className="btns">
            <button
              type="button"
              className="btn btn-light btn-lg"
              onClick={onRead}
              disabled={!paper.paperUrl}
            >
              <Icon name="file" size={18} />
              Lire le sujet
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
