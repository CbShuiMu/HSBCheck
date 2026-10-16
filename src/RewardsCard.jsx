import React, { useEffect, useMemo, useState } from 'react';
import { CircleHelp, RefreshCw, LoaderCircle, ExternalLink, Gift, AlertCircle } from 'lucide-react';
import { calculateRewards, hongKongToday, rewardMoney, ANNUAL_CAP } from './rewards';
import { formatAmount } from './transactions';
import { fetchHkdCnyRate, RATE_SOURCE } from './exchange-rate';

const amount = units => formatAmount(rewardMoney(units), 'CNY');

function Allowance({ title, pool }) {
  return <div className="reward-allowance">
    <div className="allowance-label"><span>年度消费额度</span><strong>{pool.progress.toFixed(1)}%</strong></div>
    <div className="reward-progress" role="progressbar" aria-label={`${title}年度消费额度`} aria-valuemin={0} aria-valuemax={80000} aria-valuenow={Number(pool.used) / 100000} aria-valuetext={`已占用 ${amount(pool.used)} 人民币，全年额度 80000 人民币`}><span style={{ width: `${pool.progress}%` }}/></div>
    <div className="allowance-amount"><span>CNY {amount(pool.used)}</span><span>/ {amount(ANNUAL_CAP)}</span></div>
    <p>剩余额度 CNY {amount(pool.remaining)}{pool.overCap > 0n ? ` · 已超出 ${amount(pool.overCap)}` : ''}</p>
  </div>;
}

