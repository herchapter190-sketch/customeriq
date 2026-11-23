import { Link } from 'react-router-dom'
import { ROUTES, STREAMLIT_ORIGIN, type RouteDef } from '../routes'

/** Route shell for pages whose 3D environment arrives in a later stage.
 *  It shows no data: the working page stays available in the Streamlit app. */
export default function Planned({ route }: { route: RouteDef }) {
  const n = ROUTES.indexOf(route) + 1
  return (
    <article className="planned">
      <header className="page-head">
        <p className="eyebrow">
          {String(n).padStart(2, '0')} — {route.group}
        </p>
        <h1 className="display">{route.title}</h1>
      </header>
      <p className="lede">{route.summary}</p>
      <div className="planned__note">
        <p>
          This environment is planned for a later stage. Until it lands, the complete page runs in the Streamlit
          app.
        </p>
        <div className="planned__actions">
          <a className="btn btn--solid" href={`${STREAMLIT_ORIGIN}/${route.streamlit}`} target="_blank" rel="noopener noreferrer">
            Open in Streamlit
          </a>
          <Link className="btn" to="/">Back to overview</Link>
        </div>
      </div>
    </article>
  )
}

export function NotFound() {
  return (
    <article className="planned">
      <header className="page-head">
        <p className="eyebrow">404</p>
        <h1 className="display">Nothing at this address</h1>
      </header>
      <Link className="btn" to="/">Go to the overview</Link>
    </article>
  )
}
