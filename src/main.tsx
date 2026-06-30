import React from 'react'
import ReactDOM from 'react-dom/client'
import { LoginPage } from './app/LoginPage'
import { SharePage } from './app/SharePage'
import { TripsPage } from './app/TripsPage'
import { TripWorkspace } from './app/TripWorkspace'
import { useRoute } from './app/router'
import './index.css'

function Root() {
  const route = useRoute()

  if (route.name === 'login') return <LoginPage />
  if (route.name === 'share') return <SharePage token={route.token} />
  if (route.name === 'trip') return <TripWorkspace tripId={route.tripId} />

  return <TripsPage />
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
