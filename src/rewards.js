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
const transactionText = transaction => `${transaction.description || ''}\n${transaction.notes?.join('\n') || ''}`;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryAliases = { CHN: 'CN', '156': 'CN', HKG: 'HK', '344': 'HK', MAC: 'MO', '446': 'MO', JPN: 'JP', '392': 'JP', USA: 'US', '840': 'US', GBR: 'GB', SGP: 'SG', KOR: 'KR', THA: 'TH', TWN: 'TW', AUS: 'AU', CAN: 'CA', FRA: 'FR', DEU: 'DE', MYS: 'MY', NZL: 'NZ', ITA: 'IT', ESP: 'ES', PRT: 'PT', CHE: 'CH', AUT: 'AT', NLD: 'NL', BEL: 'BE', IRL: 'IE', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', GRC: 'GR', TUR: 'TR', ARE: 'AE', IDN: 'ID', VNM: 'VN', PHL: 'PH', IND: 'IN', ZAF: 'ZA', BRA: 'BR', MEX: 'MX' };
function countryRegion(code) {
  const country = countryAliases[code] || code;
  if (!/^[A-Z]{2}$/.test(country) || regionNames.of(country) === country) return '';
  return country === 'HK' ? 'hongKong' : country === 'CN' ? 'mainland' : country === 'MO' ? 'macau' : 'overseas';
}
export function worldEligibility(transaction, override = {}) {
  const text = transactionText(transaction);
  // 优先使用明确的商户国家代码；描述只读取末尾地区代码，不用钱包名称推断地区。
  const explicitCountry = String(transaction.merchantCountryCode || '').trim().toUpperCase();
  const country = explicitCountry || text.match(/\bMERCHANT\s+COUNTRY(?:\s+CODE)?\s*[:=]\s*([A-Z]{2,3}|\d{3})\b/i)?.[1]?.toUpperCase()
    || text.split('\n').map(line => line.trim().toUpperCase().match(/\b([A-Z]{2,3})$/)?.[1]).find(code => countryRegion(code)) || '';
  const region = ['hongKong', 'mainland', 'macau', 'overseas'].includes(override.merchantRegion) ? override.merchantRegion : countryRegion(country);
  // 双币结单的 currency 为入账币种；海外外币可能已折算为 HKD。
  const originalCurrency = (override.originalCurrency || transaction.originalCurrency || text.match(/\b(?:ORIGINAL\s+(?:TRANSACTION\s+)?CURRENCY|TRANSACTION\s+CURRENCY)\s*[:=]?\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase()
    || text.match(/\b(USD|EUR|GBP|JPY|MOP|CNY|RMB|HKD|AUD|CAD|SGD|THB|KRW|TWD|MYR)\s+[\d,]+\.\d{2}\b/)?.[1]
    || (transaction.currency !== 'HKD' ? transaction.currency : '')).toUpperCase();
  const foreign = originalCurrency && originalCurrency !== 'HKD';
  const eligible = region === 'hongKong' || originalCurrency === 'HKD' ? false : !region || !originalCurrency ? null : !!foreign;
  const reason = eligible === true ? '香港以外商户的外币交易，计入赏世界 5x' : eligible === false ? '香港商户或原交易为港币，不计赏世界' : '商户地区或原交易币种待确认，暂不计赏世界';
  return { region, originalCurrency, eligible, reason };
}
export function rewardExclusionReason(transaction) {
  if (!['CNY', 'HKD'].includes(transaction.currency)) return '当前返现规则不涵盖此币种';
  if (transaction.category === 'repayment') return '还款不计返现';
  if (transaction.category === 'fee') return '费用不计返现';
  if (/REWARDCASH|CASH\s*BACK|CASH\s*REBATE|回赠|回贈|返现|返現/i.test(transaction.description)) return '奖赏入账本身不作为消费或退款计算';
  return '';
}
function detectPaymentChannel(transaction, override = 'auto') {
  if (CHANNELS[override]) return { key: override, ...CHANNELS[override], manual: true, uncertain: false, reason: '已手动确认' };
  if (transaction.currency !== 'CNY') return { key: 'baseOnly', label: '港币基础返现', pulse: false, nominalRate: '0.4%', uncertain: false, reason: '港币子账户入账金额按公开参考汇率折合人民币' };
  const text = `${transaction.description || ''}\n${transaction.notes?.join('\n') || ''}\n${transaction.rawLine || ''}`;
  if (/APPLE[\s-]*PAY/i.test(text)) return { key: 'applePay', ...CHANNELS.applePay, uncertain: false, reason: '结单文字包含 Apple Pay 标记' };
  if (/(?:UNION\s*PAY|银联|銀聯)/i.test(text) && /\bQR(?:\s*CODE)?\b|二维码|二維碼/i.test(text)) return { key: 'unionpayQr', ...CHANNELS.unionpayQr, uncertain: false, reason: '结单文字同时包含银联及 QR 标记' };
  const recognized = /TENPAY|ALIPAY|UNION\s*PAY/i.test(text);
  return { key: 'standard', ...CHANNELS.standard, uncertain: !recognized, reason: recognized ? '识别为普通钱包 / 银联消费，未见专属支付标记' : '支付方式未识别，已按普通消费计入基础返现及符合条件的赏世界奖赏，未计 PULSE 专属奖赏' };
}

export function paymentChannel(transaction, override = 'auto', details = {}) {
  const channel = detectPaymentChannel(transaction, override);
  const world = worldEligibility(transaction, details);
  const pulse = channel.pulse && transaction.currency === 'CNY' && ['mainland', 'macau'].includes(world.region) && world.eligible === true;
  const nominalRate = channel.key === 'exclude' ? '0%' : `${0.4 + (world.eligible ? 2 : 0) + (pulse ? 2 : 0)}%`;
  return { ...channel, pulse, world, nominalRate,
    label: channel.key !== 'exclude' && transaction.currency === 'HKD' && world.eligible ? '海外外币消费' : channel.label };
}

export function isPendingTransaction(transaction) {
  return ['pending', 'unposted', 'unconfirmed', 'authorized', 'authorised'].includes(String(transaction.status || '').toLowerCase());
}

export function rewardPendingReason(transaction) {
  if (isPendingTransaction(transaction)) return '交易尚未确认入账，暂不计返现，也不占用年度额度';
  return '';
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
  let pulseGross = 0n, worldGross = 0n, worldRefunds = 0n, pulseRefunds = 0n;
  let worldPending = 0, worldConversionPending = 0;
  const validRate = typeof hkdCnyRate === 'number' && Number.isFinite(hkdCnyRate) && hkdCnyRate > 0 && hkdCnyRate < 1000;
  const rate = validRate ? BigInt(Math.round(hkdCnyRate * Number(FX_SCALE))) : null;
  const toCny = amount => rate ? (amount * rate + FX_SCALE / 2n) / FX_SCALE : null;
  let included = 0, pending = 0, unknownChannels = 0, uncertainRefunds = 0, excluded = 0, otherCurrency = 0;
  for (const transaction of transactions) {
    if (!transaction.day || transaction.day < start || transaction.day > today) continue;
    if (!['CNY', 'HKD'].includes(transaction.currency)) { otherCurrency++; continue; }
    const override = overrides[transaction.id] || {};
    const channel = paymentChannel(transaction, override.channel, override);
    if (rewardExclusionReason(transaction) || channel.key === 'exclude') { excluded++; continue; }
    // 尚未入账的交易不赚取或扣回返现，也不占用额度。
    // 仅支付方式未识别时按普通消费计算，不自动套用 PULSE 专属奖赏。
    // 手动确认支付方式不能替代银行入账状态。
    if (rewardPendingReason(transaction)) {
      pending++;
      continue;
    }
    if (channel.uncertain && transaction.direction !== 'credit') unknownChannels++;
    const amount = moneyUnits(transaction.amount);
    const credit = transaction.direction === 'credit';
    included++;
    if (channel.world.eligible === null) worldPending++;
    if (channel.world.eligible && (!credit || !override.refundBaseOnly)) {
      const worldAmount = transaction.currency === 'HKD' ? toCny(amount) : amount;
      if (worldAmount === null) worldConversionPending++;
      else if (credit) worldRefunds += worldAmount;
      else worldGross += worldAmount;
    }
    if (transaction.currency === 'HKD') {
      if (credit) hkdRefunds += amount; else hkdGross += amount;
      continue;
    }
    if (credit) {
      cnyRefunds += amount;
      if (!override.refundBaseOnly) {
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
  // 没有可靠汇率时保留 null，避免把无法折算的港币返现显示为零。
  const hkdConvertedCny = hkdBase === 0n ? 0n : rate ? (hkdBase * rate + FX_SCALE / 2n) / FX_SCALE : null;
  const baseTotal = hkdConvertedCny === null ? null : cnyBase + hkdConvertedCny;
  const world = { ...bonusPool(worldGross, worldRefunds), pending: worldPending, conversionPending: worldConversionPending };
  if (worldConversionPending) world.cashback = null;
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
    totalCny: baseTotal === null || world.cashback === null ? null : baseTotal + world.cashback + pulse.cashback };
}
