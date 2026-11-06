import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  RawContractError,
  concat,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  pad,
  toHex,
  zeroAddress,
  type PublicClient,
  type WalletClient,
} from "viem";

/**
 * Polymarket "deposit wallet" (docs.polymarket.com/trading/deposit-wallets) --
 * their CLOB now rejects orders signed directly by a plain EOA
 * ("maker address not allowed, please use the deposit wallet flow"). Every
 * order instead has to be made by a per-user smart-contract wallet that:
 *   - holds the tradeable pUSD balance (the EOA's own pUSD doesn't count),
 *   - is the order's `maker`/`funderAddress` (signatureType POLY_1271),
 *   - validates orders via EIP-1271, checking that the raw signature was
 *     produced by its owner EOA (the player's existing Privy wallet).
 *
 * This file:
 *   1. Derives the deterministic (CREATE2) deposit-wallet address for a
 *      given owner -- ported by hand from Polymarket's own
 *      @polymarket/builder-relayer-client@0.0.10 (dist/builder/derive.js),
 *      NOT imported from that package: its request-builder functions throw
 *      at runtime (`TransactionType` is missing from the package's compiled
 *      types.js -- reproduced directly, not a config issue on our end), so
 *      this file avoids depending on it at all and reimplements only the
 *      pure, verified-safe address-derivation math plus the small
 *      documented JSON payload shapes.
 *   2. Talks directly (no secret needed) to Polymarket's own public,
 *      unauthenticated relayer read endpoints (deploy-status, nonce).
 *   3. Builds + signs the WALLET-CREATE / WALLET (batch-execute) payloads
 *      using the player's own wallet, then posts them to OUR backend
 *      (POST /v1/polymarket/relayer/submit), which is the only thing
 *      holding the platform's Relayer API Key and forwards to Polymarket.
 */

const RELAYER_HOST = "https://relayer-v2.polymarket.com";
const CHAIN_ID = 137;

const DEPOSIT_WALLET_FACTORY = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07" as const;
const DEPOSIT_WALLET_IMPLEMENTATION = "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB" as const;

const FACTORY_BEACON_SELECTOR = "0x49493a4d" as const;

const DEPOSIT_WALLET_DOMAIN_NAME = "DepositWallet";
const DEPOSIT_WALLET_DOMAIN_VERSION = "1";

const DEPOSIT_WALLET_TYPES = {
  Call: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  Batch: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "calls", type: "Call[]" },
  ],
} as const;

export interface DepositWalletCall {
  target: `0x${string}`;
  value: string;
  data: `0x${string}`;
}

// ── CREATE2 derivation (ported from builder-relayer-client's derive.js) ────

const ERC1967_CONST1 = "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3" as const;
const ERC1967_CONST2 = "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076" as const;
const ERC1967_PREFIX = 0x61003d3d8160233d3973n;
const ERC1967_BEACON_CONST1 = "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3" as const;
const ERC1967_BEACON_CONST2 = "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c" as const;
const ERC1967_BEACON_CONST3 = "0x60195155f3363d3d373d3d363d602036600436635c60da" as const;
const ERC1967_BEACON_PREFIX = 0x6100523d8160233d3973n;

function initCodeHashERC1967(implementation: `0x${string}`, args: `0x${string}`): `0x${string}` {
  const n = BigInt((args.length - 2) / 2);
  const combined = ERC1967_PREFIX + (n << 56n);
  return keccak256(concat([toHex(combined, { size: 10 }), implementation, "0x6009", ERC1967_CONST2, ERC1967_CONST1, args]));
}

function initCodeHashERC1967Beacon(beacon: `0x${string}`, args: `0x${string}`): `0x${string}` {
  const n = BigInt((args.length - 2) / 2);
  const combined = ERC1967_BEACON_PREFIX + (n << 56n);
  return keccak256(concat([toHex(combined, { size: 10 }), beacon, ERC1967_BEACON_CONST3, ERC1967_BEACON_CONST2, ERC1967_BEACON_CONST1, args]));
}

