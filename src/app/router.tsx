import { useEffect, useState } from 'react'

export type RouteMatch =
  | { name: 'login' }
  | { name: 'trips' }
  | { name: 'trip'; tripId: string }
  | { name: 'share'; token: string }
  | { name: 'invite'; token: string }

export function matchRoute(pathname: string): RouteMatch {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 1 && segments[0] === 'login') {
    return { name: 'login' }
  }

  if (segments.length === 2 && segments[0] === 'share') {
    const token = decodeRouteSegment(segments[1])
    return token === null ? { name: 'trips' } : { name: 'share', token }
  }

  if (segments.length === 2 && segments[0] === 'invites') {
    const token = decodeRouteSegment(segments[1])
    return token === null ? { name: 'trips' } : { name: 'invite', token }
  }

  if (segments.length === 2 && segments[0] === 'trips') {
    const tripId = decodeRouteSegment(segments[1])
    return tripId === null ? { name: 'trips' } : { name: 'trip', tripId }
  }

  return { name: 'trips' }
}

function decodeRouteSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
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
