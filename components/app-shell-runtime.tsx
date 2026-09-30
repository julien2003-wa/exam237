'use client';

import { useEffect } from 'react';

export default function AppShellRuntime(){
  useEffect(()=>{
    const root=document.documentElement;
    const body=document.body;
    const viewport=window.visualViewport;

    const sync=()=>{
      const visualHeight=viewport?.height||window.innerHeight;
      const visualTop=viewport?.offsetTop||0;
      const keyboardHeight=Math.max(
        0,
        window.innerHeight-visualHeight-visualTop
      );

      root.style.setProperty('--exam237-app-height',`${visualHeight}px`);
      root.style.setProperty('--exam237-app-top',`${visualTop}px`);

      body.classList.toggle(
        'exam237-keyboard-open',
        keyboardHeight>120
      );
    };

    body.classList.add('exam237-app-mode');
    sync();

    window.addEventListener('resize',sync);
    viewport?.addEventListener('resize',sync);
    viewport?.addEventListener('scroll',sync);

    return ()=>{
      window.removeEventListener('resize',sync);
      viewport?.removeEventListener('resize',sync);
      viewport?.removeEventListener('scroll',sync);

      body.classList.remove(
        'exam237-app-mode',
        'exam237-keyboard-open'
      );

      root.style.removeProperty('--exam237-app-height');
      root.style.removeProperty('--exam237-app-top');
    };
  },[]);

  return null;
}