function depositWalletArgs(owner: `0x${string}`, factory: `0x${string}`): `0x${string}` {
  const walletId = pad(owner, { dir: "left", size: 32 });
  return encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [factory, walletId]);
}

function deriveUupsDepositWallet(owner: `0x${string}`, factory: `0x${string}`, implementation: `0x${string}`): `0x${string}` {
  const args = depositWalletArgs(owner, factory);
  const salt = keccak256(args);
  const bytecodeHash = initCodeHashERC1967(implementation, args);
  return getCreate2Address({ from: factory, salt, bytecodeHash });
}

function deriveBeaconDepositWallet(owner: `0x${string}`, factory: `0x${string}`, beacon: `0x${string}`): `0x${string}` {
  const args = depositWalletArgs(owner, factory);
  const salt = keccak256(args);
  const bytecodeHash = initCodeHashERC1967Beacon(beacon, args);
  return getCreate2Address({ from: factory, salt, bytecodeHash });
}

function isContractRevertError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return (
    err.walk(
      (e) => e instanceof ContractFunctionRevertedError || e instanceof ExecutionRevertedError || (e instanceof RawContractError && e.code === 3),
    ) !== null
  );
}

/** Reads the factory's beacon address (0x0 if this factory only ever deploys UUPS clones, no beacon variant). */
async function getFactoryBeacon(publicClient: PublicClient, factory: `0x${string}`): Promise<`0x${string}`> {
  try {
    const data = await publicClient.call({ to: factory, data: FACTORY_BEACON_SELECTOR });
    if (!data.data || data.data.length < 66) return zeroAddress;
    return `0x${data.data.slice(-40)}` as `0x${string}`;
  } catch (err) {
    if (isContractRevertError(err)) return zeroAddress;
    throw err;
  }
}

async function isContractDeployed(publicClient: PublicClient, address: `0x${string}`): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return code !== undefined && code !== "0x";
}

/**
 * Derives the deterministic deposit-wallet address for `owner`. Matches
 * Polymarket's own RelayClient.deriveDepositWalletAddress() logic exactly:
 * UUPS clone unless the factory declares a beacon AND the UUPS address
 * itself isn't already deployed (this factory can produce either clone
 * shape; the UUPS address is preferred/checked first).
 */
export async function deriveDepositWalletAddress(publicClient: PublicClient, owner: `0x${string}`): Promise<`0x${string}`> {
  const uupsAddress = deriveUupsDepositWallet(owner, DEPOSIT_WALLET_FACTORY, DEPOSIT_WALLET_IMPLEMENTATION);
  const beacon = await getFactoryBeacon(publicClient, DEPOSIT_WALLET_FACTORY);
  if (beacon.toLowerCase() === zeroAddress) return uupsAddress;
  if (await isContractDeployed(publicClient, uupsAddress)) return uupsAddress;
  return deriveBeaconDepositWallet(owner, DEPOSIT_WALLET_FACTORY, beacon);
}

/** GET /deployed on Polymarket's relayer -- public, no auth needed (docs.polymarket.com/api-reference/relayer/check-if-a-wallet-is-deployed). */
export async function isDepositWalletDeployed(address: `0x${string}`): Promise<boolean> {
  const res = await fetch(`${RELAYER_HOST}/deployed?address=${address}&type=WALLET`);
  if (!res.ok) throw new Error(`Polymarket relayer /deployed failed (${res.status})`);
  const data = (await res.json()) as { deployed: boolean };
  return data.deployed;
}

/** GET /nonce on Polymarket's relayer -- public, no auth needed. Required before signing a WALLET batch. */
async function getWalletNonce(address: `0x${string}`): Promise<string> {
  const res = await fetch(`${RELAYER_HOST}/nonce?address=${address}&type=WALLET`);
  if (!res.ok) throw new Error(`Polymarket relayer /nonce failed (${res.status})`);
  const data = (await res.json()) as { nonce: string };
  return data.nonce;
}

