import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNUAL_CAP, PULSE_HALF_YEAR_CAP, calculateRewards, groupRewardCards, hongKongToday, moneyUnits, paymentChannel, rewardMoney, worldEligibility } from '../src/rewards.js';
import { fetchHkdCnyRate, RATE_URL } from '../src/exchange-rate.js';
import { mergeStatements } from '../src/statements.js';

const today = '2026-10-16';
const transaction = (patch = {}) => ({ id: '1', day: '2026-10-01', transactionDay: '2026-09-30', description: 'Alipay CHN CN', merchantCountryCode: 'CN', amount: '100.00', currency: 'CNY', direction: 'debit', category: 'spend', notes: [], ...patch });
const calculate = (items, settings = {}) => calculateRewards(items, { today, hkdCnyRate: .85, ...settings });

test('world includes mainland, Macau and overseas, but rejects Hong Kong regardless of CNY', () => {
  for (const merchantCountryCode of ['CN', 'CHN', '156', 'MO', 'MAC', '446', 'JP', 'JPN', '392', 'US', '840', 'GB', 'SG', 'ZA', 'ITA', 'ARE']) {
    const item = transaction({ merchantCountryCode, notes: ['APPLE PAY'] });
    const rewards = calculate([item]);
    assert.equal(rewardMoney(rewards.world.cashback), '2.00', merchantCountryCode);
    assert.equal(rewards.world.used, moneyUnits('100.00'));
    assert.equal(rewards.pulse.used, ['CN', 'CHN', '156', 'MO', 'MAC', '446'].includes(merchantCountryCode) ? moneyUnits('100.00') : 0n);
  }
  for (const merchantCountryCode of ['HK', 'HKG', '344']) {
    const rewards = calculate([transaction({ merchantCountryCode, notes: ['APPLE PAY'] })]);
    assert.equal(rewards.world.used, 0n); assert.equal(rewards.pulse.used, 0n);
    assert.equal(rewardMoney(rewards.totalCny), '0.40');
  }
});

test('world reads statement country suffixes and continuation metadata; explicit country takes priority', () => {
  for (const [description, notes, expected] of [
    ['EXAMPLE SHOP TOKYO JP', [], true], ['EXAMPLE SHOP MAC', [], true],
    ['ALIPAY CHN CN', [], true], ['EXAMPLE STORE', ['MERCHANT COUNTRY CODE: 446'], true],
    ['ALIPAY HKG HK', [], false], ['EXAMPLE STORE', ['MERCHANT COUNTRY: HK'], false],
    ['ALIPAY', [], true], ['UNIONPAY QR', [], true],
  ]) {
    assert.equal(worldEligibility(transaction({ merchantCountryCode: '', description, notes })).eligible, expected);
  }
  assert.equal(worldEligibility(transaction({ merchantCountryCode: 'HK', description: 'ALIPAY CHN CN' })).eligible, false);
});

test('foreign transactions billed in HKD earn world using billed amounts converted to CNY', () => {
  for (const [merchantCountryCode, originalCurrency] of [['JP', 'JPY'], ['MO', 'MOP'], ['CN', 'CNY'], ['US', 'USD']]) {
    const item = transaction({ currency: 'HKD', merchantCountryCode, originalCurrency, notes: ['APPLE PAY'] });
    const rewards = calculate([item]);
    assert.equal(rewardMoney(rewards.world.cashback), '1.70');
    assert.equal(rewards.world.used, moneyUnits('85.00')); assert.equal(rewards.pulse.used, 0n);
    assert.equal(rewardMoney(rewards.totalCny), '2.04');
    assert.equal(paymentChannel(item).nominalRate, '2.4%');
  }
  const item = transaction({ currency: 'HKD', merchantCountryCode: 'JP', notes: ['JPY 2000.00'] });
  assert.equal(rewardMoney(calculate([item]).world.cashback), '1.70');
  assert.equal(worldEligibility({ ...item, notes: ['ORIGINAL CURRENCY: JPY'] }).eligible, true);
});

test('Hong Kong merchants and original HKD transactions never earn world, even with payment overrides', () => {
  for (const patch of [{ currency: 'CNY', merchantCountryCode: 'HK' }, { currency: 'HKD', merchantCountryCode: 'US', originalCurrency: 'HKD' }, { currency: 'HKD', merchantCountryCode: 'HK', originalCurrency: 'USD' }]) {
    const rewards = calculate([transaction(patch)], { overrides: { 1: { channel: 'applePay' } } });
    assert.equal(rewards.world.used, 0n); assert.equal(rewards.pulse.used, 0n);
  }
});

