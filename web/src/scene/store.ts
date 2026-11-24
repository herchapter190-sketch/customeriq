import { useSyncExternalStore } from 'react'
import type { RiskRules } from '../api/types'

/** Tiny shared store between DOM pages and the persistent WebGL scene. */
export interface MonthPoint {
  month: string
  net: number
  customers?: number
}

/* ------------------------------------------------ data each district renders (all from the API) */
export interface SegSummary {
  segment: string
  customers: number
  avg_recency_days: number
  avg_frequency: number
}
export interface SegCustomer {
  id: string
  segment: string
  monetary: number
  recency: number
  frequency: number
}
export interface SeriesPoint {
  label: string
  value: number
}
export interface CohortRing {
  cohort: string
  size: number
  /** month_index -> retention % and active customers, as returned by cohort_long */
  points: { k: number; pct: number; active: number }[]
}
export interface HourCell {
  wd: number
  weekday: string
  hour: number
  orders: number
  sales: number
}
export interface RiskCustomer {
  id: string
  segment: string
  days: number
  revenue: number
  risk: string
  overdue: boolean
  tier: string
}
export type DataStage = 'empty' | 'loaded' | 'uploaded' | 'mapping' | 'validated' | 'importing' | 'imported' | 'failed'
export interface DataAssembly {
  stage: DataStage
  /** proportions of the source rows, from the API's cleaning summary */
  counts: { valid: number; returns: number; rejected: number; total: number }
  /** standard fields, whether required, whether mapped */
  fields: { key: string; required: boolean; mapped: boolean }[]
}
export interface SqlShelf {
  names: string[]
  families: string[]
  /** rows returned by the last run of the selected query (null = not run) */
  resultRows: number | null
  running: boolean
}
export interface ReportsRoom {
  findings: { kind: string; title: string }[]
  busy: 'pdf' | 'xlsx' | 'csv' | null
  done: ('pdf' | 'xlsx' | 'csv')[]
  /** number of CSV tables the API offers */
  csvTables: number
}

export interface DistrictData {
  segments: { summary: SegSummary[]; customers: SegCustomer[]; total: number }
  revenue: { key: string; series: SeriesPoint[]; unit: string }
  cohorts: { rings: CohortRing[]; maxK: number }
  behaviour: { cells: HourCell[]; metric: 'orders' | 'sales' }
  inactive: { customers: RiskCustomer[]; rules: RiskRules; total: number }
  data: DataAssembly
  sql: SqlShelf
  reports: ReportsRoom
}
export type DistrictKey = keyof DistrictData
type Pick = string | number | null

interface SceneState {
  months: MonthPoint[]
  hovered: number | null
  ready: boolean
  mode: 'webgl' | '2d'
  data: Partial<DistrictData>
  /** selection made in HTML or in 3D (segment name, cohort index, zone, query name ...) */
  focus: Partial<Record<DistrictKey, Pick>>
  /** pointer hover inside the 3D scene */
  hover: Partial<Record<DistrictKey, Pick>>
  /** secondary selection inside the focus (e.g. one customer inside a segment) */
  pick: Partial<Record<DistrictKey, Pick>>
}

let state: SceneState = { months: [], hovered: null, ready: false, mode: 'webgl', data: {}, focus: {}, hover: {}, pick: {} }
const listeners = new Set<() => void>()

export const sceneStore = {
  get: () => state,
  set(patch: Partial<SceneState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function setDistrict<K extends DistrictKey>(key: K, value: DistrictData[K]) {
  sceneStore.set({ data: { ...state.data, [key]: value } })
}
export function patchDistrict<K extends DistrictKey>(key: K, patch: Partial<DistrictData[K]>) {
  const prev = state.data[key]
  if (!prev) return
  sceneStore.set({ data: { ...state.data, [key]: { ...prev, ...patch } } })
}
export function setFocus(key: DistrictKey, value: Pick) {
  if (state.focus[key] === value) return
  sceneStore.set({ focus: { ...state.focus, [key]: value } })
}
export function setPick(key: DistrictKey, value: Pick) {
  if (state.pick[key] === value) return
  sceneStore.set({ pick: { ...state.pick, [key]: value } })
}
export function setHover(key: DistrictKey, value: Pick) {
  if (state.hover[key] === value) return
  sceneStore.set({ hover: { ...state.hover, [key]: value } })
}

export function useScene<T>(select: (s: SceneState) => T): T {
  return useSyncExternalStore(sceneStore.subscribe, () => select(state))
}
export const useDistrict = <K extends DistrictKey>(key: K) => useScene((s) => s.data[key] as DistrictData[K] | undefined)
export const useFocus = (key: DistrictKey) => useScene((s) => s.focus[key] ?? null)
export const useHover = (key: DistrictKey) => useScene((s) => s.hover[key] ?? null)
export const usePick = (key: DistrictKey) => useScene((s) => s.pick[key] ?? null)

/** Palette as raw sRGB floats (custom shaders write display values directly). */
const raw = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
/** Theme B (dark maroon). Key names are kept from the first palette so every scene keeps working:
 *  `lime` is now the beige highlight, `orange` the light-rose accent, `espresso` the page background. */
export const HEX = {
  lime: '#E6A1AE',
  burgundy: '#641C36',
  ivory: '#F4EBD9',
  espresso: '#260D16',
  orange: '#D18A98',
} as const
export const RGB = {
  lime: raw(HEX.lime),
  burgundy: raw(HEX.burgundy),
  burgundyLift: raw('#B34A59'), // burgundy lifted for visibility on the wine background
  ivory: raw(HEX.ivory),
  /** pale rose: the woven strands' main colour (pure ivory shaded to greige/bronze on the dark stage) */
  blush: raw('#F0CDD4'),
  espresso: raw(HEX.espresso),
  orange: raw(HEX.orange),
}