export default function RewardsCard({ records, overrides, hasData, demo }) {
  const [exchange, setExchange] = useState({ value: null, loading: true, error: '' });
  const [reload, setReload] = useState(0);
  const today = hongKongToday();
  useEffect(() => {
    const controller = new AbortController(); let active = true; let timedOut = false;
    setExchange(current => ({ ...current, loading: true, error: '' }));
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    fetchHkdCnyRate({ signal: controller.signal }).then(value => {
      if (active) setExchange({ value, loading: false, error: '' });
    }).catch(() => {
      if (active) setExchange(current => ({ ...current, loading: false, error: timedOut ? '汇率请求超时' : '无法获取参考汇率，请检查网络后重试' }));
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [reload]);
  const rewards = useMemo(() => calculateRewards(records, { today, hkdCnyRate: exchange.value?.rate, overrides }), [records, today, exchange.value, overrides]);
  const display = units => !hasData || units === null ? '—' : amount(units);
  const stale = exchange.value && new Date(`${today}T00:00:00Z`) - new Date(`${exchange.value.date}T00:00:00Z`) > 7 * 86400000;
  return <section className="rewards-card" aria-labelledby="rewards-title">
    <div className="rewards-heading"><div><h2 id="rewards-title"><Gift size={18}/>今年返现<span className="estimate-tag">估算</span></h2><p>{today.slice(0, 4)} 年 1 月 1 日至 {today.slice(5).replace('-', ' 月 ')} 日 · 按入账日期累计{demo ? ' · 虚构示例' : ''}</p></div><div className="rewards-total"><span>合计预计返现</span><strong><small>CNY</small>{display(rewards.totalCny)}</strong></div></div>
    <div className="reward-columns">
      <div className="reward-cell base-reward"><div className="reward-name"><h3>基础返现</h3><span>0.4%</span></div><div className="reward-value"><small>CNY</small><strong data-testid="base-cashback">{display(rewards.base.totalCny)}</strong></div><p className="reward-description">人民币与港币净消费，无年度上限</p><div className="base-breakdown"><div><span>人民币消费返现</span><strong>CNY {display(rewards.base.cny)}</strong></div><div><span>港币消费返现（折合）</span><strong>CNY {display(rewards.base.hkdConvertedCny)}</strong></div><p>港币部分按下方参考汇率折合人民币。</p></div></div>
      <div className="reward-cell"><div className="reward-name"><h3>赏世界 5x</h3><span>额外 2%</span></div><div className="reward-value"><small>CNY</small><strong data-testid="world-cashback">{display(rewards.world.cashback)}</strong></div><p className="reward-description">人民币消费 · 年消费 80,000 元封顶</p><Allowance title="赏世界5x" pool={rewards.world}/>{rewards.world.clawback > 0n && <p className="refund-clawback">已扣回退款返现 CNY {amount(rewards.world.clawback)}</p>}</div>
      <div className="reward-cell"><div className="reward-name"><h3>PULSE 专属内地奖赏</h3><span>额外 2%</span></div><div className="reward-value"><small>CNY</small><strong data-testid="pulse-cashback">{display(rewards.pulse.cashback)}</strong></div><p className="reward-description">Apple Pay / 银联 QR · 独立 80,000 元额度</p><Allowance title="PULSE专属内地奖赏" pool={rewards.pulse}/>{rewards.pulse.clawback > 0n && <p className="refund-clawback">已扣回退款返现 CNY {amount(rewards.pulse.clawback)}</p>}</div>
    </div>
    <div className="reward-rate-row"><div>{exchange.loading ? <><LoaderCircle size={13} className="spin"/><span>正在获取 HKD/CNY 参考汇率</span></> : exchange.value ? <><span>1 HKD = <strong>{exchange.value.rate}</strong> CNY</span><span className="rate-date">{exchange.value.date} 参考汇率{stale ? '（较旧）' : ''}</span><a href={RATE_SOURCE} target="_blank" rel="noreferrer">Frankfurter<ExternalLink size={10}/></a></> : <><AlertCircle size={13}/><span>参考汇率不可用，港币部分暂不折算</span></>}</div><button onClick={() => setReload(current => current + 1)} disabled={exchange.loading} aria-label="刷新汇率"><RefreshCw size={13}/><span>刷新汇率</span></button></div>
    {exchange.error && <p className="rate-error" role="status">{exchange.error}{exchange.value ? `；沿用 ${exchange.value.date} 的参考汇率。` : '。人民币返现和两个额度仍可计算。'}</p>}
    <p className="rewards-scope">仅累计已导入结单中的今年记录，不受下方筛选影响。待确认交易不计返现，也不占用年度额度。退款扣回返现但不恢复两项额度；还款、费用不计返现。</p>
    {(rewards.pending > 0 || rewards.uncertainRefunds > 0) && <p className="reward-review"><AlertCircle size={13}/><span>{rewards.pending > 0 ? `${rewards.pending} 笔待确认交易暂不计返现，也不占用年度额度。支付方式待确认的记录可在交易详情手动确认。` : ''}{rewards.uncertainRefunds > 0 ? `${rewards.uncertainRefunds} 笔退款暂按普通渠道扣回返现，请在交易详情核对原支付方式。` : ''}</span></p>}
    {rewards.otherCurrency > 0 && <p className="rewards-scope">另有 {rewards.otherCurrency} 笔其他币种交易未纳入本规则。</p>}
    <details className="reward-rules"><summary><CircleHelp size={13}/>返现规则与计算口径</summary><div><p>按您设定的规则估算，非银行确认到账金额。普通人民币消费为基础 0.4%＋赏世界 2%；有 Apple Pay 或银联 QR 标记时再加专属 2%。普通 Tenpay、Alipay、UnionPay 不自动视为银联 QR。两项额外奖赏各以年度消费 CNY 80,000 为上限，封顶后停止对应加成，基础返现无上限。</p><p>额度按退款前的消费累计占用。每项额外返现＝封顶内消费 × 2%－该渠道退款 × 2%，最低为 0；退款不会释放额度。退款未关联原消费，按可见标记及手动修正的支付方式扣回。若原消费已超额未获额外返现，可在该退款详情选择“仅扣基础返现”。</p><p>港币消费仅计 0.4% 基础返现，再按最新公开日参考汇率折合人民币；它不占用人民币奖赏额度。当前汇率并非银行实际结算汇率。未导入月份、无法识别的交易或支付标记可能影响估算；跨年原消费的退款也需核对。</p></div></details>
  </section>;
}
