// Image d'une vidéo, comme la miniature d'un statut WhatsApp : une image prise au début de la
// vidéo, réduite et compressée (quelques dizaines de Ko). Marche avec un fichier choisi sur le
// téléphone, ou une vidéo déjà en ligne (seul le début est téléchargé). null si le navigateur
// ne sait pas lire la vidéo : le rond de l'accueil garde alors le logo.
export async function videoPoster(source: File | string, timeoutMs = 30000): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const video = document.createElement('video');
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const once = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        video.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        video.removeEventListener(event, done);
        reject(new Error('Vidéo illisible.'));
      };
      video.addEventListener(event, done, { once: true });
      video.addEventListener('error', fail, { once: true });
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const meta = once('loadeddata');
    video.src = url;
    await meta;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // Un peu après le début : la toute première image est souvent noire.
    const at = duration ? Math.min(1, duration / 3) : 0;
    if (at > 0) {
      const seeked = once('seeked');
      video.currentTime = at;
      await seeked;
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, 720 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  };
  try {
    return await Promise.race([
      work(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    video.removeAttribute('src');
    video.load();
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}
