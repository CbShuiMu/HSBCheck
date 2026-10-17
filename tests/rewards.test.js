import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNUAL_CAP, calculateRewards, groupRewardCards, hongKongToday, moneyUnits, paymentChannel, rewardMoney } from '../src/rewards.js';
import { fetchHkdCnyRate, RATE_URL } from '../src/exchange-rate.js';
import { mergeStatements } from '../src/statements.js';

const today = '2026-10-16';
const transaction = (patch = {}) => ({ id: '1', day: '2026-10-01', transactionDay: '2026-09-30', description: 'Alipay CHN CN', amount: '100.00', currency: 'CNY', direction: 'debit', category: 'spend', notes: [], ...patch });
const calculate = (items, settings = {}) => calculateRewards(items, { today, hkdCnyRate: .85, ...settings });

test('ordinary CNY consumption returns 0.4% + 2%, without Pulse', () => {
  const rewards = calculate([transaction()]);
  assert.equal(rewardMoney(rewards.base.totalCny), '0.40');
  assert.equal(rewardMoney(rewards.world.cashback), '2.00');
  assert.equal(rewards.pulse.cashback, 0n);
  assert.equal(rewardMoney(rewards.totalCny), '2.40');
});
test('Apple Pay continuation takes priority over an Alipay merchant description', () => {
  const item = transaction({ notes: ['APPLE PAY-MOBILE:1234'] });
  assert.equal(paymentChannel(item).key, 'applePay');
  assert.equal(rewardMoney(calculate([item]).totalCny), '4.40');
});
test('explicit UnionPay QR is eligible; generic UnionPay is not', () => {
  for (const description of ['UnionPay QR merchant', '银联 二维码付款', 'UNIONPAY QR CODE']) {
    assert.equal(paymentChannel(transaction({ description })).pulse, true);
  }
  for (const description of ['UNIONPAY MERCHANT CHN CN', 'Tenpay Technology Company', 'Alipay']) {
    assert.equal(paymentChannel(transaction({ description })).pulse, false);
    assert.equal(paymentChannel(transaction({ description })).uncertain, false);
  }
  assert.equal(paymentChannel(transaction({ description: 'Unknown merchant' })).uncertain, true);
});

test('unrecognized payment methods earn no cashback and consume no allowance until confirmed', () => {
  const records = [transaction({ description: 'Unknown merchant', amount: '80000.00' })];
  const pending = calculate(records);
  assert.equal(pending.pending, 1); assert.equal(pending.unknownChannels, 1);
  assert.equal(pending.included, 0); assert.equal(pending.totalCny, 0n);
  assert.equal(pending.base.cnyGross, 0n);
  assert.equal(pending.world.used, 0n); assert.equal(pending.pulse.used, 0n);
  assert.equal(pending.world.remaining, ANNUAL_CAP); assert.equal(pending.pulse.remaining, ANNUAL_CAP);
  for (const [channel, total, pulseUsed] of [['standard', '1920.00', 0n], ['applePay', '3520.00', ANNUAL_CAP], ['unionpayQr', '3520.00', ANNUAL_CAP]]) {
    const confirmed = calculate(records, { overrides: { 1: { channel } } });
    assert.equal(confirmed.pending, 0); assert.equal(confirmed.included, 1);
    assert.equal(rewardMoney(confirmed.totalCny), total);
    assert.equal(confirmed.world.used, ANNUAL_CAP); assert.equal(confirmed.pulse.used, pulseUsed);
  }
  assert.equal(calculate(records, { overrides: { 1: { channel: 'auto' } } }).totalCny, 0n);
});

test('unposted transactions are excluded for both currencies even with a confirmed payment channel', () => {
  for (const status of ['pending', 'unposted', 'unconfirmed', 'authorized', 'authorised']) {
    for (const currency of ['CNY', 'HKD']) {
      const rewards = calculate([transaction({ status, currency, notes: ['APPLE PAY'] })], { overrides: { 1: { channel: 'applePay' } } });
      assert.equal(rewards.pending, 1); assert.equal(rewards.included, 0);
      assert.equal(rewards.totalCny, 0n); assert.equal(rewards.world.used, 0n); assert.equal(rewards.pulse.used, 0n);
    }
  }
});

