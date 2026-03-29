/** رسوم تحويل الشبكة التقديرية (USDT) — تُعرض للمستخدم كشفافية */
export const NETWORK_TRANSFER_FEES_USD = {
  BEP20: 0.1,
  TRC20: 1,
  ERC20: 0.5,
};

/**
 * @param {string} network - TRC20 | ERC20 | BEP20
 * @returns {number}
 */
export function getNetworkTransferFeeUsd(network) {
  const k = String(network || '').toUpperCase();
  if (k in NETWORK_TRANSFER_FEES_USD) return NETWORK_TRANSFER_FEES_USD[k];
  return NETWORK_TRANSFER_FEES_USD.TRC20;
}
