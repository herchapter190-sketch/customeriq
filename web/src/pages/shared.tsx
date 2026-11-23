import { api } from '../api/client'
import { rows } from '../api/types'
import { ErrorPanel, Loading } from '../components/Status'
import { DataTable } from '../components/ui'
import { useDataset } from '../lib/dataset'
import { fmtMoney, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'

interface OrderRow {
  invoice_id: string
  invoice_ts: string
  type: string
  lines: number
  units: number
  value: number
  cumulative_value: number
}

/** One customer's order history (customer_orders analysis), shared by Segments and Inactive.
 *  Keyed by customer so another customer's rows are never shown while the next ones load. */
export function CustomerOrders({ customerId }: { customerId: string }) {
  return <Orders key={customerId} customerId={customerId} />
}

function Orders({ customerId }: { customerId: string }) {
  const { filters, key } = useDataset()
  const [result, reload] = useAsync(
    (signal) => api.analytics('customer_orders', filters, signal, { customer_id: customerId }),
    [key, customerId],
  )
  if (result.state === 'loading') return <Loading label="Reading orders" />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  const list = rows<OrderRow>(result.data)
  if (!list.length) return <p className="muted">No orders for this customer in the selected period.</p>
  return (
    <DataTable
      caption={`Orders for customer ${customerId}`}
      rows={list}
      rowKey={(r) => `${r.invoice_id}-${r.type}`}
      maxHeight={300}
      columns={[
        { key: 'inv', label: 'Invoice', render: (r) => r.invoice_id },
        { key: 'ts', label: 'Date', render: (r) => String(r.invoice_ts).slice(0, 16) },
        { key: 'type', label: 'Type', render: (r) => r.type },
        { key: 'units', label: 'Units', render: (r) => fmtWhole(r.units), numeric: true },
        { key: 'value', label: 'Value', render: (r) => fmtMoney(r.value), numeric: true },
        { key: 'cum', label: 'Lifetime', render: (r) => fmtMoney(r.cumulative_value), numeric: true },
      ]}
    />
  )
}
