import type { Metadata } from 'next';
import { WalletProvider }  from '@/context/WalletContext';
import { ToastProvider }   from '@/context/ToastContext';
import { Navbar }          from '@/components/organisms/Navbar';
import '../styles/globals.css';

export const metadata: Metadata = {
  title:       'SoroProtocol — Payment Streaming on Stellar',
  description: 'Create, manage, and monitor real-time payment streams on Stellar.',
  openGraph: {
    title:       'SoroProtocol',
    description: 'Real-time payment streaming on Stellar',
    type:        'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <ToastProvider>
            <Navbar />
            {children}
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
