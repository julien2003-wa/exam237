'use client';

import { useEffect } from 'react';

// Enregistre l'application (fonctionne hors ligne, installable) et garde
// la proposition d'installation pour le bouton « Installer » du profil.
export default function PwaBootstrap() {
  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      (window as any).__exam237Install = event;
      window.dispatchEvent(new Event('exam237-install-ready'));
    };
    const onInstalled = () => {
      (window as any).__exam237Install = null;
      window.dispatchEvent(new Event('exam237-install-ready'));
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      if (sessionStorage.getItem('exam237-sw-reloaded-v11') === '1') return;
      reloading = true;
      sessionStorage.setItem('exam237-sw-reloaded-v11', '1');
      window.location.reload();
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then(registration => registration.update())
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if ('serviceWorker' in navigator)
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
