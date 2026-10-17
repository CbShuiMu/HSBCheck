export function filterTransactions(items, { search = '', direction = 'all', currency = 'all', from = '', to = '', sort = 'newest', sourceId = 'all', account = 'all', category = 'all' } = {}) {
  return items.filter(t => {
    const day = t.day;
    return (!search || `${t.description} ${t.reference} ${(t.notes || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
      && (direction === 'all' || t.direction === direction)
      && (currency === 'all' || t.currency === currency)
      && (!from || day >= from) && (!to || day <= to)
      && (sourceId === 'all' || t.sources?.some(source => source.sourceId === sourceId))
      && (account === 'all' || t.account === account) && (category === 'all' || t.category === category);
  }).sort((a, b) => sort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
}

// 使用五位小数的整数单位求和，按币种和收支方向分别累计，避免浮点误差。
export function sumAmounts(items, direction, currency) {
  const units = items.filter(t => t.direction === direction && t.currency === currency).reduce((total, t) => {
    const [whole, fraction = ''] = t.amount.split('.');
    return total + BigInt(whole) * 100000n + BigInt(fraction.padEnd(5, '0'));
  }, 0n);
  return `${units / 100000n}.${String(units % 100000n).padStart(5, '0')}`;
}

export function formatAmount(value, currency = 'HKD') {
  const fractionDigits = new Intl.NumberFormat('zh-HK', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const [whole, fraction = ''] = String(value).split('.');
  // 至少显示币种标准小数位，同时保留原始金额中额外的有效精度。
  const meaningfulFraction = fraction.replace(/0+$/, '');
  const decimals = Math.max(fractionDigits, meaningfulFraction.length);
  return `${BigInt(whole).toLocaleString('en-HK')}${decimals ? `.${fraction.padEnd(decimals, '0').slice(0, decimals)}` : ''}`;
}

export function toCsv(items) {
  const escape = value => {
    let text = String(value ?? '');
    // 给可能被电子表格解释为公式的文本加单引号，前导空白和控制字符也要检查。
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [['入账日期', '交易日期', '交易描述', '收支方向', '币种', '金额', '子账户', '结单日期', '交易说明', '来源文件', '来源页码', '参考编号'], ...items.map(t => [t.day, t.transactionDay || t.day, t.description, t.direction === 'debit' ? '支出' : '入账', t.currency, t.amount, t.account || '', t.statementDate || '', t.notes?.join(' / ') || '', t.sources?.map(s => s.fileName).join(' / ') || '虚构示例', t.sources?.map(s => s.page).join(' / ') || '', t.reference])].map(row => row.map(escape).join(',')).join('\r\n');
}
