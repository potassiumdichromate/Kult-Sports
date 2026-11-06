import { ClobClient, Chain, SignatureTypeV2, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { createWalletClient, custom } from "viem";
import { polygon } from "viem/chains";

const CLOB_HOST = "https://clob.polymarket.com";

/**
 * Builder Code (Polymarket's simplest attribution tier, a bare bytes32 code,
 * no key/secret/passphrase). Set via VITE_POLYMARKET_BUILDER_CODE.
 *
 * We use @polymarket/clob-client-v2 (not the older @polymarket/clob-client)
 * specifically because builderCode is only meaningful there: v2 serializes it
 * into the actual signed order's `builder` field (see Polymarket's Order
 * Attribution docs).
 */
// Kult Sports: set from the server's config.json (POLYMARKET_BUILDER_CODE) at init.
let POLYMARKET_BUILDER_CODE: string | undefined;
export function setBuilderCode(code: string | null | undefined): void {
  POLYMARKET_BUILDER_CODE = code || undefined;
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function credsStorageKey(address: string): string {
  return `kult_polymarket_clob_creds_v2_${address.toLowerCase()}`;
}

function loadCachedCreds(address: string): ApiKeyCreds | null {
  try {
    const raw = localStorage.getItem(credsStorageKey(address));
    return raw ? (JSON.parse(raw) as ApiKeyCreds) : null;
  } catch {
    return null;
  }
}

function saveCachedCreds(address: string, creds: ApiKeyCreds): void {
  localStorage.setItem(credsStorageKey(address), JSON.stringify(creds));
}

/** Whether this wallet has already derived a CLOB API key -- lets the UI skip re-showing "enable trading". */
export function hasCachedCreds(address: string): boolean {
  return loadCachedCreds(address) !== null;
}

/**
 * Drops a cached CLOB API key so the next getClobClient() call re-derives a
 * fresh one. Used when an order is rejected by Polymarket's server despite a
 * cached key existing locally -- e.g. a key derived before some account-side
 * change (deposit wallet re-derivation, a Polymarket-side key rotation) can
 * go stale and get rejected on /order even though everything upstream
 * (wrapping, approvals) succeeded.
 */
export function clearCachedCreds(address: string): void {
  localStorage.removeItem(credsStorageKey(address));
}

/** The wallet's cached CLOB API key creds, if already derived. */
export function getCachedCreds(address: string): ApiKeyCreds | null {
  return loadCachedCreds(address);
}

/** The Builder Code attached to every order this app places, if configured. */
export function getBuilderCode(): string | undefined {
  return POLYMARKET_BUILDER_CODE;
}

/**
 * Build a ClobClient wired to the user's own wallet as signer (docs/polymarket
 * §5 Phase 4). Derives (or reuses a cached) per-wallet L2 API key -- this is
 * the user's own credential, generated on the fly by one signature; nothing
 * is registered with Polymarket as a platform/company for this to work.
 * Never touches the user's private key directly: the viem WalletClient
 * signs through the wallet's own provider (Privy's getEthereumProvider()).
 *
 * `funderAddress` is the player's deposit wallet (see
 * polymarketDepositWallet.ts) -- Polymarket's CLOB now rejects orders where
 * the maker is a plain EOA ("maker address not allowed, please use the
 * deposit wallet flow"), so every order has to be made by that
 * smart-contract wallet instead (signatureType POLY_1271, EIP-1271
 * validated). The API key itself is still derived against the EOA, not the
 * deposit wallet -- confirmed from docs.polymarket.com/trading/deposit-wallets.
 */
export async function getClobClient(address: string, provider: Eip1193Provider, funderAddress: string): Promise<ClobClient> {
  const walletClient = createWalletClient({
    account: address as `0x${string}`,
    chain: polygon,
    transport: custom(provider),
  });

  const clientOpts = {
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer: walletClient,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress,
    // throwOnError is required: by default the SDK returns API failures as a
    // normal resolved { error, status } object instead of throwing, which
    // meant a rejected/unfilled order looked identical to a successful one to
    // every caller here -- a real order silently failed to execute once
    // ("YES ORDER PLACED" shown, zero trades/positions ever appeared on
    // Polymarket, pUSD balance never moved) before this was caught and fixed.
    throwOnError: true,
  } as const;

  const cached = loadCachedCreds(address);
  if (cached) {
    return new ClobClient({ ...clientOpts, creds: cached });
  }

  const bootstrapClient = new ClobClient(clientOpts);
  // NOT bootstrapClient.createOrDeriveApiKey(): that SDK method's own
  // create-then-fall-back-to-derive logic only fires when create() RESOLVES
  // with an empty key -- but throwOnError above makes a failed create()
  // THROW instead ("Could not create api key", the literal message
  // Polymarket's server sends back when a key already exists for this
  // wallet), so the built-in fallback to fetch the existing key never runs.
  // Replicate the intended behavior manually: try create, fall back to
  // derive on any failure.
  let creds: ApiKeyCreds;
  try {
    creds = await bootstrapClient.createApiKey();
    if (!creds.key) throw new Error('empty key from createApiKey');
  } catch {
    creds = await bootstrapClient.deriveApiKey();
  }
  saveCachedCreds(address, creds);
  return new ClobClient({ ...clientOpts, creds });
}
