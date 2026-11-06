// Polymarket for Kult Sports: the old Kult browser's League Polymarket
// integration (app.kult.games/kult-games-v3: polymarketApi, the deposit
// wallet, CLOB trading, the bridge, withdrawals), bundled for the game's
// plain-JavaScript page (npm run build:polymarket → public/polymarket/).
//
// The page passes in the player's wallet (from the Privy island) and how to
// reach AI Arena; nothing here holds keys or custodies funds. Every step that
// moves money is a signature or transaction from the player's own wallet.

import { Side } from "@polymarket/clob-client-v2";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc1155Abi, erc20Abi, fallback, formatUnits, http, maxUint256, parseUnits } from "viem";
import { polygon } from "viem/chains";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  POLYGON_USDC_ADDRESS,
  POLYGON_USDC_DECIMALS,
  POLYMARKET_CONTRACTS,
  PUSD_ADDRESS,
  PUSD_DECIMALS,
} from "./lib/polygonUsdc";
import { clearCachedCreds, getBuilderCode, getClobClient, hasCachedCreds, setBuilderCode } from "./lib/polymarketClob";
import {
  deriveDepositWalletAddress,
  ensureDepositWalletDeployed,
  setRelayerSubmitter,
  signAndSubmitDepositWalletBatch,
  type DepositWalletCall,
} from "./lib/polymarketDepositWallet";

export * from "./lib/polymarketApi";
export { fetchFootballNews } from "./lib/footballNewsApi";
export { polymarketBridgeApi, addressTypeForChainId } from "./lib/polymarketBridgeApi";

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type Tx = { to: `0x${string}`; value: bigint; data?: `0x${string}`; chainId?: number };

/** The player's wallet, as the Privy island hands it over. */
export type PlayerWallet = {
  address: string;
  getEthereumProvider: () => Promise<Eip1193Provider>;
  /** Privy's sendTransaction (shows Privy's confirmation UI for embedded wallets). */
  sendTransaction: (tx: Tx) => Promise<unknown>;
};

export type TradingStatus = "idle" | "switching-network" | "deploying-wallet" | "wrapping" | "approving" | "deriving-key" | "placing-order" | "withdrawing" | "done";

// Public Polygon RPCs, tried in order (polygon-rpc.com, which the old browser
// used, now refuses requests without a key).
const POLYGON_RPCS = ["https://polygon.drpc.org", "https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"];
const publicClient = createPublicClient({ chain: polygon, transport: fallback(POLYGON_RPCS.map((url) => http(url))) });

const POLYGON = {
  hexChainId: "0x89",
  chainName: "Polygon",
  rpcUrls: POLYGON_RPCS.slice(0, 2),
  blockExplorerUrls: ["https://polygonscan.com"],
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
};

/** settings: the Builder Code (optional) and how to relay deposit-wallet payloads through AI Arena. */
export function configure(settings: {
  builderCode?: string | null;
  submitRelayer: (payload: Record<string, unknown>) => Promise<{ transactionID: string; state: string }>;
}): void {
  setBuilderCode(settings.builderCode);
  setRelayerSubmitter(settings.submitRelayer);
}

async function ensureOnPolygon(provider: Eip1193Provider): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === POLYGON.hexChainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: POLYGON.hexChainId }] });
    return;
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
  }
  await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: POLYGON.hexChainId, chainName: POLYGON.chainName, nativeCurrency: POLYGON.nativeCurrency, rpcUrls: POLYGON.rpcUrls, blockExplorerUrls: POLYGON.blockExplorerUrls }] });
}

// ---------------------------------------------------------------- balances

const depositWalletCache = new Map<string, Promise<`0x${string}`>>();
/** The player's Polymarket deposit wallet (CREATE2, so known before it is deployed). */
export function depositWalletFor(owner: string): Promise<`0x${string}`> {
  const key = owner.toLowerCase();
  if (!depositWalletCache.has(key)) {
    const p = deriveDepositWalletAddress(publicClient as never, owner as `0x${string}`);
    p.catch(() => depositWalletCache.delete(key));
    depositWalletCache.set(key, p);
  }
  return depositWalletCache.get(key)!;
}

/** "Your Polygon USDC" (USDC.e in the wallet) and "Tradeable (pUSD)" (in the deposit wallet). */
export async function balances(owner: string): Promise<{ usdc: number; pusd: number; depositWallet: string }> {
  const depositWallet = await depositWalletFor(owner);
  const [usdc, pusd] = await Promise.all([
    publicClient.readContract({ address: POLYGON_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] }),
    publicClient.readContract({ address: PUSD_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [depositWallet] }),
  ]);
  return { usdc: Number(formatUnits(usdc, POLYGON_USDC_DECIMALS)), pusd: Number(formatUnits(pusd, PUSD_DECIMALS)), depositWallet };
}

