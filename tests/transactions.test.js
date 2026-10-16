import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, formatAmount, sumAmounts, toCsv } from '../src/transactions.js';

const item = (overrides = {}) => ({ id: '1', description: 'Example coffee', reference: '第 1 页', day: '2026-09-01', date: '2026-09-01T00:00:00+08:00', transactionDay: '2026-08-31', amount: '0.10', currency: 'CNY', direction: 'debit', category: 'spend', account: 'CNY ···· 0004', statementDate: '2026-09-14', notes: ['APPLE PAY-MOBILE:1234'], sources: [{ sourceId: 'first', fileName: 'statement.pdf', page: 1 }], ...overrides });
test('precise totals separate directions and currencies', () => {
  const records = [item(), item({ amount: '0.20' }), item({ currency: 'HKD', amount: '999.00' }), item({ direction: 'credit', amount: '5.00' })];
  assert.equal(sumAmounts(records, 'debit', 'CNY'), '0.30000');
  assert.equal(sumAmounts(records, 'credit', 'CNY'), '5.00000');
  assert.equal(formatAmount('1234567890123.12345', 'CNY'), '1,234,567,890,123.12345');
  assert.equal(formatAmount('42.00000', 'JPY'), '42');
});
test('combines dates, source file, account, currency, direction and transaction type', () => {
  const records = [item(), item({ id: '2', direction: 'credit', category: 'repayment', day: '2026-09-02', date: '2026-09-02', sources: [{ sourceId: 'second' }] })];
  assert.equal(filterTransactions(records, { sourceId: 'first', account: 'CNY ···· 0004', currency: 'CNY', direction: 'debit', from: '2026-09-01', to: '2026-09-01', category: 'spend' }).length, 1);
  assert.equal(filterTransactions(records, { category: 'repayment' }).length, 1);
  assert.equal(filterTransactions(records, { sourceId: 'missing' }).length, 0);
  assert.equal(filterTransactions(records, { sort: 'oldest' })[0].id, '1');
});
test('search includes continuation notes and is case insensitive', () => {
  assert.equal(filterTransactions([item()], { search: 'COFFEE' }).length, 1);
  assert.equal(filterTransactions([item()], { search: 'apple pay' }).length, 1);
});
test('CSV includes both dates and all provenance, preserves unicode and escapes formulas', () => {
  const csv = toCsv([item({ description: ' =HYPERLINK("bad")', sources: [{ sourceId: 'first', fileName: '@SUM(1)', page: 4 }], reference: '+Formula' })]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('交易日期')); assert.ok(csv.includes('来源页码')); assert.ok(csv.includes('2026-08-31'));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\'@SUM(1)"')); assert.ok(csv.includes('"\'+Formula"'));
});
