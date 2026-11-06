/**
 * USDC collateral on Polygon -- what a user's wallet is actually funded
 * with (docs/polymarket/knowledge_polymarket.md Phase 3/4).
 *
 * This is bridged USDC.e, not native (Circle-issued) USDC. Confirmed
 * directly from Polymarket's own published @polymarket/clob-client package
 * (dist/config.js, MATIC_CONTRACTS.collateral) rather than assumed --
 * an earlier version of this file guessed native USDC, which would have
 * shown a wrong (likely $0) balance for a properly-funded wallet.
 *
 * As of the CTF Exchange V2 migration, USDC.e itself is NOT what the
 * exchange settles in -- see PUSD_ADDRESS below.
 */
export const POLYGON_USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const POLYGON_USDC_DECIMALS = 6;

/**
 * pUSD -- the actual collateral token CTF Exchange V2 settles trades in
 * (docs.polymarket.com/concepts/pusd, docs.polymarket.com/resources/contracts).
 * A standard ERC-20 on Polygon, backed 1:1 by USDC and enforced onchain by
 * the CollateralOnramp/Offramp contracts below. A wallet's USDC.e balance is
 * NOT directly tradeable -- it must be wrapped into pUSD first via
 * CollateralOnramp.wrap(). Same 6 decimals as USDC.e.
 */
export const PUSD_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;
export const PUSD_DECIMALS = 6;

/** Wraps USDC.e -> pUSD. Requires approving this contract (not the pUSD token) to spend USDC.e first. */
export const COLLATERAL_ONRAMP_ADDRESS = "0x93070a847efEf7F70739046A929D47a521F5B8ee" as const;

/**
 * Polymarket's deployed Polygon mainnet contracts (docs.polymarket.com/resources/contracts).
 * These are the current "CTF Exchange" / "Neg Risk CTF Exchange" -- what the
 * clob-client-v2 package calls exchangeV2/negRiskExchangeV2 internally. The
 * older CTF Exchange V1 addresses (0x4bFb41d5.../0xC5d563A3...) settled in
 * USDC.e directly and are no longer what this app trades against.
 */
export const POLYMARKET_CONTRACTS = {
  exchangeV2: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRiskExchangeV2: "0xe2222d279d744050d28e00520010520000310F59",
  // Grouped/multi-outcome ("neg-risk") markets -- World Cup Winner, election
  // outcomes, anything with >2 mutually exclusive options -- route through
  // this adapter as an additional spender on top of negRiskExchangeV2. It
  // was defined here but never actually approved anywhere, so any neg-risk
  // order failed with "not enough balance / allowance" naming this address
  // as the spender even with a fully-funded, fully-approved-for-the-other-
  // two-contracts deposit wallet.
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  // NOT exchangeV3 (0xe3333700cA9d93003F00f0F71f8515005F6c00Aa): it's a real
  // contract per clob-client-v2's own config, but Polymarket's relayer
  // rejects it as an approval target with "not in the allowed list" -- confirmed
  // live, it broke the whole approval batch (one blocked call fails the batch,
  // not just that call). Was added here speculatively/pre-emptively; don't
  // re-add without confirming the relayer actually allows it.
} as const;
