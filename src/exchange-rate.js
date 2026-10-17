export const RATE_URL = 'https://api.frankfurter.dev/v2/rate/HKD/CNY';
export const RATE_SOURCE = 'https://frankfurter.dev/';

export async function fetchHkdCnyRate({ signal, fetcher = fetch } = {}) {
  // 固定币种请求不携带凭据或来源页信息，拒绝重定向到其他地址。
  const response = await fetcher(RATE_URL, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`汇率服务暂时不可用（HTTP ${response.status}）`);
  const result = await response.json();
  if (result?.base !== 'HKD' || result?.quote !== 'CNY' || !Number.isFinite(result?.rate) || result.rate <= 0 || result.rate >= 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(result?.date || '') || Number.isNaN(Date.parse(`${result.date}T00:00:00Z`))) throw new Error('汇率服务返回了无效的 HKD/CNY 数据');
  return { rate: result.rate, date: result.date };
}