export { hasCachedCreds };

// ---------------------------------------------------------------- trading (ported from usePolymarketTrading)

const WRAP_ABI = [{ type: "function", name: "wrap", stateMutability: "nonpayable", inputs: [{ name: "_asset", type: "address" }, { name: "_to", type: "address" }, { name: "_amount", type: "uint256" }], outputs: [] }] as const;

// Every contract that can be an order's spender: both order books and the
// neg-risk adapter (grouped markets). Not exchangeV3: the relayer rejects it.
const APPROVAL_SPENDERS: readonly `0x${string}`[] = [
  POLYMARKET_CONTRACTS.exchangeV2,
  POLYMARKET_CONTRACTS.negRiskExchangeV2,
  POLYMARKET_CONTRACTS.negRiskAdapter,
];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Trading for one wallet. "Enable trading" runs before every order and only
 * prompts for what isn't done yet: switch to Polygon, deploy the deposit
 * wallet, wrap enough USDC.e into pUSD, approve the exchanges (one signed
 * batch), derive the CLOB key. Then one market buy.
 */
export function createTrader(wallet: PlayerWallet, onStatus: (s: TradingStatus) => void = () => {}) {
  const owner = wallet.address as `0x${string}`;

  async function ensurePusdWrapped(depositWallet: `0x${string}`, amountUsd: number, provider: Eip1193Provider) {
    const requiredRaw = parseUnits(amountUsd.toFixed(PUSD_DECIMALS), PUSD_DECIMALS);
    const currentPusd = await publicClient.readContract({ address: PUSD_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [depositWallet] });
    if (currentPusd >= requiredRaw) return;
    const shortfall = requiredRaw - currentPusd;
    const [ownerUsdc, depositWalletUsdc] = await Promise.all([
      publicClient.readContract({ address: POLYGON_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
      publicClient.readContract({ address: POLYGON_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [depositWallet] }),
    ]);

    // 1. From the player's own USDC.e: approve the onramp, then wrap straight into the deposit wallet.
    if (ownerUsdc >= shortfall) {
      onStatus("wrapping");
      const allowance = await publicClient.readContract({ address: POLYGON_USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [owner, COLLATERAL_ONRAMP_ADDRESS] });
      if (allowance < shortfall) {
        await wallet.sendTransaction({ to: POLYGON_USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [COLLATERAL_ONRAMP_ADDRESS, maxUint256] }), chainId: 137 });
      }
      await wallet.sendTransaction({ to: COLLATERAL_ONRAMP_ADDRESS, value: 0n, data: encodeFunctionData({ abi: WRAP_ABI, functionName: "wrap", args: [POLYGON_USDC_ADDRESS, depositWallet, shortfall] }), chainId: 137 });
      return;
    }

    // 2. USDC.e sent straight to the deposit wallet: only it can wrap it (a signed batch).
    if (depositWalletUsdc >= shortfall) {
      onStatus("wrapping");
      const allowance = await publicClient.readContract({ address: POLYGON_USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [depositWallet, COLLATERAL_ONRAMP_ADDRESS] });
      const calls: DepositWalletCall[] = [];
      if (allowance < shortfall) calls.push({ target: POLYGON_USDC_ADDRESS, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [COLLATERAL_ONRAMP_ADDRESS, maxUint256] }) });
      calls.push({ target: COLLATERAL_ONRAMP_ADDRESS, value: "0", data: encodeFunctionData({ abi: WRAP_ABI, functionName: "wrap", args: [POLYGON_USDC_ADDRESS, depositWallet, shortfall] }) });
      const walletClient = createWalletClient({ account: owner, chain: polygon, transport: custom(provider) });
      await signAndSubmitDepositWalletBatch(walletClient, owner, depositWallet, calls);
      return;
    }

    const usd = (raw: bigint) => (Number(raw) / 10 ** POLYGON_USDC_DECIMALS).toFixed(2);
    throw new Error(`Not enough USDC for this trade. Your wallet has $${usd(ownerUsdc)} and your Polymarket wallet has $${usd(depositWalletUsdc + currentPusd)}; this needs $${amountUsd}. Use "Fund wallet" so it arrives ready to trade.`);
  }

  async function ensureApprovals(depositWallet: `0x${string}`, provider: Eip1193Provider) {
    const checks = await Promise.all(APPROVAL_SPENDERS.flatMap((spender) => [
      publicClient.readContract({ address: PUSD_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [depositWallet, spender] }),
      publicClient.readContract({ address: POLYMARKET_CONTRACTS.conditionalTokens, abi: erc1155Abi, functionName: "isApprovedForAll", args: [depositWallet, spender] }),
    ]));
    const calls: DepositWalletCall[] = [];
    APPROVAL_SPENDERS.forEach((spender, i) => {
      if ((checks[i * 2] as bigint) === 0n) calls.push({ target: PUSD_ADDRESS, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] }) });
      if (!(checks[i * 2 + 1] as boolean)) calls.push({ target: POLYMARKET_CONTRACTS.conditionalTokens, value: "0", data: encodeFunctionData({ abi: erc1155Abi, functionName: "setApprovalForAll", args: [spender, true] }) });
    });
    if (calls.length === 0) return;
    onStatus("approving");
    const walletClient = createWalletClient({ account: owner, chain: polygon, transport: custom(provider) });
    await signAndSubmitDepositWalletBatch(walletClient, owner, depositWallet, calls);
  }

  async function ensureTradingEnabled(amountUsd: number) {
    onStatus("switching-network");
    const provider = await wallet.getEthereumProvider();
    await ensureOnPolygon(provider);
    onStatus("deploying-wallet");
    const depositWallet = await depositWalletFor(owner);
    await ensureDepositWalletDeployed(owner, depositWallet);
    await ensurePusdWrapped(depositWallet, amountUsd, provider);
    await ensureApprovals(depositWallet, provider);
    onStatus("deriving-key");
    await getClobClient(owner, provider, depositWallet);
    return { depositWallet, provider };
  }

  /** Buy `amountUsd` of one outcome token (YES or NO) at market. */
  async function placeMarketBuy(tokenId: string, amountUsd: number): Promise<{ orderId?: string }> {
    if (!(amountUsd > 0)) throw new Error("Enter a stake above $0.");
    try {
      const { depositWallet, provider } = await ensureTradingEnabled(amountUsd);
      onStatus("placing-order");
      const builderCode = getBuilderCode();
      const submit = async () => (await getClobClient(owner, provider, depositWallet)).createAndPostMarketOrder({
        tokenID: tokenId,
        amount: amountUsd,
        side: Side.BUY,
        ...(builderCode ? { builderCode } : {}),
      } as never);
      let result;
      try {
        result = await submit();
      } catch (orderErr) {
        // A cached CLOB key can go stale; drop it and retry once with a fresh one.
        clearCachedCreds(owner);
        try { result = await submit(); } catch { throw orderErr; }
      }
      onStatus("done");
      return result as { orderId?: string };
    } catch (err) {
      onStatus("idle");
      throw err;
    }
  }

  /** Send tradeable pUSD from the deposit wallet to any Polygon address (one signature). */
  async function withdraw(amountUsd: number, toAddress: string): Promise<{ transactionID: string; state: string }> {
    if (!ADDRESS_RE.test(toAddress)) throw new Error("Enter a valid Polygon address (0x…, 42 characters).");
    if (!(amountUsd > 0)) throw new Error("Enter an amount above $0.");
    try {
      onStatus("switching-network");
      const provider = await wallet.getEthereumProvider();
      await ensureOnPolygon(provider);
      const depositWallet = await depositWalletFor(owner);
      const amountRaw = parseUnits(amountUsd.toFixed(PUSD_DECIMALS), PUSD_DECIMALS);
      const current = await publicClient.readContract({ address: PUSD_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [depositWallet] });
      if (current < amountRaw) throw new Error(`Not enough tradeable pUSD to withdraw $${amountUsd}; you have $${(Number(current) / 10 ** PUSD_DECIMALS).toFixed(2)}.`);
      onStatus("withdrawing");
      const walletClient = createWalletClient({ account: owner, chain: polygon, transport: custom(provider) });
      const out = await signAndSubmitDepositWalletBatch(walletClient, owner, depositWallet, [
        { target: PUSD_ADDRESS, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [toAddress as `0x${string}`, amountRaw] }) },
      ]);
      onStatus("done");
      return out;
    } catch (err) {
      onStatus("idle");
      throw err;
    }
  }

  return { address: owner, placeMarketBuy, withdraw, isReady: () => hasCachedCreds(owner) };
}
