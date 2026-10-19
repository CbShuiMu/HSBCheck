import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTextLines, inferDate, mergeStatements, parseMoney, parseStatementPages } from '../src/statements.js';
import { calculateRewards, moneyUnits, rewardMoney } from '../src/rewards.js';

const chunk = (text, x, y) => ({ text, x, y, width: text.length * 4 });
const row = (post, trans, description, amount, y) => [chunk(post, 70, y), chunk(trans, 103, y), chunk(description, 140, y), chunk(amount, 540, y)];
function page({ number = 1, date = '14 SEP 2026', currency = 'CNY', opening = '0.00', closing = '12.50', rows = [row('01SEP', '31AUG', 'EXAMPLE STORE', '12.50', 140)] } = {}) {
  return { page: number, width: 600, height: 840, items: [
    ...(date ? [chunk(date, 400, 30)] : []), chunk(`Account number 0001 0002 0003 0004 ${currency === 'CNY' ? 'RMB' : currency} Sub-account Statement balance`, 70, 50),
    chunk('Post date', 70, 100), chunk('Trans date', 103, 100), chunk('Description of transaction', 140, 100), chunk(`Amount (${currency})`, 500, 100),
    ...(opening === null ? [] : [chunk('PREVIOUS BALANCE', 140, 120), chunk(opening, 540, 120)]),
    ...rows.flat(), ...(closing === null ? [] : [chunk('STATEMENT BALANCE', 140, 500), chunk(closing, 540, 500)]),
    chunk('For example HKD 20,000 / minimum payment 869', 70, 700),
  ] };
}
const parse = (pages, sourceId = 'source-1') => parseStatementPages(pages, { sourceId, fileName: `${sourceId}.pdf` });

test('groups positioned PDF chunks by line, regardless of stream order', () => {
  const lines = groupTextLines([chunk('world', 100, 10.5), chunk('next', 0, 20), chunk('hello', 0, 10)]);
  assert.deepEqual(lines.map(line => line.text), ['hello world', 'next']);
});
test('recognizes comma amounts, CR credits and negative amounts', () => {
  assert.deepEqual(parseMoney('1,234.56CR'), { amount: '1234.56', direction: 'credit' });
  assert.deepEqual(parseMoney('-12.50'), { amount: '12.50', direction: 'credit' });
  assert.equal(parseMoney('12.50').direction, 'debit');
  assert.equal(parseMoney('12.5O'), null);
});
test('infers cross-year dates, rejects invalid dates and future posting dates', () => {
  assert.equal(inferDate('31 DEC', '2026-01-14'), '2025-12-31');
  assert.equal(inferDate('01JAN', '2026-01-14'), '2026-01-01');
  assert.equal(inferDate('31FEB', '2026-03-14'), null);
  assert.equal(inferDate('15JAN', '2026-01-14'), null);
});
test('parses both dates, source, currency and masked account; reconciles exact cents', () => {
  const result = parse([page()]); const transaction = result.transactions[0];
  assert.equal(transaction.day, '2026-09-01'); assert.equal(transaction.transactionDay, '2026-08-31');
  assert.equal(transaction.currency, 'CNY'); assert.equal(transaction.last4, '0004');
  assert.equal(transaction.account, 'CNY ···· 0004'); assert.deepEqual(transaction.sources, [{ sourceId: 'source-1', fileName: 'source-1.pdf', page: 1 }]);
  assert.equal(result.sections[0].status, 'matched'); assert.equal(result.warnings.length, 0);
});
test('continues transactions on following pages without statement date repetition', () => {
  const result = parse([page({ closing: null }), page({ number: 2, date: '', opening: null, closing: '25.00' })]);
  assert.equal(result.transactions.length, 2); assert.equal(result.transactions[1].sources[0].page, 2);
  assert.equal(result.sections[0].status, 'matched');
});
test('wallet continuation is retained without becoming another transaction', () => {
  const result = parse([page({ rows: [row('01SEP', '31AUG', 'EXAMPLE STORE', '12.50', 140), [chunk('APPLE PAY-MOBILE:1234', 140, 148.4)]] })]);
  assert.equal(result.transactions.length, 1); assert.deepEqual(result.transactions[0].notes, ['APPLE PAY-MOBILE:1234']);
});

