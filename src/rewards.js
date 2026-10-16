// Monetary values use integer units of 1/100000 CNY or HKD throughout.
export const MONEY_SCALE = 100000n;
export const ANNUAL_CAP = 80000n * MONEY_SCALE;
const FX_SCALE = 10000000000n;
const nonnegative = value => value > 0n ? value : 0n;
const minimum = (left, right) => left < right ? left : right;

export function moneyUnits(value) {
  if (!/^\d+(?:\.\d{1,5})?$/.test(String(value))) throw new Error('返现计算收到无效金额');
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(5, '0'));
}
export function rewardMoney(value) {
  const roundedCents = (nonnegative(value) + 500n) / 1000n;
  return `${roundedCents / 100n}.${String(roundedCents % 100n).padStart(2, '0')}`;
}
export function hongKongToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const CHANNELS = {
  standard: { label: '普通人民币消费', pulse: false, nominalRate: '2.4%' },
  applePay: { label: 'Apple Pay', pulse: true, nominalRate: '4.4%' },
  unionpayQr: { label: 'UnionPay QR', pulse: true, nominalRate: '4.4%' },
  exclude: { label: '不计返现', pulse: false, nominalRate: '0%' },
};
export function rewardExclusionReason(transaction) {
  if (!['CNY', 'HKD'].includes(transaction.currency)) return '当前返现规则不涵盖此币种';
  if (transaction.category === 'repayment') return '还款不计返现';
  if (transaction.category === 'fee') return '费用不计返现';
  if (/REWARDCASH|CASH\s*BACK|CASH\s*REBATE|回赠|回贈|返现|返現/i.test(transaction.description)) return '奖赏入账本身不作为消费或退款计算';
  return '';
}
export function paymentChannel(transaction, override = 'auto') {
  if (CHANNELS[override]) return { key: override, ...CHANNELS[override], manual: true, uncertain: false, reason: '已手动确认' };
  if (transaction.currency !== 'CNY') return { key: 'baseOnly', label: '港币基础返现', pulse: false, nominalRate: '0.4%', uncertain: false, reason: '港币消费仅计基础返现' };
  const text = `${transaction.description || ''}\n${transaction.notes?.join('\n') || ''}\n${transaction.rawLine || ''}`;
  if (/APPLE[\s-]*PAY/i.test(text)) return { key: 'applePay', ...CHANNELS.applePay, uncertain: false, reason: '结单文字包含 Apple Pay 标记' };
  if (/(?:UNION\s*PAY|银联|銀聯)/i.test(text) && /\bQR(?:\s*CODE)?\b|二维码|二維碼/i.test(text)) return { key: 'unionpayQr', ...CHANNELS.unionpayQr, uncertain: false, reason: '结单文字同时包含银联及 QR 标记' };
  const recognized = /TENPAY|ALIPAY|UNION\s*PAY/i.test(text);
  return { key: 'standard', ...CHANNELS.standard, uncertain: !recognized, reason: recognized ? '识别为普通钱包 / 银联消费，未见专属支付标记' : '未识别支付方式，待确认期间不计返现，也不占用年度额度' };
}

export function isPendingTransaction(transaction) {
  return ['pending', 'unposted', 'unconfirmed', 'authorized', 'authorised'].includes(String(transaction.status || '').toLowerCase());
}

export function rewardPendingReason(transaction, override = 'auto') {
  if (isPendingTransaction(transaction)) return '交易尚未确认入账，暂不计返现，也不占用年度额度';
  return paymentChannel(transaction, override).uncertain ? '支付方式待确认，暂不计返现，也不占用年度额度' : '';
}

function bonusPool(gross, refunds) {
  // A refund claws back the award but never restores the gross-spend allowance.
  const used = minimum(gross, ANNUAL_CAP);
  const beforeRefund = used * 2n / 100n;
  const clawback = minimum(beforeRefund, refunds * 2n / 100n);
  return { gross, used, refunds, remaining: ANNUAL_CAP - used, overCap: nonnegative(gross - ANNUAL_CAP), beforeRefund, clawback, cashback: beforeRefund - clawback, progress: Number(used) / Number(ANNUAL_CAP) * 100 };
}

export function calculateRewards(transactions, { today = hongKongToday(), hkdCnyRate = null, overrides = {} } = {}) {
  const start = `${today.slice(0, 4)}-01-01`;
  let cnyGross = 0n, cnyRefunds = 0n, hkdGross = 0n, hkdRefunds = 0n;
  let pulseGross = 0n, worldRefunds = 0n, pulseRefunds = 0n;
  let included = 0, pending = 0, unknownChannels = 0, uncertainRefunds = 0, excluded = 0, otherCurrency = 0;
  for (const transaction of transactions) {
    if (!transaction.day || transaction.day < start || transaction.day > today) continue;
    if (!['CNY', 'HKD'].includes(transaction.currency)) { otherCurrency++; continue; }
    const override = overrides[transaction.id] || {};
    const channel = paymentChannel(transaction, override.channel);
    if (rewardExclusionReason(transaction) || channel.key === 'exclude') { excluded++; continue; }
    // Pending records stay visible but cannot earn/claw back rewards or consume allowance.
    // A payment-channel override cannot confirm an unposted bank transaction.
    if (rewardPendingReason(transaction, override.channel)) {
      pending++;
      if (channel.uncertain && transaction.direction !== 'credit') unknownChannels++;
      continue;
    }
    const amount = moneyUnits(transaction.amount);
    const credit = transaction.direction === 'credit';
    included++;
    if (transaction.currency === 'HKD') {
      if (credit) hkdRefunds += amount; else hkdGross += amount;
      continue;
    }
    if (credit) {
      cnyRefunds += amount;
      if (!override.refundBaseOnly) {
        worldRefunds += amount;
        if (channel.pulse) pulseRefunds += amount;
        if (!channel.manual && !channel.pulse) uncertainRefunds++;
      }
    } else {
      cnyGross += amount;
      if (channel.pulse) pulseGross += amount;
    }
  }
  const cnyBase = nonnegative(cnyGross - cnyRefunds) * 4n / 1000n;
  const hkdBase = nonnegative(hkdGross - hkdRefunds) * 4n / 1000n;
  const validRate = typeof hkdCnyRate === 'number' && Number.isFinite(hkdCnyRate) && hkdCnyRate > 0 && hkdCnyRate < 1000;
  const rate = validRate ? BigInt(Math.round(hkdCnyRate * Number(FX_SCALE))) : null;
  const hkdConvertedCny = hkdBase === 0n ? 0n : rate ? (hkdBase * rate + FX_SCALE / 2n) / FX_SCALE : null;
  const baseTotal = hkdConvertedCny === null ? null : cnyBase + hkdConvertedCny;
  const world = bonusPool(cnyGross, worldRefunds);
  const pulse = bonusPool(pulseGross, pulseRefunds);
  return { start, today, included, pending, excluded, otherCurrency, unknownChannels, uncertainRefunds,
    base: { cny: cnyBase, hkd: hkdBase, hkdConvertedCny, totalCny: baseTotal, cnyGross, cnyRefunds, hkdGross, hkdRefunds }, world, pulse,
    totalCny: baseTotal === null ? null : baseTotal + world.cashback + pulse.cashback };
}