test('missing world metadata defaults to world and manual region or currency corrections take priority', () => {
  const item = transaction({ merchantCountryCode: '', description: 'ALIPAY' });
  const pending = calculate([item]);
  assert.equal(pending.world.pending, 0); assert.equal(pending.world.used, moneyUnits('100.00'));
  assert.equal(rewardMoney(pending.base.totalCny), '0.40');
  assert.equal(rewardMoney(pending.totalCny), '2.40');
  assert.equal(pending.pulse.used, 0n);
  assert.match(worldEligibility(item).reason, /默认计入/);
  const overrides = { 1: { merchantRegion: 'macau' } };
  assert.equal(rewardMoney(calculate([item], { overrides }).world.cashback), '2.00');
  assert.equal(paymentChannel(item, 'auto', overrides[1]).nominalRate, '2.4%');
  const hkBilled = { ...item, currency: 'HKD', merchantCountryCode: 'JP' };
  assert.equal(calculate([hkBilled]).world.pending, 0);
  assert.equal(rewardMoney(calculate([hkBilled]).totalCny), '2.04');
  assert.equal(rewardMoney(calculate([hkBilled], { overrides: { 1: { originalCurrency: 'FOREIGN' } } }).world.cashback), '1.70');
  assert.equal(calculate([hkBilled], { overrides: { 1: { originalCurrency: 'HKD' } } }).world.used, 0n);
  assert.equal(calculate([item], { overrides: { 1: { merchantRegion: 'hongKong' } } }).world.used, 0n);
  assert.equal(worldEligibility({ ...item, description: 'EXAMPLE HKG HK' }, { merchantRegion: 'overseas' }).eligible, true);
});

test('statement suffixes read country before optional currency and amount using fictional merchants', () => {
  for (const [description, currency, region, originalCurrency, eligible] of [
    ['EXAMPLE METRO CHN CN', 'CNY', 'mainland', 'CNY', true],
    ['EXAMPLE TRAVEL HKG HK', 'HKD', 'hongKong', '', false],
    ['EXAMPLE RIDE GBR GB GBP 7.25', 'HKD', 'overseas', 'GBP', true],
    ['EXAMPLE STORE MAC MO MOP 82.00', 'HKD', 'macau', 'MOP', true],
    ['EXAMPLE CAFE VNM VN VND 123,456.00', 'HKD', 'overseas', 'VND', true],
    ['EXAMPLE PHARMACY KHM KH USD 6.75', 'HKD', 'overseas', 'USD', true],
    ['EXAMPLE SHOP KHM KH KHR 25000', 'HKD', 'overseas', 'KHR', true],
    ['example shop hkg   hk usd 6.75', 'HKD', 'hongKong', 'USD', false],
    ['EXAMPLE SHOP HKG HK', 'CNY', 'hongKong', 'CNY', false],
  ]) {
    const item = transaction({ merchantCountryCode: '', description, currency });
    const world = worldEligibility(item);
    assert.deepEqual([world.region, world.originalCurrency, world.eligible], [region, originalCurrency, eligible], description);
    const rewards = calculate([item]);
    assert.equal(rewardMoney(rewards.totalCny), eligible ? currency === 'CNY' ? '2.40' : '2.04' : currency === 'CNY' ? '0.40' : '0.34', description);
    assert.equal(rewards.pulse.used, 0n);
  }
  const item = transaction({ merchantCountryCode: '', description: 'EXAMPLE STORE', currency: 'HKD', notes: ['HKG HK USD 6.75'] });
  assert.equal(worldEligibility(item).eligible, false);
  assert.equal(worldEligibility({ ...item, merchantCountryCode: 'CN' }).eligible, true);
  assert.equal(worldEligibility({ ...item, description: 'EXAMPLE CN SHOP', notes: ['KHM KH', 'USD 6.75'] }).region, 'overseas');
});

test('unknown country codes default to world without being treated as mainland or Macau for Pulse', () => {
  for (const merchantCountryCode of ['', 'XXX', 'KHM']) {
    const item = transaction({ merchantCountryCode, description: 'EXAMPLE STORE', notes: ['APPLE PAY'] });
    const rewards = calculate([item]);
    assert.equal(rewardMoney(rewards.totalCny), '2.40');
    assert.equal(rewards.world.used, moneyUnits('100.00')); assert.equal(rewards.pulse.used, 0n);
  }
  const spend = transaction({ merchantCountryCode: '', description: 'EXAMPLE STORE', currency: 'HKD' });
  const refund = { ...spend, id: 'refund', direction: 'credit', category: 'credit' };
  const rewards = calculate([spend, refund]);
  assert.equal(rewards.totalCny, 0n); assert.equal(rewards.world.used, moneyUnits('85.00'));
  assert.equal(rewardMoney(rewards.world.clawback), '1.70');
  assert.equal(calculate([spend], { hkdCnyRate: null }).world.cashback, null);
});

