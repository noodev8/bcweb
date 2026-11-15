// ESTIMATED GOOGLE AD COST off a Sales profit total (owner, 2026-11-15) — THE copy; the Sales screen and the dashboard's "Sales today"
// both call this. Shopify orders in the window × the current cost per sale (Reports > Ad Daily, last 30 days). Display only: nothing
// stored, sale lines unchanged. Applies to the All / Shopify views only, never a product search. On All, the Shopify order count comes
// from the same Sales report asked for channel 'shp'.
import { useCallback } from 'react';
import { useApiQuery } from '@/lib/useApiQuery';
import { getAdDaily, getSalesReport, AdDaily, SalesReportData, SalesReportSummary, SalesWindow } from '@/lib/api';

const RATE_DAYS = 30;

export function useAdCost(params: {
  channel: string;                       // 'all' | 'shp' | ... — anything else takes no deduction
  window: SalesWindow;
  searchActive: boolean;
  summary: SalesReportSummary | null;    // the report on screen (its order count is used directly on the Shopify view)
}) {
  const { channel, window, searchActive, summary } = params;
  const applies = !searchActive && (channel === 'all' || channel === 'shp');
  const { data: adDaily } = useApiQuery<AdDaily>(applies ? ['ad-daily', RATE_DAYS] : null, () => getAdDaily(RATE_DAYS));
  const { data: shpReport, refresh: refreshShp } = useApiQuery<SalesReportData>(
    applies && channel === 'all' ? ['sales-report-shp-orders', window] : null,
    () => getSalesReport({ channel: 'shp', window, limit: 1 }),
  );
  const orders = channel === 'shp' ? summary?.orders : shpReport?.summary.orders;
  const perSale = adDaily?.totals.costPerSale ?? null;
  const cost = applies && perSale !== null && orders !== undefined ? Math.round(orders * perSale * 100) / 100 : null;
  const refresh = useCallback(async () => { if (applies && channel === 'all') await refreshShp(); }, [applies, channel, refreshShp]);
  return { cost, orders, perSale, rateDays: RATE_DAYS, refresh };
}
