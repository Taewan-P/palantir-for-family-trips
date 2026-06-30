import { useEffect, useState } from 'react'

export type RouteMatch =
  | { name: 'login' }
  | { name: 'trips' }
  | { name: 'trip'; tripId: string }
  | { name: 'share'; token: string }

export function matchRoute(pathname: string): RouteMatch {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 1 && segments[0] === 'login') {
    return { name: 'login' }
  }

  if (segments.length === 2 && segments[0] === 'share') {
    return { name: 'share', token: decodeURIComponent(segments[1]) }
  }

  if (segments.length === 2 && segments[0] === 'trips') {
    return { name: 'trip', tripId: decodeURIComponent(segments[1]) }
  }

  return { name: 'trips' }
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): RouteMatch {
  const [route, setRoute] = useState(() => matchRoute(window.location.pathname))

  useEffect(() => {
    const syncRoute = () => setRoute(matchRoute(window.location.pathname))

    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  return route
}
