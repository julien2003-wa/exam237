import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaBootstrap from '@/components/pwa-bootstrap';

export const metadata: Metadata = {
  title: 'Exam237',
  description: 'Sujets, corrections et révisions pour les examens du Cameroun.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Exam237'
  }
};

export const viewport: Viewport = {
  themeColor: '#064b3a',
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <PwaBootstrap />
        {children}
      </body>
    </html>
  );
}