test('foreign HKD refunds claw back world without restoring allowance; missing FX remains unknown', () => {
  const spend = transaction({ currency: 'HKD', merchantCountryCode: 'JP', originalCurrency: 'JPY' });
  const refund = { ...spend, id: 'refund', direction: 'credit', category: 'credit' };
  const rewards = calculate([spend, refund]);
  assert.equal(rewards.world.used, moneyUnits('85.00')); assert.equal(rewards.world.cashback, 0n);
  assert.equal(rewards.world.clawback, moneyUnits('1.70')); assert.equal(rewards.totalCny, 0n);
  assert.equal(rewardMoney(calculate([spend, refund], { overrides: { refund: { refundBaseOnly: true } } }).world.cashback), '1.70');
  const missingFx = calculate([spend], { hkdCnyRate: null });
  assert.equal(missingFx.world.conversionPending, 1); assert.equal(missingFx.world.cashback, null); assert.equal(missingFx.totalCny, null);
  for (const patch of [{ status: 'pending' }, { category: 'fee' }]) {
    assert.equal(calculate([{ ...spend, ...patch }]).world.used, 0n);
  }
});

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

test('unrecognized payment methods earn base and world as ordinary spend without consuming Pulse allowance', () => {
  const records = [transaction({ description: 'Unknown merchant', amount: '100000.00' })];
  const pending = calculate(records);
  assert.equal(pending.pending, 0); assert.equal(pending.unknownChannels, 1);
  assert.equal(pending.included, 1); assert.equal(rewardMoney(pending.totalCny), '2400.00');
  assert.equal(pending.base.cnyGross, moneyUnits('100000.00'));
  assert.equal(pending.world.used, ANNUAL_CAP); assert.equal(pending.pulse.used, 0n);
  assert.equal(pending.world.remaining, 0n); assert.equal(pending.pulse.remaining, PULSE_HALF_YEAR_CAP);
  for (const [channel, total, pulseUsed] of [['standard', '2400.00', 0n], ['applePay', '4000.00', PULSE_HALF_YEAR_CAP], ['unionpayQr', '4000.00', PULSE_HALF_YEAR_CAP]]) {
    const confirmed = calculate(records, { overrides: { 1: { channel } } });
    assert.equal(confirmed.pending, 0); assert.equal(confirmed.included, 1);
    assert.equal(rewardMoney(confirmed.totalCny), total);
    assert.equal(confirmed.world.used, ANNUAL_CAP); assert.equal(confirmed.pulse.used, pulseUsed);
  }
  assert.equal(rewardMoney(calculate(records, { overrides: { 1: { channel: 'auto' } } }).totalCny), '2400.00');
  assert.equal(calculate(records, { overrides: { 1: { channel: 'exclude' } } }).totalCny, 0n);
});