test('parsed overseas foreign spend in the HKD sub-account earns world while local and DCC spend do not', () => {
  const result = parse([page({ currency: 'HKD', closing: '300.00', rows: [
    row('01SEP', '31AUG', 'EXAMPLE SHOP TOKYO JP', '100.00', 140), [chunk('JPY 2000.00', 140, 150)],
    row('02SEP', '01SEP', 'EXAMPLE SHOP HKG HK', '100.00', 170), [chunk('USD 12.50', 140, 180)],
    row('03SEP', '02SEP', 'EXAMPLE SHOP MACAU MO', '100.00', 200), [chunk('ORIGINAL CURRENCY: HKD', 140, 210)],
  ] })]);
  assert.equal(result.sections[0].status, 'matched');
  assert.equal(result.transactions.length, 3);
  const rewards = calculateRewards(result.transactions, { today: '2026-10-16', hkdCnyRate: .85 });
  assert.equal(rewards.world.pending, 0); assert.equal(rewards.world.used, moneyUnits('85.00'));
  assert.equal(rewardMoney(rewards.world.cashback), '1.70'); assert.equal(rewards.pulse.used, 0n);
});
test('credits include repayments and refunds, never count balances or promotional text', () => {
  const result = parse([page({ opening: '200.00', closing: '87.50', rows: [row('01SEP', '31AUG', 'EXAMPLE STORE', '12.50', 140), row('02SEP', '01SEP', 'IFS PAYMENT - THANK YOU', '100.00CR', 155), row('03SEP', '02SEP', 'EXAMPLE REFUND', '25.00CR', 170)] })]);
  assert.equal(result.transactions.length, 3); assert.equal(result.transactions[1].category, 'repayment');
  assert.equal(result.transactions[2].category, 'credit'); assert.equal(result.sections[0].status, 'matched');
});
test('multiple HKD and CNY sub-accounts reconcile independently, including zero-transaction sections', () => {
  const result = parse([page({ currency: 'HKD', rows: [], closing: '0.00' }), page({ number: 2 })]);
  assert.equal(result.sections.length, 2); assert.equal(result.sections[0].transactionCount, 0);
  assert.ok(result.sections.every(section => section.status === 'matched'));
});

test('supplementary card ownership survives page breaks and shared-account balance reconciliation', () => {
  const result = parse([
    page({ closing: null, rows: [
      [chunk('0001 0002 0003 0004 EXAMPLE MAIN', 140, 130)], row('01SEP', '31AUG', 'ALIPAY MAIN', '10.00', 140),
      [chunk('0001 0002 0003 0005 EXAMPLE FIRST', 140, 165)], row('01SEP', '31AUG', 'FIRST STORE', '20.00', 180), [chunk('APPLE PAY-MOBILE:1234', 140, 190)],
    ] }),
    page({ number: 2, date: '', opening: null, closing: '100.00', rows: [
      row('02SEP', '01SEP', 'FIRST CONTINUED', '30.00', 140), [chunk('UNIONPAY QR', 140, 150)],
      [chunk('0001 0002 0003 0006 EXAMPLE SECOND', 140, 180)], row('02SEP', '01SEP', 'ALIPAY SECOND', '40.00', 195),
    ] }),
  ]);
  assert.equal(result.transactions.length, 4); assert.equal(result.sections[0].status, 'matched'); assert.equal(result.warnings.length, 0);
  const [main, first, continuation, second] = result.transactions;
  assert.equal(main.cardType, 'primary'); assert.equal(main.last4, '0004');
  assert.equal(first.cardType, 'supplementary'); assert.equal(first.last4, '0005');
  assert.equal(first.billingLast4, '0004'); assert.equal(first.account, 'CNY ···· 0005（副卡）');
  assert.equal(first.rewardCardId, continuation.rewardCardId); assert.notEqual(first.rewardCardId, second.rewardCardId);
  assert.deepEqual(first.notes, ['APPLE PAY-MOBILE:1234']); assert.deepEqual(continuation.notes, ['UNIONPAY QR']);
  assert.equal(continuation.sources[0].page, 2); assert.equal(new Set(result.cards.map(card => card.id)).size, 3);
});

