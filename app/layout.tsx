import type { Metadata } from 'next';
import { Inter, Great_Vibes, Space_Grotesk, Chakra_Petch } from 'next/font/google';
import './globals.css';

// Inter — admin console body font
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Great Vibes — participant name on the generated certificate
const greatVibes = Great_Vibes({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-great-vibes',
  display: 'swap',
});

// Space Grotesk + Chakra Petch — Hypervision brand fonts (public portal)
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const chakraPetch = Chakra_Petch({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-chakra-petch',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Launchpad Workshop · Hypervision',
  description:
    'Download your Certificate of Participation for the Hypervision Launchpad Workshop — UPES Hypervision.',
  keywords: ['Hypervision', 'Launchpad Workshop', 'UPES', 'Certificate', 'Workshop'],
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    title: 'Launchpad Workshop · Hypervision',
    description: 'Download your Certificate of Participation for the Hypervision Launchpad Workshop.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${greatVibes.variable} ${spaceGrotesk.variable} ${chakraPetch.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
