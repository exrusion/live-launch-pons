"use client";

import { useState, type ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { robinhoodChain } from "@/lib/chain";

const walletConnectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

function appConfig(appUrl: string) {
  const origin = new URL(appUrl).origin;
  const connectors = [
    injected({ shimDisconnect: true }),
    ...(walletConnectId ? [walletConnect({
      projectId: walletConnectId,
      metadata: {
        name: "pons game studio",
        description: "Create and play token-powered games",
        url: origin,
        icons: [`${origin}/favicon.svg`],
      },
      showQrModal: true,
    })] : []),
  ];
  return createConfig({
    chains: [robinhoodChain],
    connectors,
    transports: { [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0]) },
    ssr: true,
  });
}

export function Providers({ children, appUrl }: { children: ReactNode; appUrl: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  const [wagmiConfig] = useState(() => appConfig(appUrl));
  return (
    <SessionProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </WagmiProvider>
    </SessionProvider>
  );
}