test('unrecognized mainland merchant descriptions automatically earn 2.4% and explicit QR still earns 4.4%', () => {
  const item = transaction({ description: 'EXAMPLE WALLET CHN CN', merchantCountryCode: '', status: 'booked' });
  const rewards = calculate([item]);
  assert.equal(rewards.pending, 0); assert.equal(rewards.included, 1);
  assert.equal(rewardMoney(rewards.base.totalCny), '0.40');
  assert.equal(rewardMoney(rewards.world.cashback), '2.00');
  assert.equal(rewardMoney(rewards.totalCny), '2.40');
  assert.equal(paymentChannel(item).nominalRate, '2.4%'); assert.equal(rewards.pulse.used, 0n);
  assert.equal(rewardMoney(calculate([{ ...item, notes: ['UNIONPAY QR'] }]).totalCny), '4.40');
  assert.equal(calculate([{ ...item, status: 'pending' }]).totalCny, 0n);
  const local = calculate([{ ...item, merchantCountryCode: 'HK' }]);
  assert.equal(local.world.used, 0n); assert.equal(rewardMoney(local.totalCny), '0.40');
  const unknownRegion = calculate([{ ...item, description: 'EXAMPLE WALLET' }]);
  assert.equal(unknownRegion.world.pending, 0); assert.equal(rewardMoney(unknownRegion.totalCny), '2.40');
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

test('posted refunds with unknown payment methods claw back base and world; unposted refunds remain excluded', () => {
  const spend = transaction({ id: 'spend', notes: ['APPLE PAY'] });
  const refund = transaction({ id: 'refund', description: 'Unknown refund', direction: 'credit', category: 'credit' });
  const pending = calculate([spend, refund]);
  assert.equal(pending.pending, 0); assert.equal(rewardMoney(pending.totalCny), '2.00');
  assert.equal(pending.base.cnyRefunds, moneyUnits('100.00')); assert.equal(pending.world.clawback, moneyUnits('2.00')); assert.equal(pending.pulse.clawback, 0n);
  assert.equal(pending.uncertainRefunds, 1);
  const baseOnly = calculate([spend, refund], { overrides: { refund: { refundBaseOnly: true } } });
  assert.equal(rewardMoney(baseOnly.totalCny), '4.00'); assert.equal(baseOnly.world.clawback, 0n);
  const confirmed = calculate([spend, refund], { overrides: { refund: { channel: 'applePay' } } });
  assert.equal(confirmed.pending, 0); assert.equal(confirmed.totalCny, 0n);
  assert.equal(confirmed.world.used, moneyUnits('100.00')); assert.equal(confirmed.pulse.used, moneyUnits('100.00'));
  const unposted = calculate([spend, { ...refund, status: 'pending', notes: ['APPLE PAY'] }], { overrides: { refund: { channel: 'applePay' } } });
  assert.equal(rewardMoney(unposted.totalCny), '4.40');
});

test('a pending entry in August and its confirmed entry in September earn cashback only once', () => {
  const august = transaction({ id: 'august', day: '2026-08-14', transactionDay: '2026-08-13', statementDate: '2026-08-14', status: 'pending', sources: [] });
  const september = { ...august, id: 'september', day: '2026-08-15', statementDate: '2026-09-14', status: 'booked' };
  for (const first of [august, { ...august, description: 'Unknown merchant' }]) {
    const { transactions } = mergeStatements([{ result: { transactions: [first] } }, { result: { transactions: [september] } }]);
    const rewards = calculate(transactions);
    assert.equal(transactions.length, 2); assert.equal(rewards.pending, 1); assert.equal(rewards.included, 1);
    assert.equal(rewardMoney(rewards.totalCny), '2.40');
    assert.equal(rewards.world.used, moneyUnits('100.00'));
  }
});

test('pending spend cannot exhaust allowance needed by confirmed spend', () => {
  const rewards = calculate([transaction({ id: 'pending', status: 'pending', description: 'Unknown merchant', amount: '80000.00' }), transaction({ id: 'confirmed', amount: '500.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewardMoney(rewards.totalCny), '22.00');
  assert.equal(rewards.world.used, moneyUnits('500.00')); assert.equal(rewards.pulse.used, moneyUnits('500.00'));
});
test('local HKD receives 0.4% base reward, converted to CNY in the correct direction', () => {
  const rewards = calculate([transaction({ currency: 'HKD', merchantCountryCode: 'HK', originalCurrency: 'HKD', notes: ['APPLE PAY'] })]);
  assert.equal(rewardMoney(rewards.base.hkd), '0.40');
  assert.equal(rewardMoney(rewards.base.totalCny), '0.34');
  assert.equal(rewards.world.used, 0n); assert.equal(rewards.pulse.used, 0n);
});
test('world stops at CNY 100000 and Pulse at CNY 80000 while base remains unlimited', () => {
  const rewards = calculate([transaction({ amount: '100000.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewards.world.used, ANNUAL_CAP); assert.equal(rewards.pulse.used, PULSE_HALF_YEAR_CAP);
  assert.equal(rewards.world.progress, 100); assert.equal(rewards.pulse.remaining, 0n);
  assert.equal(rewardMoney(rewards.world.cashback), '2000.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1600.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '400.00');
});
test('bonus programs have independent allowances', () => {
  const rewards = calculate([transaction({ amount: '100000.00' }), transaction({ id: '2', amount: '20000.00', description: 'UNIONPAY QR' })]);
  assert.equal(rewards.world.used, ANNUAL_CAP);
  assert.equal(rewards.pulse.used, moneyUnits('20000.00'));
  assert.equal(rewards.pulse.progress, 25);
  assert.equal(rewardMoney(rewards.totalCny), '2880.00');
});

test('world continues earning between CNY 80000 and 100000 and caps independently of Pulse', () => {
  for (const [spend, worldCashback, remaining, progress, overCap] of [
    ['80000.00', '1600.00', '20000.00', 80, '0.00'],
    ['90000.00', '1800.00', '10000.00', 90, '0.00'],
    ['100000.00', '2000.00', '0.00', 100, '0.00'],
    ['120000.00', '2000.00', '0.00', 100, '20000.00'],
  ]) {
    const rewards = calculate([transaction({ amount: spend, notes: ['APPLE PAY'] })]);
    assert.equal(rewards.world.cap, moneyUnits('100000.00'));
    assert.equal(rewardMoney(rewards.world.cashback), worldCashback);
    assert.equal(rewards.world.remaining, moneyUnits(remaining));
    assert.equal(rewards.world.progress, progress);
    assert.equal(rewards.world.overCap, moneyUnits(overCap));
    assert.equal(rewards.pulse.cap, moneyUnits('80000.00'));
    assert.equal(rewardMoney(rewards.pulse.cashback), '1600.00');
    assert.equal(rewards.pulse.remaining, 0n);
  }
});

test('Pulse resets on July 1 while annual cashback retains both independently capped halves', () => {
  const records = [transaction({ id: 'first', day: '2026-06-30', amount: '100000.00', notes: ['APPLE PAY'] }), transaction({ id: 'second', day: '2026-07-01', amount: '100000.00', notes: ['APPLE PAY'] })];
  const june = calculate(records, { today: '2026-06-30' });
  assert.equal(june.pulse.label, '上半年'); assert.equal(june.pulse.nextReset, '2026-07-01');
  assert.equal(june.pulse.used, PULSE_HALF_YEAR_CAP); assert.equal(rewardMoney(june.pulse.cashback), '1600.00');
  const julyBeforeSpending = calculate([records[0]], { today: '2026-07-01' });
  assert.equal(julyBeforeSpending.pulse.used, 0n); assert.equal(julyBeforeSpending.pulse.remaining, PULSE_HALF_YEAR_CAP);
  assert.equal(rewardMoney(julyBeforeSpending.pulse.cashback), '1600.00');
  const july = calculate(records, { today: '2026-07-01' });
  assert.equal(july.pulse.label, '下半年'); assert.equal(july.pulse.nextReset, '2027-01-01');
  assert.equal(rewardMoney(july.pulse.cashback), '3200.00');
  assert.equal(july.pulse.periods[0].used, PULSE_HALF_YEAR_CAP); assert.equal(july.pulse.periods[1].used, PULSE_HALF_YEAR_CAP);
  assert.equal(rewardMoney(july.world.cashback), '2000.00');
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
  assert.equal(rewards.pulse.periods[0].remaining, 0n); assert.equal(rewards.pulse.remaining, PULSE_HALF_YEAR_CAP);
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
  assert.equal(rewardMoney(main.totalCny), '4000.00'); assert.equal(rewardMoney(first.totalCny), '4003.40');
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
  assert.equal(rewards.world.remaining, moneyUnits('99900.00')); assert.equal(rewards.pulse.remaining, moneyUnits('79900.00'));
  assert.equal(rewards.totalCny, 0n);
});
test('refunded capped spend cannot create new bonus allowance for later consumption', () => {
  const rewards = calculate([transaction({ amount: '100000.00', notes: ['APPLE PAY'] }), transaction({ id: 'refund', amount: '20000.00', category: 'credit', direction: 'credit', notes: ['APPLE PAY'] }), transaction({ id: 'later', amount: '20000.00', notes: ['APPLE PAY'] })]);
  assert.equal(rewards.world.used, ANNUAL_CAP); assert.equal(rewards.world.remaining, 0n);
  assert.equal(rewardMoney(rewards.world.cashback), '1600.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1200.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '400.00');
});
test('refund of an originally ineligible over-cap purchase can claw back only base', () => {
  const records = [transaction({ amount: '120000.00', notes: ['APPLE PAY'] }), transaction({ id: 'refund', amount: '20000.00', category: 'credit', direction: 'credit', notes: ['APPLE PAY'] })];
  const rewards = calculate(records, { overrides: { refund: { refundBaseOnly: true } } });
  assert.equal(rewardMoney(rewards.world.cashback), '2000.00'); assert.equal(rewardMoney(rewards.pulse.cashback), '1600.00');
  assert.equal(rewardMoney(rewards.base.totalCny), '400.00'); assert.equal(rewards.world.remaining, 0n);
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
  assert.equal(rewards.world.cashback, null); assert.equal(rewards.world.conversionPending, 1);
  assert.equal(rewards.world.used, moneyUnits('100.00'));
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
