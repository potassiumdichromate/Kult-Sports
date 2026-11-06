// Privy login for Kult Sports, configured like Creator Studio's
// (creator-studio-frontend-tg/src/lib/privyConfig.ts): Google, email or a
// wallet; every account gets an embedded EVM wallet on 0G Mainnet.
//
// The game is plain JavaScript, so this small React island is built
// separately (npm run build → public/privy/kult-privy.js) and exposes:
//
//   const privy = await init({ appId, clientId })
//   privy.authenticated        boolean, kept current
//   await privy.login()        opens the Privy modal; resolves when signed in
//   await privy.tokens()       { accessToken, identityToken }; the access token is
//                              exchanged for an AI Arena token (see server.mjs)
//   await privy.logout()
//   privy.wallet()             the player's EVM wallet for Polymarket on Polygon, or null:
//                              { address, getEthereumProvider(), sendTransaction(tx) }

import { createElement as h, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useLogin, useWallets, useSendTransaction, getAccessToken, getIdentityToken } from "@privy-io/react-auth";
import { defineChain } from "viem";
import { polygon } from "viem/chains";

const zeroGMainnet = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc.0g.ai"] } },
  blockExplorers: { default: { name: "0G Chainscan", url: "https://chainscan.0g.ai" } }
});

const WALLET_LIST = [
  "bitget_wallet", "okx_wallet", "metamask", "coinbase_wallet", "binance", "bybit_wallet", "kraken_wallet",
  "cryptocom", "uniswap", "rainbow", "zerion", "safe", "base_account", "robinhood_wallet", "universal_profile",
  "detected_ethereum_wallets", "wallet_connect"
];

const privyConfig = {
  loginMethods: ["google", "email", "wallet"],
  defaultChain: zeroGMainnet,
  // Polygon: Polymarket trading (deposit wallet, approvals, orders) runs there.
  supportedChains: [zeroGMainnet, polygon],
  embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
  appearance: {
    theme: "dark",
    accentColor: "#3B8BFF",
    landingHeader: "Sign in to Kult Sports",
    loginMessage: "Use your KULT account from AI Arena and Creator Studio.",
    showWalletLoginFirst: false,
    walletChainType: "ethereum-only",
    walletList: WALLET_LIST
  }
};

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

export function init({ appId, clientId }) {
  return new Promise((resolveReady) => {
    const api = { authenticated: false };
    let pendingLogin = null;
    let privyLogout = null;
    let openLogin = null;
    let currentWallet = null;
    let sendTx = null;

    function Bridge() {
      const { ready, authenticated, logout } = usePrivy();
      const { login } = useLogin({
        onComplete: () => { pendingLogin?.resolve(); pendingLogin = null; },
        onError: (error) => { pendingLogin?.reject(new Error(String(error || "closed"))); pendingLogin = null; }
      });
      const { wallets } = useWallets();
      const { sendTransaction } = useSendTransaction();
      currentWallet = wallets?.[0] || null;
      sendTx = sendTransaction;
      const announced = useRef(false);
      privyLogout = logout;
      openLogin = login;
      api.authenticated = authenticated;
      useEffect(() => {
        if (ready && !announced.current) { announced.current = true; resolveReady(api); }
      }, [ready]);
      return null;
    }

    api.login = () => {
      if (api.authenticated) return Promise.resolve();
      return new Promise((resolve, reject) => { pendingLogin = { resolve, reject }; openLogin(); });
    };
    api.tokens = async () => {
      const [accessToken, identityToken] = await Promise.all([
        withTimeout(getAccessToken(), 8000, "Privy access token"),
        withTimeout(getIdentityToken(), 8000, "Privy identity token")
      ]);
      if (!accessToken && !identityToken) throw new Error("Privy returned no session. Sign in again.");
      return { accessToken: accessToken || undefined, identityToken: identityToken || undefined };
    };
    api.logout = async () => { await privyLogout?.(); };
    api.wallet = () => {
      const w = currentWallet;
      if (!api.authenticated || !w?.address || typeof w.getEthereumProvider !== "function") return null;
      return {
        address: w.address,
        getEthereumProvider: () => w.getEthereumProvider(),
        sendTransaction: (tx) => sendTx(tx, { address: w.address, uiOptions: { showWalletUIs: true } })
      };
    };

    const host = document.createElement("div");
    host.id = "kult-privy-root";
    document.body.append(host);
    createRoot(host).render(h(PrivyProvider, { appId, clientId, config: privyConfig }, h(Bridge)));
  });
}
