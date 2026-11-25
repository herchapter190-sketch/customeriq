/** Shapes returned by the existing FastAPI backend (src/api/app.py, `to_jsonable`). */

/** pandas `DataFrame.to_json(orient="split")`. */
export interface Frame {
  columns: string[]
  data: unknown[][]
}

export interface SessionInfo {
  authenticated: boolean
  /** 'demo' is the public read-only deployment (src/api/demo.py). */
  mode: 'local' | 'demo'
}

export interface CleaningSummary {
  input_rows: number
  clean_rows: number
  sales_rows: number
  return_rows: number
  rejected_rows: number
  duplicate_rows?: number
  rejection_counts?: Record<string, number>
  customers: number
  sales_invoices: number
  return_invoices?: number
  products: number
  date_min: string | null
  date_max: string | null
  /** The file's one currency (currency column or price symbols); null when the file names none. */
  currency?: string | null
}

export interface DatasetMeta {
  source_name?: string
  is_synthetic?: boolean
  data_label?: string
  mapping?: Record<string, string | null>
  cleaning_summary?: CleaningSummary
  warnings?: string[]
  loaded_at?: string
  currency?: string | null
}

export interface DatasetOverview {
  total_rows: number
  sales_rows: number
  return_rows: number
  customers: number
  sales_invoices: number
  return_invoices: number
  products: number
  countries: number
  first_date: string
  last_date: string
}

export interface DatasetInfo {
  has_data: boolean
  meta: DatasetMeta
  bounds: [string | null, string | null]
  overview: Partial<DatasetOverview>
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

/** Typed results; every other registry analysis returns a `Frame`. */
interface Typed {
  kpis: Kpis
  kpi_comparison: KpiComparison
  insights: Insight[]
  /** `revenue.gini_coefficient` on net revenue per customer; null with fewer than two paying customers. */
  gini_coefficient: { gini: number | null }
  /** `cohorts.average_retention_curve`: columns month_index, cohorts, eligible_customers, active_customers, retention_pct. */
  retention_summary: { curve: Frame; month_1_pct: number | null; month_3_pct: number | null }
  /** `behaviour.interpurchase_summary` (days); all null when there are no repeat orders. */
  interpurchase_summary: {
    repeat_orders: number
    median_days: number | null
    mean_days: number | null
    p25_days: number | null
    p75_days: number | null
    second_order_median_days: number | null
  }
}

export type FrameAnalysis =
  | 'monthly_revenue'
  | 'revenue_by_customer'
  | 'revenue_concentration'
  | 'pareto_curve'
  | 'product_performance'
  | 'category_performance'
  | 'country_performance'
  | 'repeat_vs_one_time'
  | 'purchase_frequency'
  | 'interpurchase_gaps'
  | 'weekday_hour'
  | 'order_value_bands'
  | 'monthly_acquisition'
  | 'cohort_long'
  | 'monthly_retention'
  | 'segment_summary'
  | 'rfm_customers'
  | 'rfm_grid'
  | 'customer_orders'
  | 'inactive_customers'
  | 'risk_summary'
  | 'risk_by_segment'
  | 'priority_win_back'

export type AnalyticsMap = Typed & { [K in FrameAnalysis]: Frame }
export type AnalyticsName = keyof AnalyticsMap

export interface RiskRules {
  active_days: number
  cooling_days: number
  at_risk_days: number
  overdue_multiplier: number
}

export interface ApiMeta {
  analyses: string[]
  segments: string[]
  risk_categories: string[]
  defaults: { rfm: RfmRules; risk: RiskRules }
  csv_exports: string[]
  standard_fields: Record<string, { required: boolean; label: string }>
  max_upload_mb: number
}

export interface RfmRules {
  method: 'quantile' | 'fixed'
  recency_thresholds: [number, number, number, number]
  frequency_thresholds: [number, number, number, number]
  monetary_thresholds: [number, number, number, number]
}

/** Request filters (src/api/schemas.py FiltersIn). Omitted fields use the API's defaults. */
export interface Filters {
  start_date?: string
  end_date?: string
  segments?: string[]
  rfm?: RfmRules
  risk?: RiskRules
}

export interface ValidationPayload {
  summary?: CleaningSummary
  warnings?: string[]
  rejected_by_reason?: Record<string, number>
  error?: string
}

export interface ImportPreview {
  upload_id: string
  filename: string
  rows: number
  columns: string[]
  suggested_mapping: Record<string, string | null>
  validation: ValidationPayload
  /** First rows exactly as read from the file (before mapping and cleaning). */
  sample?: Frame
  /** Excel only: every worksheet, and the one read. */
  sheets?: string[]
  sheet?: string | null
  /** The currency the preview was validated with, when one was chosen. */
  currency?: string | null
  /** Set when prices use a bare "$": the dollar currencies to choose from before importing. */
  currency_options?: string[]
}

export interface ImportResult extends ValidationPayload {
  backup_created: boolean
  imported?: boolean
  detail?: string
}

export interface SqlResult {
  rows: number
  truncated: boolean
  result: Frame
}

export function rows<T = Record<string, unknown>>(frame: Frame | null | undefined): T[] {
  if (!frame) return []
  return frame.data.map((row) => Object.fromEntries(frame.columns.map((c, i) => [c, row[i]])) as T)
}
