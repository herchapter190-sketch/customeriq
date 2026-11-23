/** Shapes returned by the existing FastAPI backend (src/api/app.py, `to_jsonable`). */

/** pandas `DataFrame.to_json(orient="split")`. */
export interface Frame {
  columns: string[]
  data: unknown[][]
}

export interface SessionInfo {
  authenticated: boolean
}

export interface DatasetInfo {
  has_data: boolean
  meta: Record<string, unknown>
  bounds: [string | null, string | null]
  overview: Record<string, unknown>
  version: number | string
}

export interface Kpis {
  net_revenue: number
  gross_sales: number
  returns_value: number
  orders: number
  active_customers: number
  new_customers: number
  repeat_customers: number
  avg_order_value: number
  units_sold: number
  repeat_rate_pct: number
  revenue_per_customer: number
  return_rate_pct: number
}

export interface KpiComparison {
  table: Frame // columns: metric, current, previous, change_pct
  previous_period: unknown
  previous_has_data: boolean
}

export interface Insight {
  key: string
  category: string
  kind: 'opportunity' | 'risk' | 'info' | string
  title: string
  observation: string
  metric: string
  why_it_matters: string
  action: string
  value: number
}

/** Analyses typed so far (Stage 3A). Others return `Frame` until their pages are built. */
export interface AnalyticsMap {
  kpis: Kpis
  kpi_comparison: KpiComparison
  monthly_revenue: Frame
  insights: Insight[]
}
export type AnalyticsName = keyof AnalyticsMap

export interface Filters {
  start_date?: string
  end_date?: string
  segments?: string[]
}

export function rows<T = Record<string, unknown>>(frame: Frame | null | undefined): T[] {
  if (!frame) return []
  return frame.data.map((row) => Object.fromEntries(frame.columns.map((c, i) => [c, row[i]])) as T)
}
