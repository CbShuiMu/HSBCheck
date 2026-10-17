import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, ChevronRight, ChevronLeft, ChevronDown, CreditCard, Search, Download, ShieldCheck, X, CircleHelp, ExternalLink, Globe2, LockKeyhole, FileText, SlidersHorizontal, Check, LoaderCircle, AlertCircle, RotateCcw, ReceiptText, UploadCloud, Files, Trash2, FileCheck2 } from 'lucide-react';
import { filterTransactions, formatAmount, sumAmounts, toCsv } from './transactions';
import { mergeStatements } from './statements';
import { demoTransactions } from './demo';
import RewardsCard from './RewardsCard';
import RewardAdjustment, { PaymentBadge } from './RewardAdjustment';

const EMPTY_FILTERS = { search: '', direction: 'all', currency: 'all', from: '', to: '', sort: 'newest', sourceId: 'all', account: 'all', category: 'all' };
const CATEGORY = { spend: '消费', credit: '退款 / 入账', repayment: '还款', fee: '费用' };
const shortDate = day => day ? `${day.slice(5, 7)}/${day.slice(8, 10)}` : '未提供';
function Brand() {
  return <a className="brand" href="#" aria-label="HSB Check 首页"><span className="brand-symbol" aria-hidden="true"><i/><i/></span><span>HSB<span className="brand-light"> Check</span></span></a>;
}
function Modal({ title, children, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="modal" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={21}/></button></div>{children}</dialog>;
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [summaryCurrency, setSummaryCurrency] = useState('HKD');
  const [expandedFilters, setExpandedFilters] = useState(false);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [rewardOverrides, setRewardOverrides] = useState({});
  const fileInput = useRef(null);
  const docsRef = useRef([]);
  const controller = useRef(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const dragDepth = useRef(0);
  const previewUrls = useRef(new Set());
  const ready = documents.filter(document => document.result);
  const merged = useMemo(() => mergeStatements(documents), [documents]);
  const records = demo ? demoTransactions : merged.transactions;
  const hasData = demo || ready.length > 0;
  const currencies = useMemo(() => [...new Set(records.map(t => t.currency))].sort(), [records]);
  const accounts = useMemo(() => [...new Set(records.map(t => t.account).filter(Boolean))].sort(), [records]);
  const filtered = useMemo(() => filterTransactions(records, filters), [records, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const visible = filtered.slice((Math.min(page, pages) - 1) * 10, Math.min(page, pages) * 10);
  const warningCount = ready.reduce((count, document) => count + document.result.warnings.length, 0);
  const currentDocument = documents.find(document => document.id === modal?.documentId);
  const activeFilters = filters.search || filters.direction !== 'all' || filters.currency !== 'all' || filters.from || filters.to || filters.sourceId !== 'all' || filters.account !== 'all' || filters.category !== 'all';
  useEffect(() => { if (currencies.length && !currencies.includes(summaryCurrency)) setSummaryCurrency(currencies[0]); }, [currencies, summaryCurrency]);
  useEffect(() => { setPage(current => Math.min(current, pages)); }, [pages]);
  useEffect(() => () => { controller.current?.abort(); previewUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const commitDocuments = next => { docsRef.current = next; setDocuments(next); };
  const updateDocument = (id, patch) => commitDocuments(docsRef.current.map(document => document.id === id ? { ...document, ...patch } : document));
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const changeFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setPage(1); };

  async function processEntries(entries, suppliedPassword) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setDemo(false); setNotice(''); setError('');
    // 用批次序号屏蔽清除操作之前的异步回调，避免旧结果重新写回页面。
    const sequence = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      for (const entry of entries) {
        if (generation.current !== sequence || !docsRef.current.some(document => document.id === entry.id)) continue;
        updateDocument(entry.id, { status: 'parsing', error: '', progress: '正在读取 PDF…' });
        try {
          // 首次导入才加载 PDF.js，让初始页面免于下载较大的解析器。
          const { readStatement } = await import('./pdf');
          const result = await readStatement(entry.file, {
            sourceId: entry.id, password: suppliedPassword, signal: abort.signal,
            onProgress: (current, total) => { if (generation.current === sequence) updateDocument(entry.id, { progress: `正在解析 ${current} / ${total} 页` }); },
          });
          if (generation.current !== sequence) return;
          const sameFile = docsRef.current.some(document => document.id !== entry.id && document.result?.fingerprint === result.fingerprint);
          updateDocument(entry.id, { result, status: result.warnings.length ? 'review' : 'ready', progress: '', sameFile });
        } catch (problem) {
          if (generation.current !== sequence) return;
          updateDocument(entry.id, { status: problem.code === 'password' ? 'locked' : 'error', error: problem.message || 'PDF 无法读取，请检查文件是否完整。', progress: '' });
        }
      }
    } finally { if (generation.current === sequence) { busy.current = false; setLoading(false); } }
  }
  function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (busy.current) { setNotice('正在解析当前批次，完成后可继续添加结单。'); return; }
    if (docsRef.current.length + files.length > 20) { setError('当前页面最多导入 20 份结单，请先移除部分文件。'); return; }
    if ([...docsRef.current.map(document => document.file), ...files].reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) { setError('文件总量超过 100 MB，请减少本批次文件。'); return; }
    const entries = files.map(file => ({ id: crypto.randomUUID(), file, name: file.name, status: 'queued', result: null, error: '' }));
    commitDocuments([...docsRef.current, ...entries]); resetFilters(); void processEntries(entries);
  }
  function clear() {
    generation.current++; controller.current?.abort(); busy.current = false; setLoading(false);
    commitDocuments([]); setDemo(false); setSelected(null); setModal(null); setPassword(''); setRewardOverrides({}); setError(''); resetFilters();
    previewUrls.current.forEach(url => URL.revokeObjectURL(url)); previewUrls.current.clear();
    setNotice('已清除本次导入的文件和交易数据。');
  }
  function removeDocument(id) {
    commitDocuments(docsRef.current.filter(document => document.id !== id)); resetFilters();
    setNotice('已移除结单，并重新汇总其余文件。');
  }
  function toggleDemo() { if (!busy.current) { setDemo(current => !current); resetFilters(); setError(''); setNotice(''); } }
  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `hsb-check-${demo ? '示例-' : ''}statements.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice(`已导出当前筛选的 ${filtered.length} 笔${demo ? '示例' : ''}交易及其来源。`);
  }
  function openOriginal(source) {
    const document = docsRef.current.find(document => document.id === source.sourceId);
    if (!document) return;
    const url = URL.createObjectURL(document.file); previewUrls.current.add(url);
    window.open(`${url}#page=${source.page}`, '_blank', 'noopener,noreferrer');
    setTimeout(() => { URL.revokeObjectURL(url); previewUrls.current.delete(url); }, 60000);
  }

  return <>
    <div className="utility"><div className="container utility-inner"><span>独立开发 · 非汇丰官方网站</span><span><Globe2 size={13}/> 中国香港 <span className="utility-divider"/> 简体中文</span></div></div>
    <header className="header"><div className="container header-inner"><Brand/><nav aria-label="主导航"><a className="active" href="#overview">结单交易</a><button onClick={() => setModal({ type: 'help' })}>使用指南</button></nav><button className="header-settings" aria-label="导入结单" onClick={() => fileInput.current?.click()} disabled={loading}><UploadCloud size={18}/><span>导入结单</span></button></div></header>
    <main id="overview" className={`container main ${dragging ? 'dragging' : ''}`}
      onDragEnter={event => { event.preventDefault(); if ([...event.dataTransfer.types].includes('Files')) { dragDepth.current++; setDragging(true); } }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); importFiles(event.dataTransfer.files); }}>
      <div className="breadcrumb">账户服务 <ChevronRight size={12}/> 结单交易</div>
      <section className="intro"><div><div className="intro-title"><span className="title-rule"/><h1>每笔交易，清晰有数。</h1></div><p>拖入电子结单，将每一笔收支整理成清晰明细。</p></div><div className="intro-tag"><ShieldCheck size={17}/><span>PDF 本地解析 · 文件不会上传</span></div></section>
      <input className="sr-only" id="statement-files" aria-label="选择一个或多个 PDF 结单" ref={fileInput} type="file" accept=".pdf,application/pdf" multiple disabled={loading} onChange={event => { importFiles(event.target.files); event.target.value = ''; }}/>
      <div className="workspace"><aside className="sidebar">
        <section className="connect-panel import-panel" aria-labelledby="import-title">
          <div className="panel-top"><span className="icon-square"><Files size={23}/></span><span className={`connection-dot ${ready.length && !demo ? 'connected' : ''}`}>{loading ? '正在解析' : ready.length ? `已导入 ${ready.length} 份` : '本地处理'}</span></div>
          <h2 id="import-title">导入信用卡结单</h2><p className="muted">一次整理多个月份，逐笔查看消费。</p>
          <button className="drop-zone" onClick={() => fileInput.current?.click()} disabled={loading} aria-label="拖入或选择一个或多个 PDF 结单"><UploadCloud size={33} strokeWidth={1.4}/><strong>{dragging ? '松开以导入结单' : '拖放 PDF 结单到这里'}</strong><span>或点击选择文件 · 支持多选</span><small>每份 ≤ 25 MB · 最多 20 份</small></button>
          <button className="button primary query-button" onClick={() => fileInput.current?.click()} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17}/>正在解析结单</> : <><UploadCloud size={17}/>{documents.length ? '继续添加结单' : '选择 PDF 结单'}<ArrowRight size={18}/></>}</button>
          <p className="import-caption">支持 HSBC Pulse 双币卡文字版电子结单。<br/>扫描件暂不支持，密码结单可在导入后解锁。</p>
          <div className="demo-divider"><span>先了解整理效果</span></div><button className="button secondary demo-button" onClick={toggleDemo} disabled={loading}>{demo ? '返回我的结单' : '查看示例数据'}<ChevronRight size={16}/></button>
        </section>
        {documents.length > 0 && <section className="file-list" aria-label="已导入文件"><div className="files-heading"><h3>本次结单 <span>{documents.length}</span></h3>{loading && <LoaderCircle className="spin" size={14}/>}</div>{documents.map(document => <div className={`file-item file-${document.status}`} key={document.id}>
          <div className="file-name"><FileText size={15}/><strong title={document.name}>{document.name}</strong><button aria-label={`移除 ${document.name}`} disabled={document.status === 'parsing'} onClick={() => removeDocument(document.id)}><X size={14}/></button></div>
          <p className="file-status">{document.status === 'parsing' ? <><LoaderCircle className="spin" size={12}/>{document.progress}</> : document.status === 'queued' ? '等待解析' : document.status === 'ready' ? <><Check size={12}/>{document.result.transactions.length} 笔 · 结欠核对一致</> : document.status === 'review' ? <><AlertCircle size={12}/>{document.result.transactions.length} 笔 · 需要核对</> : document.status === 'locked' ? <><LockKeyhole size={12}/>需要 PDF 密码</> : <><AlertCircle size={12}/>解析失败</>}</p>
          {document.sameFile && <p className="file-hint">相同文件的交易已合并，未重复计数。</p>}{document.error && <p className="file-error">{document.error}</p>}
          <div className="file-actions">{document.result && <button className="text-button" onClick={() => setModal({ type: 'document', documentId: document.id })}>查看解析报告<ChevronRight size={12}/></button>}{document.status === 'locked' && <button className="text-button" disabled={loading} onClick={() => { setPassword(''); setModal({ type: 'password', documentId: document.id }); }}>输入密码<ChevronRight size={12}/></button>}</div>
        </div>)}</section>}
        <section className="privacy-panel"><LockKeyhole size={21}/><h3>您的结单，留在您手中</h3><p>PDF、密码和交易仅在浏览器中处理。刷新或关闭页面即可清除。</p><button className="text-button" onClick={clear}><Trash2 size={13}/>{loading ? '取消并清除本次数据' : '清除本次数据'}<ChevronRight size={14}/></button></section>
      </aside><div className="content">
        {demo && <div className="demo-banner"><span><span className="demo-label">示例预览</span>当前为虚构交易，您的结单数据未混入示例。</span><button onClick={toggleDemo} aria-label="退出示例预览"><X size={17}/></button></div>}
        {error && <div className="error-banner" role="alert"><AlertCircle size={20}/><div><strong>无法导入本批次</strong><p>{error}</p></div></div>}
        {notice && <div className="notice" role="status"><Check size={16}/>{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
        {!demo && warningCount > 0 && <div className="review-banner" role="status"><AlertCircle size={18}/><p>有 {warningCount} 项解析或结欠核对提示。请在左侧“解析报告”中核对；未识别的行不会计入汇总。</p></div>}
        {!demo && merged.duplicateCount > 0 && <div className="notice"><Files size={16}/>已合并重复结单中的 {merged.duplicateCount} 笔记录。同一结单内相同金额的多笔交易仍各自保留。</div>}
        <RewardsCard records={records} cards={demo ? [] : ready.flatMap(document => document.result.cards || [])} overrides={rewardOverrides} hasData={hasData} demo={demo}/>
        <section className="overview" aria-labelledby="summary-title"><div className="section-heading"><div><h2 id="summary-title">交易概览</h2><p>{demo ? '虚构示例账户 · 2026 年 10 月' : hasData ? `${ready.length} 份结单 · ${new Set(records.map(t => t.statementDate)).size} 个结单日 · 按当前筛选汇总` : '导入结单后，查看您的收支概况'}</p></div><label className="currency-selector"><span className="sr-only">概览币种</span><select value={summaryCurrency} onChange={event => setSummaryCurrency(event.target.value)}>{(currencies.length ? currencies : ['HKD']).map(currency => <option key={currency}>{currency}</option>)}</select><ChevronDown size={13}/></label></div>
          <div className="summary-strip"><div className="summary-cell"><span className="stat-label"><ArrowUpRight size={15}/>支出总额</span><div className="stat-amount"><small>{summaryCurrency}</small>{hasData ? formatAmount(sumAmounts(filtered, 'debit', summaryCurrency), summaryCurrency) : '—'}</div><span className="stat-note">当前筛选 · 含消费及费用</span></div><div className="summary-cell"><span className="stat-label"><ArrowDownLeft size={15}/>入账总额</span><div className="stat-amount"><small>{summaryCurrency}</small>{hasData ? formatAmount(sumAmounts(filtered, 'credit', summaryCurrency), summaryCurrency) : '—'}</div><span className="stat-note">包含还款、退款及其他入账</span></div><div className="summary-cell count-cell"><span className="stat-label"><ReceiptText size={15}/>交易笔数</span><div className="stat-amount">{hasData ? filtered.length : '—'}<small>笔</small></div><span className="stat-note">{hasData ? `共整理 ${records.length} 笔交易` : '等待导入结单'}</span></div></div>
          {currencies.length > 1 && <p className="currency-note">不同币种分别汇总，不做汇率换算。</p>}
        </section>
        <section className="transactions-panel" aria-labelledby="transactions-title"><div className="transaction-heading"><div><h2 id="transactions-title">交易明细<span className="count-badge">{filtered.length}</span></h2><p>{demo ? '虚构数据，仅展示界面功能' : hasData ? '每笔记录都可追溯至原始结单和页码' : '让每一笔收支，都有迹可循'}</p></div><button className="export-button" onClick={exportCsv} disabled={!filtered.length || loading}><Download size={16}/><span>导出 CSV</span></button></div>
          <div className="filter-toolbar"><div className="search-field"><Search size={17}/><input aria-label="搜索交易描述或说明" placeholder="搜索商户、交易描述或说明" value={filters.search} onChange={event => changeFilter('search', event.target.value)}/>{filters.search && <button aria-label="清除搜索" onClick={() => changeFilter('search', '')}><X size={14}/></button>}</div><select aria-label="收支类型" value={filters.direction} onChange={event => changeFilter('direction', event.target.value)}><option value="all">全部收支</option><option value="debit">支出</option><option value="credit">入账</option></select><button className={`filter-button ${expandedFilters ? 'selected' : ''}`} onClick={() => setExpandedFilters(!expandedFilters)} aria-label="筛选" aria-expanded={expandedFilters}><SlidersHorizontal size={16}/><span>筛选</span></button></div>
          {expandedFilters && <div className="advanced-filters"><label>开始日期<input aria-label="开始日期" type="date" value={filters.from} onChange={event => changeFilter('from', event.target.value)} max={filters.to || undefined}/></label><label>结束日期<input aria-label="结束日期" type="date" value={filters.to} onChange={event => changeFilter('to', event.target.value)} min={filters.from || undefined}/></label><label>币种<select aria-label="筛选币种" value={filters.currency} onChange={event => changeFilter('currency', event.target.value)}><option value="all">全部币种</option>{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label><label>交易类型<select aria-label="交易类型" value={filters.category} onChange={event => changeFilter('category', event.target.value)}><option value="all">全部类型</option>{Object.entries(CATEGORY).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>来源结单<select aria-label="来源结单" value={filters.sourceId} onChange={event => changeFilter('sourceId', event.target.value)}><option value="all">全部结单</option>{!demo && ready.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label><label>子账户<select aria-label="子账户" value={filters.account} onChange={event => changeFilter('account', event.target.value)}><option value="all">全部子账户</option>{accounts.map(account => <option key={account}>{account}</option>)}</select></label><button className="text-button reset-filters" onClick={resetFilters}><RotateCcw size={14}/>重置</button></div>}
          {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="filter-error">开始日期不能晚于结束日期。</p>}
          <div className="table-scroll"><table><thead><tr><th><button onClick={() => changeFilter('sort', filters.sort === 'newest' ? 'oldest' : 'newest')}>入账日期<ChevronDown className={filters.sort === 'oldest' ? 'rotate' : ''} size={13}/></button></th><th>交易描述 / 来源</th><th>类型</th><th className="amount-header">金额</th><th><span className="sr-only">查看详情</span></th></tr></thead><tbody>{visible.map(transaction => <tr key={transaction.id}><td className="date-cell">{shortDate(transaction.day)}<span>{transaction.day.slice(0, 4)}</span></td><td><div className="merchant-cell"><span className={`merchant-icon ${transaction.direction === 'credit' ? 'credit-icon' : ''}`}>{transaction.direction === 'credit' ? <ArrowDownLeft size={18}/> : <CreditCard size={17}/>}</span><div><strong>{transaction.description}</strong><span>{transaction.account || '示例账户'}<span className="reference"> · {transaction.sources ? `第 ${transaction.sources[0].page} 页 · ${transaction.statementDate}` : '虚构示例'}</span></span><PaymentBadge transaction={transaction} override={rewardOverrides[transaction.id]}/></div></div></td><td><span className={`status ${transaction.direction === 'credit' ? 'status-credit' : ''}`}>{CATEGORY[transaction.category] || (transaction.direction === 'credit' ? '入账' : '支出')}</span></td><td className={`amount-cell ${transaction.direction === 'credit' ? 'credit-amount' : ''}`}><span>{transaction.direction === 'credit' ? '+' : '−'} {formatAmount(transaction.amount, transaction.currency)}</span><small>{transaction.currency}</small></td><td><button className="row-button" aria-label={`查看 ${transaction.description} 的交易详情`} onClick={() => setSelected(transaction)}><ChevronRight size={17}/></button></td></tr>)}</tbody></table></div>
          {loading && !records.length ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={34}/><h3>正在读取结单</h3><p>逐页提取文字，整理交易并核对结欠。</p></div> : !filtered.length && <div className="empty-state"><span className="empty-illustration"><FileText size={42} strokeWidth={1.2}/><span><Search size={20}/></span></span><h3>{!hasData ? '将结单拖入，即可开始' : activeFilters ? '没有符合条件的交易' : '结单中没有交易记录'}</h3><p>{!hasData ? '支持一次导入多个 PDF，全程在浏览器内解析。' : activeFilters ? '试试其他关键词，或调整筛选条件。' : '已识别结单，请在解析报告中查看核对结果。'}</p>{!hasData ? <button className="text-button" onClick={() => fileInput.current?.click()}>选择 PDF 结单<UploadCloud size={15}/></button> : activeFilters && <button className="text-button" onClick={resetFilters}>清除筛选<RotateCcw size={14}/></button>}</div>}
          <div className="table-footer"><span>{filtered.length ? `第 ${(Math.min(page, pages) - 1) * 10 + 1}–${Math.min(page * 10, filtered.length)} 笔，共 ${filtered.length} 笔` : '暂无记录'}</span><div className="pagination"><button aria-label="上一页" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft size={16}/></button><span>{Math.min(page, pages)} / {pages}</span><button aria-label="下一页" onClick={() => setPage(current => Math.min(pages, current + 1))} disabled={page >= pages}><ChevronRight size={16}/></button></div></div>
        </section>
        <div className="connection-note"><CircleHelp size={17}/><p>解析结果以原始结单为准。CR 记为入账；上期结欠、积分和汇总不会当作交易。<button onClick={() => setModal({ type: 'help' })}>了解解析规则<ChevronRight size={12}/></button></p></div>
      </div></div>
    </main>
    <footer className="footer"><div className="container footer-inner"><div><Brand/><span>让结单记录更清楚。</span></div><p>本工具独立开发，与 HSBC 无隶属或认可关系。<br/>文件仅在本地处理，交易以原始结单为准。</p><button onClick={() => setModal({ type: 'help' })}>使用与隐私说明<ExternalLink size={13}/></button></div></footer>
    {modal?.type === 'help' && <Modal title="使用与隐私说明" onClose={() => setModal(null)}><div className="help-content"><h3>如何导入结单？</h3><p>拖入一份或多份 PDF，或点击选择。每份最多 25 MB、200 页，页面最多 20 份，总量不超过 100 MB。一份失败不会阻止其他文件；密码 PDF 可在文件列表中解锁。</p><h3>支持什么版式？</h3><p>当前支持 HSBC Pulse 双币卡英文文字版电子结单，识别入账日、交易日、描述、CR 入账及 HKD/CNY 子账户，支持跨年和跨页。扫描件、图片及其他银行或版式暂不保证支持。</p><h3>如何核对完整性？</h3><p>每个子账户检查“上期结欠＋支出－入账＝本期结欠”。缺少字段、无法识别的交易行或金额差异会出现在解析报告。余额一致是核对线索，仍以原件为准。结欠、积分、汇总与宣传内容不计为交易。</p><h3>重复交易如何处理？</h3><p>同一账户、币种和结单日的重复导入按交易出现次数合并来源。同一天、同一商户、同一金额的多笔真实交易各自保留。不同结单日不自动去重；可筛选来源并移除文件。</p><h3>交易类型是什么意思？</h3><p>CR 或负号记为入账；含 PAYMENT、AUTOPAY 等描述的入账标为还款，其余标为退款 / 入账；费用依据描述关键词识别。分类不改变原始金额和方向，可在详情中核对原文。</p><h3>数据会上传吗？</h3><p>不会。解析器、字体与资源由本网站提供，文件在浏览器内处理，不调用银行 API、OCR、AI 或上传接口，不写入浏览器持久存储。公开汇率请求只包含 HKD/CNY 币种，不发送文件、交易或账户信息。密码仅用于本次解密。刷新或清除会移除页面数据；已导出的 CSV 需要自行管理。</p></div></Modal>}
    {modal?.type === 'password' && currentDocument && <Modal title="解锁 PDF 结单" onClose={() => { setModal(null); setPassword(''); }}><p className="modal-description">{currentDocument.name}<br/>密码仅用于本次本地解密，不保存或上传。</p><form onSubmit={event => { event.preventDefault(); const value = password; setPassword(''); setModal(null); void processEntries([currentDocument], value); }}><label htmlFor="pdf-password">结单密码</label><input id="pdf-password" type="password" value={password} autoComplete="off" autoFocus required onChange={event => setPassword(event.target.value)}/><button className="button primary full-width" type="submit">解锁并解析<LockKeyhole size={17}/></button></form></Modal>}
    {modal?.type === 'document' && currentDocument?.result && <Modal title="结单解析报告" onClose={() => setModal(null)}><div className="report-summary"><FileCheck2 size={25}/><div><strong>{currentDocument.name}</strong><p>{currentDocument.result.pageCount} 页 · {currentDocument.result.transactions.length} 笔交易 · {currentDocument.result.tablePages} 页交易表</p></div></div>{currentDocument.result.sections.map(section => <div className="reconciliation" key={section.id}><div><strong>{section.currency} ···· {section.last4}</strong><span className={section.status === 'matched' ? 'matched' : 'needs-review'}>{section.status === 'matched' ? '结欠一致' : '需要核对'}</span></div><p>结单日 {section.statementDate} · {section.transactionCount} 笔</p><dl><div><dt>上期结欠</dt><dd>{section.opening ?? '未识别'}</dd></div><div><dt>本期结欠</dt><dd>{section.closing ?? '未识别'}</dd></div><div><dt>核对差额</dt><dd>{section.difference ?? '无法核对'}</dd></div></dl></div>)}{currentDocument.result.warnings.length ? <div className="report-warnings"><h3>请核对以下内容</h3>{currentDocument.result.warnings.map((warning, index) => <div key={index}><p>第 {warning.page} 页：{warning.message}</p>{warning.line && <pre>{warning.line}</pre>}</div>)}</div> : <p className="report-success"><Check size={16}/>已识别子账户的结欠核对一致，仍请与原件核对。</p>}<button className="button secondary full-width" onClick={() => openOriginal({ sourceId: currentDocument.id, page: 1 })}>打开原始结单<ExternalLink size={15}/></button></Modal>}
    {selected && <Modal title="交易详情" onClose={() => setSelected(null)}>{demo && <p className="detail-demo">虚构示例数据</p>}<div className={`detail-amount ${selected.direction === 'credit' ? 'credit-amount' : ''}`}><small>{selected.currency}</small>{selected.direction === 'credit' ? '+' : '−'} {formatAmount(selected.amount, selected.currency)}</div><dl className="detail-list">{[['交易描述', selected.description], ['入账日期', selected.day], ['交易日期', selected.transactionDay || selected.day], ['收支方向', selected.direction === 'credit' ? '入账' : '支出'], ['交易类型', CATEGORY[selected.category] || '示例交易'], ['子账户', selected.account || '虚构示例'], ['结单日期', selected.statementDate || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{selected.notes?.length > 0 && <div className="source-text"><h3>交易续行说明</h3>{selected.notes.map((note, index) => <p key={index}>{note}</p>)}</div>}<RewardAdjustment transaction={selected} value={rewardOverrides[selected.id]} onChange={value => setRewardOverrides(current => ({ ...current, [selected.id]: value }))}/>{selected.rawLine && <div className="source-text"><h3>结单原始文字</h3><pre>{selected.rawLine}</pre></div>}{selected.sources?.map(source => <button className="source-button" key={source.sourceId} onClick={() => openOriginal(source)}><FileText size={16}/><span>{source.fileName}<small>第 {source.page} 页 · 点击查看原件</small></span><ExternalLink size={14}/></button>)}<p className="detail-note">金额、日期和方向以原始结单为准。</p></Modal>}
  </>;
}