test('pending refunds do not claw back rewards until the transaction and payment method are confirmed', () => {
  const spend = transaction({ id: 'spend', notes: ['APPLE PAY'] });
  const refund = transaction({ id: 'refund', description: 'Unknown refund', direction: 'credit', category: 'credit' });
  const pending = calculate([spend, refund]);
  assert.equal(pending.pending, 1); assert.equal(rewardMoney(pending.totalCny), '4.40');
  assert.equal(pending.base.cnyRefunds, 0n); assert.equal(pending.world.clawback, 0n); assert.equal(pending.pulse.clawback, 0n);
  const confirmed = calculate([spend, refund], { overrides: { refund: { channel: 'applePay' } } });
  assert.equal(confirmed.pending, 0); assert.equal(confirmed.totalCny, 0n);
  assert.equal(confirmed.world.used, moneyUnits('100.00')); assert.equal(confirmed.pulse.used, moneyUnits('100.00'));
  const unposted = calculate([spend, { ...refund, status: 'pending', notes: ['APPLE PAY'] }], { overrides: { refund: { channel: 'applePay' } } });
  assert.equal(rewardMoney(unposted.totalCny), '4.40');
});

test('a pending entry in August and its confirmed entry in September earn cashback only once', () => {
  const august = transaction({ id: 'august', day: '2026-08-14', transactionDay: '2026-08-13', statementDate: '2026-08-14', status: 'pending', sources: [] });
  const september = { ...august, id: 'september', day: '2026-08-15', statementDate: '2026-09-14', status: 'booked' };
  for (const first of [august, { ...august, status: 'booked', description: 'Unknown merchant' }]) {
    const { transactions } = mergeStatements([{ result: { transactions: [first] } }, { result: { transactions: [september] } }]);
    const rewards = calculate(transactions);
    assert.equal(transactions.length, 2); assert.equal(rewards.pending, 1); assert.equal(rewards.included, 1);
    assert.equal(rewardMoney(rewards.totalCny), '2.40');
    assert.equal(rewards.world.used, moneyUnits('100.00'));
  }
});

