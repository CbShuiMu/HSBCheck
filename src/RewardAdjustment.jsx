import React from 'react';
import { isPendingTransaction, paymentChannel, rewardExclusionReason, rewardPendingReason, worldEligibility } from './rewards';

export function PaymentBadge({ transaction, override }) {
  if (rewardExclusionReason(transaction)) return null;
  const channel = paymentChannel(transaction, override?.channel, override);
  if (channel.key !== 'exclude' && rewardPendingReason(transaction)) return <span className="payment-badge">交易待入账 · 暂不计返现</span>;
  return <span className={`payment-badge ${channel.pulse ? 'payment-pulse' : ''}`}>{channel.label}{channel.key === 'exclude' ? '' : ` · ${channel.nominalRate}（封顶前）`}{channel.uncertain ? ' · 按普通消费估算' : ''}{channel.world.eligible === null && channel.key !== 'exclude' ? ' · 赏世界待确认' : ''}{channel.manual ? ' · 已确认' : ''}</span>;
}

export default function RewardAdjustment({ transaction, value = {}, onChange }) {
  const excluded = rewardExclusionReason(transaction);
  const channel = paymentChannel(transaction, value.channel, value);
  const automatic = worldEligibility(transaction);
  return <section className="reward-adjustment" aria-labelledby="reward-adjustment-title"><h3 id="reward-adjustment-title">返现识别</h3>{excluded ? <p>{excluded}。</p> : isPendingTransaction(transaction) ? <p>{rewardPendingReason(transaction)}。以已确认入账的记录计算返现。</p> : <>
    <p>{channel.reason}。{channel.key !== 'exclude' ? `封顶前参考返现率 ${channel.nominalRate}。` : '本笔已排除返现计算。'}</p>
    <label htmlFor="reward-channel">支付方式（可手动修正）</label><select id="reward-channel" value={value.channel || 'auto'} onChange={event => onChange({ ...value, channel: event.target.value })}><option value="auto">自动识别</option><option value="standard">普通 Tenpay / Alipay / UnionPay</option><option value="applePay">Apple Pay（按地区判断专属奖赏）</option><option value="unionpayQr">UnionPay QR（按地区判断专属奖赏）</option><option value="exclude">不计返现</option></select>
    <p>{channel.world.reason}。商户地区以银联记录为准；PULSE 专属奖赏目前估算符合渠道条件的内地及澳门人民币消费。</p>
    <label htmlFor="reward-region">商户国家／地区（可手动确认）</label><select id="reward-region" value={value.merchantRegion || ''} onChange={event => onChange({ ...value, merchantRegion: event.target.value })}><option value="">自动识别{automatic.region ? `（${{ hongKong: '香港', mainland: '中国内地', macau: '澳门', overseas: '海外' }[automatic.region]}）` : '（未识别，默认计赏世界）'}</option><option value="hongKong">香港</option><option value="mainland">中国内地</option><option value="macau">澳门</option><option value="overseas">其他海外地区</option></select>
    <label htmlFor="reward-original-currency">原交易币种（以交易原币种为准）</label><select id="reward-original-currency" value={value.originalCurrency || ''} onChange={event => onChange({ ...value, originalCurrency: event.target.value })}><option value="">自动识别（{automatic.originalCurrency || '未识别，默认按外币估算'}）</option><option value="FOREIGN">外币（非港币）</option><option value="HKD">港币 HKD</option></select>
    {transaction.direction === 'credit' && channel.key !== 'exclude' && <label className="refund-option"><input type="checkbox" checked={!!value.refundBaseOnly} onChange={event => onChange({ ...value, refundBaseOnly: event.target.checked })}/><span>仅扣基础返现（原消费已超额，未获额外奖赏）</span></label>}
    <p className="adjustment-note">修正立即更新本卡今年估算，仅保留在本次页面内存中。退款不恢复额度；赏世界按年封顶，PULSE 按半年封顶，基础返现无上限。</p>
  </>}</section>;
}
