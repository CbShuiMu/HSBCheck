// 所有商户、日期和金额均为虚构演示数据，不来自真实结单。
const entries = [
  ['2026-10-15', 'CITYSUPER · 铜锣湾', '628.50', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-15', 'BLUE BOTTLE COFFEE', '52.00', 'Debit', 'HKD', 'PDNG'],
  ['2026-10-14', 'MTR · 港铁', '18.60', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-14', 'APPLE.COM/BILL', '78.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-13', '诚品生活 · 尖沙咀', '246.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-12', '信用卡还款 · 示例', '5000.00', 'Credit', 'HKD', 'BOOK'],
  ['2026-10-12', '鼎泰丰 · 铜锣湾', '386.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-11', 'UNIQLO HONG KONG', '399.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-10', 'SPOTIFY PREMIUM', '68.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-09', 'MUJI · 无印良品', '159.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-08', '商户退款 · 示例', '128.00', 'Credit', 'HKD', 'BOOK'],
  ['2026-10-07', 'AMAZON.COM', '29.99', 'Debit', 'USD', 'BOOK'],
  ['2026-10-06', '万宁 MANNINGS', '218.90', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-05', 'STAR FERRY · 天星小轮', '5.00', 'Debit', 'HKD', 'BOOK'],
  ['2026-10-15', '示例 · ALIPAY 内地消费', '12000.00', 'Debit', 'CNY', 'BOOK'],
  ['2026-10-14', '示例 · APPLE PAY 内地消费', '9000.00', 'Debit', 'CNY', 'BOOK'],
  ['2026-10-13', '示例 · UNIONPAY QR 内地消费', '3000.00', 'Debit', 'CNY', 'BOOK'],
  ['2026-10-12', '示例 · APPLE PAY 退款', '500.00', 'Credit', 'CNY', 'BOOK'],
  ['2026-10-11', '示例 · 信用卡还款', '5000.00', 'Credit', 'CNY', 'BOOK'],
];

export const demoTransactions = entries.map(([day, description, amount, direction, currency], index) => ({
  id: `DEMO-${index}`, date: `${day}T00:00:00+08:00`, day, transactionDay: day,
  description, amount, direction: direction === 'Credit' ? 'credit' : 'debit', currency,
  merchantCountryCode: currency === 'CNY' ? 'CN' : currency === 'USD' ? 'US' : 'HK',
  category: direction === 'Credit' ? (description.includes('还款') ? 'repayment' : 'credit') : 'spend',
  status: 'booked', bankStatus: '虚构示例', reference: `SAMPLE-${1000 + index}`,
}));
