import App from '../App'
import type { TripDocument } from '../shared/trip-types'

type TripWorkspaceProps = {
  tripId?: string
  initialDocument?: TripDocument
  readOnly?: boolean
}

export function TripWorkspace({ tripId, initialDocument, readOnly = false }: TripWorkspaceProps) {
  return <App serviceTripId={tripId} initialServiceDocument={initialDocument} readOnly={readOnly} />
}