/** Relays an already-built Polymarket relayer payload through our backend (which holds the Relayer API Key). */
// Kult Sports: the page's server forwards this to AI Arena's
// POST /v1/polymarket/relayer/submit with the player's AI Arena token (see
// server.mjs and setRelayerSubmitter in main.ts).
type RelayerSubmitter = (payload: Record<string, unknown>) => Promise<{ transactionID: string; state: string }>;
let relayerSubmitter: RelayerSubmitter | null = null;
export function setRelayerSubmitter(fn: RelayerSubmitter): void {
  relayerSubmitter = fn;
}
async function submitToRelayer(payload: Record<string, unknown>): Promise<{ transactionID: string; state: string }> {
  if (!relayerSubmitter) throw new Error("Polymarket trading isn't set up on this page.");
  return relayerSubmitter(payload);
}

/**
 * Deploys the deposit wallet for `owner` if it isn't already. Needs no
 * signature at all -- WALLET-CREATE is a pure "deploy this counterfactual
 * address" call keyed only by the owner's address, safe to call repeatedly.
 * `depositWalletAddress` must be the address already derived via
 * deriveDepositWalletAddress() -- that's what /deployed checks, not owner.
 *
 * Submitting to the relayer only means the deploy tx was ACCEPTED, not that
 * it's mined yet -- returning immediately let every caller downstream
 * (wrapping, approvals, and critically the order itself) run against a
 * deposit wallet that might not have on-chain code yet. Polymarket validates
 * an order's maker signature via that contract's EIP-1271 check, so a first
 * trade landing before deployment confirms would fail order validation
 * (surfaces as a 403 on POST /order, which the CLOB client's axios call then
 * reports as a generic cross-origin "Network Error" rather than the real
 * status). Poll /deployed after submitting until it's actually true.
 */
export async function ensureDepositWalletDeployed(owner: `0x${string}`, depositWalletAddress: `0x${string}`): Promise<void> {
  if (await isDepositWalletDeployed(depositWalletAddress)) return;
  await submitToRelayer({ type: "WALLET-CREATE", from: owner, to: DEPOSIT_WALLET_FACTORY });

  const POLL_INTERVAL_MS = 1500;
  const TIMEOUT_MS = 30_000;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await isDepositWalletDeployed(depositWalletAddress)) return;
  }
  throw new Error("Your Polymarket trading wallet is still deploying -- please try again in a moment.");
}

/**
 * Signs (via the player's own wallet -- free, no gas) and submits a batch of
 * calls to be executed BY the deposit wallet itself. Used for the token
 * approvals the deposit wallet needs to grant (it holds the pUSD, so only it
 * can approve the CTF Exchange V2 contracts to spend its own balance).
 */
export async function signAndSubmitDepositWalletBatch(
  walletClient: WalletClient,
  owner: `0x${string}`,
  depositWalletAddress: `0x${string}`,
  calls: DepositWalletCall[],
): Promise<{ transactionID: string; state: string }> {
  const nonce = await getWalletNonce(owner);
  const deadline = String(Math.floor(Date.now() / 1000) + 15 * 60);

  const signature = await walletClient.signTypedData({
    account: owner,
    domain: { name: DEPOSIT_WALLET_DOMAIN_NAME, version: DEPOSIT_WALLET_DOMAIN_VERSION, chainId: CHAIN_ID, verifyingContract: depositWalletAddress },
    types: DEPOSIT_WALLET_TYPES,
    primaryType: "Batch",
    message: {
      wallet: depositWalletAddress,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
      calls: calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data })),
    },
  });

  return submitToRelayer({
    type: "WALLET",
    from: owner,
    to: DEPOSIT_WALLET_FACTORY,
    nonce,
    signature,
    depositWalletParams: { depositWallet: depositWalletAddress, deadline, calls },
  });
}