test('identical purchases on different cards retain separate identities and deduplicate on reimport', () => {
  const input = [page({ closing: '25.00', rows: [
    row('01SEP', '31AUG', 'ALIPAY STORE', '12.50', 140),
    [chunk('0001 0002 0003 0005 EXAMPLE FIRST', 140, 165)], row('01SEP', '31AUG', 'ALIPAY STORE', '12.50', 180),
  ] })];
  const first = parse(input, 'first'); const second = parse(input, 'second');
  assert.notEqual(first.transactions[0].id, first.transactions[1].id);
  const merged = mergeStatements([{ result: first }, { result: second }]);
  assert.equal(merged.transactions.length, 2); assert.equal(merged.duplicateCount, 2);
  assert.equal(new Set(merged.transactions.map(item => item.rewardCardId)).size, 2);
});

test('unambiguous holder headings join supplementary HKD and CNY card numbers', () => {
  const result = parse([
    page({ currency: 'HKD', closing: '10.00', rows: [[chunk('0001 0002 0003 0005 EXAMPLE FIRST', 140, 130)], row('01SEP', '31AUG', 'HK STORE', '10.00', 140)] }),
    page({ number: 2, closing: '20.00', rows: [[chunk('0001 0002 0003 0006 EXAMPLE FIRST', 140, 130)], row('01SEP', '31AUG', 'ALIPAY STORE', '20.00', 140)] }),
  ]);
  assert.equal(result.transactions[0].rewardCardId, result.transactions[1].rewardCardId);
  assert.notEqual(result.transactions[0].last4, result.transactions[1].last4);
  assert.ok(result.sections.every(section => section.status === 'matched'));
});

test('two same-name supplementary cards in one currency must not share reward allowance', () => {
  const result = parse([page({ closing: '20.00', rows: [
    [chunk('0001 0002 0003 0005 EXAMPLE FIRST', 140, 130)], row('01SEP', '31AUG', 'ALIPAY STORE', '10.00', 140),
    [chunk('0001 0002 0003 0006 EXAMPLE FIRST', 140, 170)], row('01SEP', '31AUG', 'ALIPAY STORE', '10.00', 180),
  ] })]);
  assert.notEqual(result.transactions[0].rewardCardId, result.transactions[1].rewardCardId);
});
test('keeps legitimate identical transactions and merges their occurrences across duplicate imports', () => {
  const input = [page({ rows: [row('01SEP', '31AUG', 'EXAMPLE STORE', '12.50', 140), row('01SEP', '31AUG', 'EXAMPLE STORE', '12.50', 155)], closing: '25.00' })];
  const first = parse(input, 'first'); const second = parse(input, 'second');
  assert.equal(new Set(first.transactions.map(t => t.id)).size, 2);
  const merged = mergeStatements([{ result: first }, { result: second }]);
  assert.equal(merged.transactions.length, 2); assert.equal(merged.duplicateCount, 2);
  assert.equal(merged.transactions[0].sources.length, 2);
  assert.equal(mergeStatements([{ result: second }]).transactions.length, 2);
});
test('different statement dates are not automatically deduplicated', () => {
  const first = parse([page()], 'first'); const second = parse([page({ date: '14 OCT 2026' })], 'second');
  assert.equal(mergeStatements([{ result: first }, { result: second }]).transactions.length, 2);
});
test('bad amount rows and reconciliation differences remain visible as warnings', () => {
  const result = parse([page({ rows: [row('01SEP', '31AUG', 'BAD AMOUNT', '12.5O', 140)] })]);
  assert.equal(result.transactions.length, 0); assert.ok(result.warnings.some(w => w.line?.includes('BAD AMOUNT')));
  assert.equal(result.sections[0].status, 'mismatch'); assert.equal(result.sections[0].difference, '-12.50');
});
test('missing balances do not pretend to be reconciled', () => {
  const result = parse([page({ opening: null })]);
  assert.equal(result.sections[0].status, 'unverified'); assert.ok(result.warnings.length > 0);
});
test('payment-slip title-case balance labels are not ledger balance rows', () => {
  const input = page({ closing: null });
  input.items.push(chunk('Statement balance', 250, 700));
  const result = parse([input, page({ number: 2, date: '', opening: null, rows: [], closing: '12.50' })]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.sections[0].status, 'matched');
});
test('image-only, unsupported PDFs and unknown table metadata fail explicitly', () => {
  assert.throws(() => parse([{ page: 1, width: 600, items: [] }]), /扫描件/);
  assert.throws(() => parse([{ page: 1, width: 600, items: [chunk('Unrelated PDF', 70, 30)] }]), /未识别/);
  assert.throws(() => parse([page({ date: '' })]), /未识别/);
});
