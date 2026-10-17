// 金额统一按十万分之一元的整数计算，避免浮点误差；展示时才舍入到分。
export const MONEY_SCALE = 100000n;
export const ANNUAL_CAP = 100000n * MONEY_SCALE;
export const PULSE_HALF_YEAR_CAP = 80000n * MONEY_SCALE;
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

function bonusPool(gross, refunds, cap = ANNUAL_CAP) {
  // 退款扣回返现，但不释放按累计消费占用的额度；扣回金额不超过已赚取返现。
  const used = minimum(gross, cap);
  const beforeRefund = used * 2n / 100n;
  const clawback = minimum(beforeRefund, refunds * 2n / 100n);
  return { gross, cap, used, refunds, remaining: cap - used, overCap: nonnegative(gross - cap), beforeRefund, clawback, cashback: beforeRefund - clawback, progress: Number(used) / Number(cap) * 100 };
}

export function groupRewardCards(transactions, cards = []) {
  const groups = new Map();
  const register = card => {
    if (!groups.has(card.id)) groups.set(card.id, { ...card, records: [] });
    else if (card.currency === 'CNY') Object.assign(groups.get(card.id), card);
  };
  for (const card of cards) register(card);
  for (const transaction of transactions) {
    const id = transaction.rewardCardId || 'primary';
    if (!groups.has(id)) register({ id, type: transaction.cardType || 'primary', last4: transaction.last4 || '', name: transaction.cardName || '' });
    groups.get(id).records.push(transaction);
  }
  if (!groups.size) register({ id: 'primary', type: 'primary', last4: '', name: '' });
  return [...groups.values()].sort((a, b) => Number(a.type === 'supplementary') - Number(b.type === 'supplementary'));
}

export function calculateRewards(transactions, { today = hongKongToday(), hkdCnyRate = null, overrides = {} } = {}) {
  const start = `${today.slice(0, 4)}-01-01`;
  const july = `${today.slice(0, 4)}-07-01`;
  const halfIndex = today < july ? 0 : 1;
  const pulseSpend = [0n, 0n];
  let cnyGross = 0n, cnyRefunds = 0n, hkdGross = 0n, hkdRefunds = 0n;
  let pulseGross = 0n, worldRefunds = 0n, pulseRefunds = 0n;
  let included = 0, pending = 0, unknownChannels = 0, uncertainRefunds = 0, excluded = 0, otherCurrency = 0;
  for (const transaction of transactions) {
    if (!transaction.day || transaction.day < start || transaction.day > today) continue;
    if (!['CNY', 'HKD'].includes(transaction.currency)) { otherCurrency++; continue; }
    const override = overrides[transaction.id] || {};
    const channel = paymentChannel(transaction, override.channel);
    if (rewardExclusionReason(transaction) || channel.key === 'exclude') { excluded++; continue; }
    // 待确认交易保留在明细中，但不赚取或扣回返现，也不占用额度。
    // 手动确认支付方式不能替代银行入账状态。
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
      if (channel.pulse) {
        pulseGross += amount;
        pulseSpend[transaction.day < july ? 0 : 1] += amount;
      }
    }
  }
  const cnyBase = nonnegative(cnyGross - cnyRefunds) * 4n / 1000n;
  const hkdBase = nonnegative(hkdGross - hkdRefunds) * 4n / 1000n;
  const validRate = typeof hkdCnyRate === 'number' && Number.isFinite(hkdCnyRate) && hkdCnyRate > 0 && hkdCnyRate < 1000;
  const rate = validRate ? BigInt(Math.round(hkdCnyRate * Number(FX_SCALE))) : null;
  // 没有可靠汇率时保留 null，避免把无法折算的港币返现显示为零。
  const hkdConvertedCny = hkdBase === 0n ? 0n : rate ? (hkdBase * rate + FX_SCALE / 2n) / FX_SCALE : null;
  const baseTotal = hkdConvertedCny === null ? null : cnyBase + hkdConvertedCny;
  const world = bonusPool(cnyGross, worldRefunds);
  const periods = pulseSpend.map((gross, index) => ({
    ...bonusPool(gross, 0n, PULSE_HALF_YEAR_CAP),
    start: index ? july : start,
    end: `${today.slice(0, 4)}-${index ? '12-31' : '06-30'}`,
    label: index ? '下半年' : '上半年',
  }));
  const pulseBeforeRefund = periods.reduce((total, period) => total + period.beforeRefund, 0n);
  const pulseClawback = minimum(pulseBeforeRefund, pulseRefunds * 2n / 100n);
  // 全年返现累加两个独立封顶的半年；跨半年退款扣回全年返现，仍不释放任一半年额度。
  const pulse = { ...periods[halfIndex], periods, annualGross: pulseGross, refunds: pulseRefunds,
    beforeRefund: pulseBeforeRefund, clawback: pulseClawback, cashback: pulseBeforeRefund - pulseClawback,
    nextReset: halfIndex ? `${Number(today.slice(0, 4)) + 1}-01-01` : july };
  return { start, today, included, pending, excluded, otherCurrency, unknownChannels, uncertainRefunds,
    base: { cny: cnyBase, hkd: hkdBase, hkdConvertedCny, totalCny: baseTotal, cnyGross, cnyRefunds, hkdGross, hkdRefunds }, world, pulse,
    totalCny: baseTotal === null ? null : baseTotal + world.cashback + pulse.cashback };
}
