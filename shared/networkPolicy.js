/**
 * Network minimums & display fees (USDT amounts). Synced with server validation.
 */
export const NETWORK_POLICY = {
  /** Shown on home / buy summary as general minimum line */
  displayMinUsdt: 5.5,
  minUsdtByNetwork: {
    BEP20: 10,
    ERC20: 10,
    TRC20: 5,
  },
  /** Approx. fee deducted from sent amount (network / tax line) */
  feeUsdtByNetwork: {
    BEP20: 0.1,
    ERC20: 0.5,
    TRC20: 1,
  },
};

export function minUsdtForNetwork(network, policy = NETWORK_POLICY) {
  const n = String(network || '').toUpperCase();
  const v = policy.minUsdtByNetwork[n];
  return typeof v === 'number' && Number.isFinite(v) ? v : 5;
}

export function feeUsdtForNetwork(network, policy = NETWORK_POLICY) {
  const n = String(network || '').toUpperCase();
  const v = policy.feeUsdtByNetwork[n];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
