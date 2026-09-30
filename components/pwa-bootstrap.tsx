'use client';

import { useEffect } from 'react';

export default function PwaBootstrap(){
  useEffect(()=>{
    if(!('serviceWorker' in navigator)) return;

    let reloading=false;

    const onControllerChange=()=>{
      if(reloading) return;
      if(sessionStorage.getItem('exam237-sw-reloaded-v10')==='1') return;

      reloading=true;
      sessionStorage.setItem('exam237-sw-reloaded-v10','1');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    );

    navigator.serviceWorker
      .register('/sw.js',{updateViaCache:'none'})
      .then(registration=>registration.update())
      .catch(()=>{});

    return()=>{
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      );
    };
  },[]);

  return null;
}