test('pending spend cannot exhaust allowance needed by confirmed spend', () => {
  const rewards = calculate([transaction({ id: 'pending', description: 'Unknown merchant', amount: '80000.00' }), transaction({ id: 'confirmed', amount: '500.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewardMoney(rewards.totalCny), '22.00');
  assert.equal(rewards.world.used, moneyUnits('500.00')); assert.equal(rewards.pulse.used, moneyUnits('500.00'));
});
test('HKD only receives 0.4% base reward, converted to CNY in the correct direction', () => {
  const rewards = calculate([transaction({ currency: 'HKD', notes: ['APPLE PAY'] })]);
  assert.equal(rewardMoney(rewards.base.hkd), '0.40');
  assert.equal(rewardMoney(rewards.base.totalCny), '0.34');
  assert.equal(rewards.world.used, 0n); assert.equal(rewards.pulse.used, 0n);
});
test('both bonus programs stop at CNY 80000 while base remains unlimited', () => {
  const rewards = calculate([transaction({ amount: '100000.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewards.world.used, ANNUAL_CAP); assert.equal(rewards.pulse.used, ANNUAL_CAP);
  assert.equal(rewards.world.progress, 100); assert.equal(rewards.pulse.remaining, 0n);
  assert.equal(rewardMoney(rewards.world.cashback), '1600.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1600.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '400.00');
});
test('bonus programs have independent allowances', () => {
  const rewards = calculate([transaction({ amount: '100000.00' }), transaction({ id: '2', amount: '20000.00', description: 'UNIONPAY QR' })]);
  assert.equal(rewards.world.used, ANNUAL_CAP);
  assert.equal(rewards.pulse.used, moneyUnits('20000.00'));
  assert.equal(rewards.pulse.progress, 25);
  assert.equal(rewardMoney(rewards.totalCny), '2480.00');
});

test('Pulse resets on July 1 while annual cashback retains both independently capped halves', () => {
  const records = [transaction({ id: 'first', day: '2026-06-30', amount: '100000.00', notes: ['APPLE PAY'] }), transaction({ id: 'second', day: '2026-07-01', amount: '100000.00', notes: ['APPLE PAY'] })];
  const june = calculate(records, { today: '2026-06-30' });
  assert.equal(june.pulse.label, '上半年'); assert.equal(june.pulse.nextReset, '2026-07-01');
  assert.equal(june.pulse.used, ANNUAL_CAP); assert.equal(rewardMoney(june.pulse.cashback), '1600.00');
  const julyBeforeSpending = calculate([records[0]], { today: '2026-07-01' });
  assert.equal(julyBeforeSpending.pulse.used, 0n); assert.equal(julyBeforeSpending.pulse.remaining, ANNUAL_CAP);
  assert.equal(rewardMoney(julyBeforeSpending.pulse.cashback), '1600.00');
  const july = calculate(records, { today: '2026-07-01' });
  assert.equal(july.pulse.label, '下半年'); assert.equal(july.pulse.nextReset, '2027-01-01');
  assert.equal(rewardMoney(july.pulse.cashback), '3200.00');
  assert.equal(july.pulse.periods[0].used, ANNUAL_CAP); assert.equal(july.pulse.periods[1].used, ANNUAL_CAP);
  assert.equal(rewardMoney(july.world.cashback), '1600.00');
  assert.equal(rewardMoney(july.base.totalCny), '800.00');
  const january = calculate(records, { today: '2027-01-01' });
  assert.equal(january.totalCny, 0n); assert.equal(january.pulse.used, 0n);
  assert.equal(january.pulse.nextReset, '2027-07-01');
});

test('Pulse uses posting date at the half-year boundary and refunds never restore either half', () => {
  const spend = transaction({ id: 'spend', day: '2026-06-30', amount: '80000.00', notes: ['APPLE PAY'] });
  const refund = transaction({ id: 'refund', day: '2026-07-01', direction: 'credit', category: 'credit', amount: '10000.00', notes: ['APPLE PAY'] });
  const rewards = calculate([spend, refund]);
  assert.equal(rewardMoney(rewards.pulse.cashback), '1400.00');
  assert.equal(rewards.pulse.periods[0].remaining, 0n); assert.equal(rewards.pulse.remaining, ANNUAL_CAP);
  const boundary = calculate([transaction({ day: '2026-07-01', transactionDay: '2026-06-30', notes: ['APPLE PAY'] })]);
  assert.equal(boundary.pulse.periods[0].used, 0n); assert.equal(boundary.pulse.periods[1].used, moneyUnits('100.00'));
});

test('primary and supplementary cards have independent base, world and half-year Pulse rewards', () => {
  const records = [
    transaction({ id: 'main', rewardCardId: 'main', cardType: 'primary', amount: '100000.00', notes: ['APPLE PAY'] }),
    transaction({ id: 'sup1', rewardCardId: 'sup1', cardType: 'supplementary', amount: '100000.00', notes: ['APPLE PAY'] }),
    transaction({ id: 'sup2', rewardCardId: 'sup2', cardType: 'supplementary', amount: '100.00', notes: ['APPLE PAY'] }),
    transaction({ id: 'refund', rewardCardId: 'sup2', cardType: 'supplementary', amount: '100.00', notes: ['APPLE PAY'], direction: 'credit', category: 'credit' }),
    transaction({ id: 'hkd', rewardCardId: 'sup1', cardType: 'supplementary', currency: 'HKD', amount: '1000.00' }),
  ];
  const groups = groupRewardCards(records);
  assert.deepEqual(groups.map(group => group.type), ['primary', 'supplementary', 'supplementary']);
  const [main, first, second] = groups.map(group => calculate(group.records));
  assert.equal(rewardMoney(main.totalCny), '3600.00'); assert.equal(rewardMoney(first.totalCny), '3603.40');
  assert.equal(second.totalCny, 0n); assert.equal(second.world.used, moneyUnits('100.00'));
  assert.equal(main.world.used, ANNUAL_CAP); assert.equal(first.world.used, ANNUAL_CAP);
  const corrected = calculate(groups[2].records, { overrides: { sup2: { channel: 'exclude' }, refund: { channel: 'exclude' } } });
  assert.equal(corrected.world.used, 0n); assert.equal(calculate(groups[0].records).world.used, ANNUAL_CAP);
});

test('card grouping retains zero-spend cards, combines currency metadata and supports legacy records', () => {
  const cards = [{ id: 'main', type: 'primary', currency: 'HKD', last4: '1111' }, { id: 'main', type: 'primary', currency: 'CNY', last4: '2222' }, { id: 'sup', type: 'supplementary', currency: 'CNY', last4: '3333' }];
  const groups = groupRewardCards([], cards);
  assert.equal(groups.length, 2); assert.equal(groups[0].last4, '2222'); assert.equal(groups[1].records.length, 0);
  assert.equal(groupRewardCards([]).length, 1); assert.equal(groupRewardCards([transaction()])[0].records.length, 1);
});
test('a complete refund removes cashback but never releases either allowance', () => {
  const rewards = calculate([transaction({ notes: ['APPLE PAY'] }), transaction({ id: '2', notes: ['APPLE PAY'], category: 'credit', direction: 'credit' })]);
  assert.equal(rewards.world.used, moneyUnits('100.00')); assert.equal(rewards.pulse.used, moneyUnits('100.00'));
  assert.equal(rewards.world.remaining, moneyUnits('79900.00')); assert.equal(rewards.pulse.remaining, moneyUnits('79900.00'));
  assert.equal(rewards.totalCny, 0n);
});
test('refunded capped spend cannot create new bonus allowance for later consumption', () => {
  const rewards = calculate([transaction({ amount: '80000.00', notes: ['APPLE PAY'] }), transaction({ id: 'refund', amount: '20000.00', category: 'credit', direction: 'credit', notes: ['APPLE PAY'] }), transaction({ id: 'later', amount: '20000.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewards.world.used, ANNUAL_CAP); assert.equal(rewards.world.remaining, 0n);
  assert.equal(rewardMoney(rewards.world.cashback), '1200.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1200.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '320.00');
});
test('refund of an originally ineligible over-cap purchase can claw back only base', () => {
  const records = [transaction({ amount: '100000.00', notes: ['APPLE PAY'] }), transaction({ id: 'refund', amount: '20000.00', category: 'credit', direction: 'credit', notes: ['APPLE PAY'] })];
  const rewards = calculate(records, { overrides: { refund: { refundBaseOnly: true } } });
  assert.equal(rewardMoney(rewards.world.cashback), '1600.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1600.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '320.00'); assert.equal(rewards.world.remaining, 0n);
});
test('manual payment correction updates only the applicable bonus pool', () => {
  const records = [transaction()];
  assert.equal(rewardMoney(calculate(records, { overrides: { 1: { channel: 'unionpayQr' } } }).pulse.cashback), '2.00');
  assert.equal(calculate(records, { overrides: { 1: { channel: 'exclude' } } }).totalCny, 0n);
});
test('unknown refund payment method is flagged until confirmed', () => {
  const records = [transaction({ category: 'credit', direction: 'credit' })];
  assert.equal(calculate(records).uncertainRefunds, 1);
  assert.equal(calculate(records, { overrides: { 1: { channel: 'standard' } } }).uncertainRefunds, 0);
});
test('only this calendar year through today is counted, by posting date', () => {
  const rewards = calculate([transaction(), transaction({ id: 'old', day: '2025-12-31' }), transaction({ id: 'future', day: '2026-10-17' }), transaction({ id: 'next', day: '2027-01-01' })]);
  assert.equal(rewards.included, 1); assert.equal(rewardMoney(rewards.totalCny), '2.40');
  assert.equal(hongKongToday(new Date('2025-12-31T17:00:00Z')), '2026-01-01');
});
test('repayments, fees and reward postings are excluded rather than treated as consumption or refunds', () => {
  const rewards = calculate([transaction({ category: 'repayment', direction: 'credit' }), transaction({ id: 'fee', category: 'fee' }), transaction({ id: 'reward', description: 'REWARDCASH', category: 'credit', direction: 'credit' })]);
  assert.equal(rewards.included, 0); assert.equal(rewards.excluded, 3); assert.equal(rewards.totalCny, 0n);
});
test('other currencies do not silently use the HKD or CNY rules', () => {
  const rewards = calculate([transaction({ currency: 'USD' })]);
  assert.equal(rewards.otherCurrency, 1); assert.equal(rewards.totalCny, 0n);
});
test('missing exchange rate leaves HKD conversion unknown while CNY bonus and allowance remain available', () => {
  const rewards = calculate([transaction(), transaction({ id: 'hk', currency: 'HKD' })], { hkdCnyRate: null });
  assert.equal(rewards.base.totalCny, null); assert.equal(rewards.totalCny, null);
  assert.equal(rewardMoney(rewards.world.cashback), '2.00');
  assert.equal(rewardMoney(calculate([transaction()], { hkdCnyRate: null }).totalCny), '2.40');
});
test('monetary rounding happens after aggregation and negative net cashback is bounded at zero', () => {
  const rewards = calculate(Array.from({ length: 250 }, (_, index) => transaction({ id: String(index), amount: '0.01' })));
  assert.equal(rewardMoney(rewards.base.totalCny), '0.01');
  assert.equal(calculate([transaction({ direction: 'credit', category: 'credit', amount: '999.00' })]).totalCny, 0n);
  assert.throws(() => moneyUnits('10.5O'), /无效金额/);
});
test('public FX request sends no account, transaction, PDF or credentials', async () => {
  const controller = new AbortController();
  const result = await fetchHkdCnyRate({ signal: controller.signal, fetcher: async (url, options) => {
    assert.equal(url, RATE_URL); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.signal, controller.signal); assert.equal(options.body, undefined); assert.deepEqual(options.headers, { Accept: 'application/json' });
    return { ok: true, json: async () => ({ base: 'HKD', quote: 'CNY', rate: .85, date: today }) };
  } });
  assert.deepEqual(result, { rate: .85, date: today });
});
test('wrong-pair, invalid, and failed rate responses do not become a fake conversion', async () => {
  for (const data of [{ base: 'CNY', quote: 'HKD', rate: .85, date: today }, { base: 'HKD', quote: 'CNY', rate: 0, date: today }, { base: 'HKD', quote: 'CNY', rate: .85, date: 'unknown' }]) {
    await assert.rejects(fetchHkdCnyRate({ fetcher: async () => ({ ok: true, json: async () => data }) }), /无效/);
  }
  await assert.rejects(fetchHkdCnyRate({ fetcher: async () => ({ ok: false, status: 429 }) }), /429/);
});
