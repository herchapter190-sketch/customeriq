import { Link } from 'react-router-dom'
import { setViewMode } from '../lib/viewMode'

/** 3D Exploration is a guided tour: each analytics page is one stop that answers one business question
 *  in its scene. Standard Analytics stays the full workspace (every chart, table, filter and export). */
export const TOUR = [
  { slug: 'overview', path: '/', question: 'How is the business doing overall?' },
  { slug: 'segments', path: '/segments', question: 'Who are my most valuable customers?' },
  { slug: 'revenue', path: '/revenue', question: 'Where does the revenue come from, and is it growing?' },
  { slug: 'cohorts', path: '/cohorts', question: 'Do new customers keep coming back?' },
  { slug: 'behaviour', path: '/behaviour', question: 'How often and when do customers buy?' },
  { slug: 'inactive', path: '/inactive', question: 'Who is drifting away, and who should I win back first?' },
] as const

const stopOf = (slug: string) => TOUR.findIndex((t) => t.slug === slug)

/** "Stop 2 of 6" and the question this scene answers; nothing outside the tour. */
export function TourQuestion({ slug }: { slug: string }) {
  const i = stopOf(slug)
  if (i < 0) return null
  return (
    <p className="tour-q">
      <span>Tour · stop {i + 1} of {TOUR.length}</span>
      {TOUR[i].question}
    </p>
  )
}

export function TourNav({ slug }: { slug: string }) {
  const i = stopOf(slug)
  if (i < 0) return null
  const prev = TOUR[i - 1]
  const next = TOUR[i + 1]
  return (
    <nav className="tour-nav" aria-label="3D tour">
      {prev ? <Link className="btn" to={prev.path}>← Previous stop</Link> : <span />}
      {next ? (
        <Link className="btn btn--solid" to={next.path}>Next: {next.question}</Link>
      ) : (
        <span className="tour-nav__end">
          <button type="button" className="linkish" onClick={() => setViewMode('standard')}>Open in Standard</button>
          {' · '}
          <Link to="/reports">Export a report</Link>
        </span>
      )}
    </nav>
  )
}

/** What CustomerIQ is, who it is for, and the path from a sales file to decisions. */
export function ProductIntro() {
  return (
    <section className="intro" aria-label="About CustomerIQ">
      <p className="intro__what">Customer analytics for small businesses: who buys, what they are worth, who is drifting away.</p>
      <ol className="intro__steps">
        <li><Link to="/data#import"><b>Import</b> CSV or Excel</Link></li>
        <li><Link to="/data"><b>Check</b> data quality</Link></li>
        <li><Link to="/segments"><b>Understand</b> customers</Link></li>
        <li><Link to="/inactive"><b>Act</b> on win-backs</Link></li>
      </ol>
    </section>
  )
}
