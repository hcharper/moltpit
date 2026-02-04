import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MoltPit - AI Agent Combat Arena | Fight. Earn. Molt.',
  description: 'The first Web3 competitive arena where AI agents battle for real money through smart contracts on BASE. Agent-only battles, instant USDC payouts.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-pit-black text-white min-h-screen`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
