import React from 'react';
import { isPendingTransaction, paymentChannel, rewardExclusionReason, rewardPendingReason } from './rewards';

export function PaymentBadge({ transaction, override }) {
  if (rewardExclusionReason(transaction)) return null;
  const channel = paymentChannel(transaction, override?.channel);
  if (channel.key !== 'exclude' && rewardPendingReason(transaction, override?.channel)) return <span className="payment-badge">{isPendingTransaction(transaction) ? '交易待入账' : '支付方式待确认'} · 暂不计返现</span>;
  return <span className={`payment-badge ${channel.pulse ? 'payment-pulse' : ''}`}>{channel.label}{channel.key === 'exclude' ? '' : ` · ${channel.nominalRate}${transaction.currency === 'CNY' ? '（封顶前）' : ''}`}{channel.manual ? ' · 已确认' : channel.uncertain ? ' · 待确认' : ''}</span>;
}

export default function RewardAdjustment({ transaction, value = {}, onChange }) {
  const excluded = rewardExclusionReason(transaction);
  const channel = paymentChannel(transaction, value.channel);
  return <section className="reward-adjustment" aria-labelledby="reward-adjustment-title"><h3 id="reward-adjustment-title">返现识别</h3>{excluded ? <p>{excluded}。</p> : isPendingTransaction(transaction) ? <p>{rewardPendingReason(transaction)}。以已确认入账的记录计算返现。</p> : transaction.currency === 'HKD' ? <p>港币净消费仅计 0.4% 基础返现，按公开参考汇率折合人民币。</p> : <>
    <p>{channel.reason}。{channel.uncertain ? '确认支付方式后才纳入返现计算。' : channel.key !== 'exclude' ? `封顶前参考返现率 ${channel.nominalRate}。` : '本笔已排除返现计算。'}</p>
    <label htmlFor="reward-channel">支付方式（可手动修正）</label><select id="reward-channel" value={value.channel || 'auto'} onChange={event => onChange({ ...value, channel: event.target.value })}><option value="auto">自动识别</option><option value="standard">普通 Tenpay / Alipay / UnionPay</option><option value="applePay">Apple Pay（含专属奖赏）</option><option value="unionpayQr">UnionPay QR（含专属奖赏）</option><option value="exclude">不计返现</option></select>
    {transaction.direction === 'credit' && channel.key !== 'exclude' && !channel.uncertain && <label className="refund-option"><input type="checkbox" checked={!!value.refundBaseOnly} onChange={event => onChange({ ...value, refundBaseOnly: event.target.checked })}/><span>仅扣基础返现（原消费已超额，未获额外奖赏）</span></label>}
    <p className="adjustment-note">修正立即更新本卡今年估算，仅保留在本次页面内存中。退款不恢复额度；赏世界按年封顶，PULSE 按半年封顶，基础返现无上限。</p>
  </>}</section>;
}
