const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_PATTERN = MONTHS.join('|');
const FULL_DATE = new RegExp(`\\b(\\d{1,2})\\s*(${MONTH_PATTERN})\\s*(20\\d{2})\\b`, 'i');
const SHORT_DATE = new RegExp(`^(\\d{1,2})\\s*(${MONTH_PATTERN})$`, 'i');
const MONEY = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(CR|DR)?$/i;

export function parseMoney(text) {
  const match = String(text).trim().match(MONEY);
  if (!match) return null;
  return { amount: `${match[2].replaceAll(',', '')}.${match[3]}`, direction: match[1] || match[4]?.toUpperCase() === 'CR' ? 'credit' : 'debit' };
}
export const cents = amount => { const [whole, fraction = ''] = amount.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const decimal = value => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;
const signedBalance = money => money.direction === 'credit' ? -cents(money.amount) : cents(money.amount);
const compact = value => value.replace(/\s+/g, '');
const join = items => items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();

// Group by baseline and then x coordinate, rather than relying on PDF text-stream order.
export function groupTextLines(items) {
  const lines = [];
  for (const item of items.filter(item => item.text?.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.at(-1);
    if (!line || Math.abs(item.y - line.y) > 2.5) { line = { y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => ({ ...line, items: line.items.sort((a, b) => a.x - b.x), text: join(line.items.sort((a, b) => a.x - b.x)) }));
}

function dateParts(day, month, year) {
  const result = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${result}T00:00:00Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? result : null;
}
export function inferDate(text, statementDate) {
  const match = text.trim().match(SHORT_DATE);
  if (!match || !statementDate) return null;
  const month = MONTHS.indexOf(match[2].toUpperCase());
  let year = Number(statementDate.slice(0, 4));
  // Statements list day/month only. A December entry in a January statement is last year.
  if (month + 1 > Number(statementDate.slice(5, 7))) year--;
  const day = dateParts(Number(match[1]), month, year);
  return day && day <= statementDate ? day : null;
}

// Used only as a local grouping key, not as a security or authentication mechanism.
function accountKey(number) { let hash = 2166136261; for (const char of number) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `${hash >>> 0}-${number.slice(-4)}`; }
function classify(description, direction) {
  if (direction === 'credit') return /PAYMENT|AUTOPAY|还款|還款/i.test(description) ? 'repayment' : 'credit';
  return /(?:ANNUAL|LATE|FINANCE|HANDLING)\s+(?:FEE|CHARGE)|INTEREST|年费|年費|利息/i.test(description) ? 'fee' : 'spend';
}

export function parseStatementPages(pages, { sourceId, fileName }) {
  const sections = new Map();
  const transactions = [];
  const warnings = [];
  const occurrences = new Map();
  let statementDate = '';
  let tablePages = 0;
  let textCount = 0;
  for (const page of pages) {
    const lines = groupTextLines(page.items);
    textCount += lines.reduce((count, line) => count + line.text.length, 0);
    const header = lines.find(line => /post\s*date/i.test(line.text) && /trans\s*date/i.test(line.text));
    if (!header) continue;
    tablePages++;
    const headingText = lines.filter(line => line.y < header.y).map(line => line.text).join(' ');
    const dateMatch = headingText.match(FULL_DATE);
    if (dateMatch) statementDate = dateParts(Number(dateMatch[1]), MONTHS.indexOf(dateMatch[2].toUpperCase()), Number(dateMatch[3])) || '';
    const accountMatch = compact(headingText).match(/Accountnumber(\d{12,19})(HKD|RMB|CNY)Sub-?account/i);
    const headerCurrency = lines.filter(line => Math.abs(line.y - header.y) < 6).map(line => compact(line.text)).join('').match(/Amount\((HKD|CNY|RMB|USD)\)/i)?.[1]?.toUpperCase();
    const currency = (headerCurrency || accountMatch?.[2]?.toUpperCase())?.replace('RMB', 'CNY');
    if (!accountMatch || !statementDate || !currency) {
      warnings.push({ page: page.page, message: '未能识别交易表的账户、币种或结单日期；该页未计入交易。' });
      continue;
    }
    const last4 = accountMatch[1].slice(-4);
    const identity = `${accountKey(accountMatch[1])}:${currency}:${statementDate}`;
    if (!sections.has(identity)) sections.set(identity, { id: identity, last4, currency, statementDate, opening: null, closing: null, transactionCount: 0, pages: [] });
    const section = sections.get(identity);
    section.pages.push(page.page);
    let previous = null;
    for (const line of lines.filter(line => line.y > header.y + 4)) {
      const post = join(line.items.filter(item => item.x < page.width * .165));
      const trans = join(line.items.filter(item => item.x >= page.width * .165 && item.x < page.width * .225));
      const description = join(line.items.filter(item => item.x >= page.width * .225 && item.x < page.width * .80));
      const amountText = compact(join(line.items.filter(item => item.x >= page.width * .80)));
      // The table uses uppercase markers. The payment slip's title-case
      // "Statement balance" label is outside the ledger and is not a balance row.
      const balance = description.match(/^(PREVIOUS\s+BALANCE|STATEMENT\s+BALANCE)\b/);
      if (balance) {
        const money = parseMoney(amountText);
        if (money) {
          const field = /^PREVIOUS/i.test(balance[1]) ? 'opening' : 'closing';
          if (section[field] !== null && section[field] !== decimal(signedBalance(money))) warnings.push({ page: page.page, message: '同一结单内出现不一致的结欠，请核对原件。' });
          section[field] = decimal(signedBalance(money));
        } else warnings.push({ page: page.page, message: '未能识别结欠金额，无法完成余额核对。' });
        previous = null;
        if (/^STATEMENT/i.test(balance[1])) break;
        continue;
      }
      const dateCandidate = /^\d{1,2}\s*[A-Z]{3}/i.test(post);
      if (!dateCandidate) {
        // Keep card-wallet or wrapped merchant continuation lines with their original entry.
        if (previous && line.y - previous.y <= 15 && !post && !trans && description && !/SUMMARY|REWARDCASH|BALANCE|FEES|REGISTRATION|REGISTERED|FOR TERMS|THE ABOVE/i.test(description) && !/^\d[\d\s]{11,}/.test(description)) {
          previous.transaction.notes.push([description, amountText].filter(Boolean).join(' '));
          previous.transaction.rawLine += `\n${line.text}`;
          previous.y = line.y;
        } else previous = null;
        continue;
      }
      const money = parseMoney(amountText);
      const day = inferDate(post, statementDate);
      const transactionDay = inferDate(trans, statementDate);
      if (!money || !day || !transactionDay || !description) {
        warnings.push({ page: page.page, message: '一行交易的日期、描述或金额无法可靠识别，未计入汇总。', line: line.text });
        previous = null;
        continue;
      }
      const signature = JSON.stringify([identity, day, transactionDay, description, money.amount, money.direction]);
      const occurrence = (occurrences.get(signature) || 0) + 1;
      occurrences.set(signature, occurrence);
      const transaction = {
        id: `${signature}:${occurrence}`, date: `${day}T00:00:00+08:00`, day, transactionDay,
        description, ...money, currency, category: classify(description, money.direction),
        status: 'booked', bankStatus: '结单已记账', reference: `第 ${page.page} 页`,
        last4, account: `${currency} ···· ${last4}`, statementDate, sectionId: identity,
        notes: [], rawLine: line.text,
        sources: [{ sourceId, fileName, page: page.page }],
      };
      transactions.push(transaction); section.transactionCount++;
      previous = { transaction, y: line.y };
    }
  }
  if (!textCount) throw new Error('PDF 没有可读取的文字。扫描件或图片结单暂不支持，请导入银行下载的文字版 PDF。');
  if (!sections.size) throw new Error('未识别到支持的 HSBC 信用卡结单表格。请使用原始电子结单；当前支持所提供的 Pulse 双币卡英文版式。');
  const reconciliations = [...sections.values()].map(section => {
    const entries = transactions.filter(t => t.sectionId === section.id);
    const net = entries.reduce((sum, t) => sum + (t.direction === 'debit' ? cents(t.amount) : -cents(t.amount)), 0n);
    const toSignedCents = value => value.startsWith('-') ? -cents(value.slice(1)) : cents(value);
    const difference = section.opening !== null && section.closing !== null ? toSignedCents(section.opening) + net - toSignedCents(section.closing) : null;
    const status = difference === null ? 'unverified' : difference === 0n ? 'matched' : 'mismatch';
    if (status !== 'matched') warnings.push({ page: section.pages[0], message: `${section.currency} 尾号 ${section.last4}：${status === 'mismatch' ? `结欠核对差额 ${decimal(difference)}，请检查是否有未识别交易。` : '缺少上期或本期结欠，暂不能完成余额核对。'}` });
    return { ...section, status, difference: difference === null ? null : decimal(difference) };
  });
  return { transactions, sections: reconciliations, warnings, pageCount: pages.length, tablePages, statementDates: [...new Set(reconciliations.map(section => section.statementDate))] };
}

export function mergeStatements(documents) {
  const map = new Map();
  let duplicateCount = 0;
  for (const document of documents) {
    for (const transaction of document.result?.transactions || []) {
      if (map.has(transaction.id)) {
        duplicateCount++;
        const old = map.get(transaction.id);
        map.set(transaction.id, { ...old, sources: [...old.sources, ...transaction.sources] });
      } else map.set(transaction.id, { ...transaction, sources: [...transaction.sources] });
    }
  }
  return { transactions: [...map.values()], duplicateCount };
}
