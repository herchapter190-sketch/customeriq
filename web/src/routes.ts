export interface RouteDef {
  path: string
  slug: string
  title: string
  group: 'Analytics' | 'Data & Reports'
  summary: string
  /** url_path of the matching page in the Streamlit app (port 8517). */
  streamlit: string
}

export const STREAMLIT_ORIGIN = 'http://127.0.0.1:8517'

export const ROUTES: RouteDef[] = [
  { path: '/', slug: 'overview', title: 'Executive Overview', group: 'Analytics', streamlit: '',
    summary: 'Headline revenue, customers and the insights that need attention.' },
  { path: '/segments', slug: 'segments', title: 'Customer Segmentation', group: 'Analytics', streamlit: 'segments',
    summary: 'RFM segments, what each is worth, and the customers inside them.' },
  { path: '/revenue', slug: 'revenue', title: 'Revenue Analytics', group: 'Analytics', streamlit: 'revenue',
    summary: 'Monthly revenue, concentration, products, categories and countries.' },
  { path: '/cohorts', slug: 'cohorts', title: 'Cohort Retention', group: 'Analytics', streamlit: 'cohorts',
    summary: 'How each acquisition cohort keeps buying month after month.' },
  { path: '/behaviour', slug: 'behaviour', title: 'Customer Behaviour', group: 'Analytics', streamlit: 'behaviour',
    summary: 'Purchase frequency, gaps between orders, timing and basket sizes.' },
  { path: '/inactive', slug: 'inactive', title: 'Inactive Customers', group: 'Analytics', streamlit: 'inactive',
    summary: 'Cooling and at-risk customers, ranked for win-back.' },
  { path: '/data', slug: 'data', title: 'Data Management', group: 'Data & Reports', streamlit: 'data',
    summary: 'Import, validate and replace the active dataset, with verified backups.' },
  { path: '/sql', slug: 'sql', title: 'SQL Library', group: 'Data & Reports', streamlit: 'sql',
    summary: 'The documented SQL behind every analysis, runnable against the current filters.' },
  { path: '/reports', slug: 'reports', title: 'Reports & Exports', group: 'Data & Reports', streamlit: 'reports',
    summary: 'PDF executive report, Excel workbook and formula-safe CSV exports.' },
]

export function routeFor(pathname: string): RouteDef | undefined {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return ROUTES.find((r) => r.path === clean)
}
