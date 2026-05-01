'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useProfileStore, effectiveRpcUrl } from '@/lib/profile-store';

import '@solana/wallet-adapter-react-ui/styles.css';

const FALLBACK_RPC = 'https://api.devnet.solana.com';

export function Providers({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useProfileStore();
  const endpoint = activeProfile ? effectiveRpcUrl(activeProfile) : FALLBACK_RPC;
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
