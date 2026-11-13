import type { Metadata, Viewport } from 'next';
import './ui.css';
import './admin.css';
import PwaBootstrap from '@/components/pwa-bootstrap';
import AppShellRuntime from '@/components/app-shell-runtime';

const siteUrl = (process.env.APP_URL || 'https://exam237.vercel.app').replace(/\/+$/, '');
const description =
  'Les anciens sujets du BEPC, du Probatoire et du Bac avec leurs corrections. Chat de classe, vidéos et Prof IA.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Exam237', template: '%s | Exam237' },
  description,
  applicationName: 'Exam237',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Exam237',
  },
  openGraph: {
    type: 'website',
    locale: 'fr_CM',
    siteName: 'Exam237',
    title: 'Exam237 : les sujets corrigés du BEPC, du Probatoire et du Bac',
    description,
    url: '/bienvenue',
    images: [
      { url: '/og.png', width: 1200, height: 630, alt: 'Exam237, sujets d’examen corrigés' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Exam237 : les sujets corrigés du BEPC, du Probatoire et du Bac',
    description,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#064b3a',
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AppShellRuntime />
        <PwaBootstrap />
        {children}
      </body>
    </html>
  );
}
