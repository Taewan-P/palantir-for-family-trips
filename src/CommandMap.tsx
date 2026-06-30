import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { ChevronDown, ChevronUp, Cloud, CloudRain, Layers3, Sun } from 'lucide-react'
import { isLiveExternalDataEnabled } from './publishConfig'
import { DAYS, TIME_SLOTS } from './tripData'
import { getRouteDurationSlotSpan, parseEntityKey } from './tripModel'

type Legacy = any
type LegacyProps = any

declare global {
  interface Window {
    __tripCommandCenterMapsConfigured?: boolean
    google?: Legacy
  }
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID

const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#0b0f14' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0f14' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8b949e' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#30363d' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#11161d' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1712' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3fb950' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1f2a34' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#161b22' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#24313d' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#58a6ff' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1b2028' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#08111d' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#58a6ff' }] },
]

const TONE_COLORS: Record<string, string> = {
  info: '#58A6FF',
  warning: '#D29922',
  success: '#3FB950',
  critical: '#F85149',
  violet: '#A371F7',
  muted: '#8B949E',
}

const SPEED_REDUCTION_FACTOR = 0.75
const MIN_ROUTE_LOOP_SECONDS = 16
const MAX_ROUTE_LOOP_SECONDS = 34
const LIVE_EXTERNAL_DATA = isLiveExternalDataEnabled()
const SKIP_DEPRECATED_GOOGLE_ROUTING_IN_DEV = import.meta.env.VITE_DISABLE_LEGACY_GOOGLE_ROUTING === 'true'
const SKIP_DEPRECATED_GOOGLE_PLACES_IN_DEV = Boolean(import.meta.env?.DEV)
const WEATHER_ICONS: Record<string, Legacy> = {
  sun: Sun,
  partly: Cloud,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudRain,
  fog: Cloud,
  wind: Cloud,
  snow: Cloud,
}

function formatDurationText(totalSeconds: Legacy) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return ''

  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${totalMinutes} min`
  if (!minutes) return `${hours} hr${hours === 1 ? '' : 's'}`
  return `${hours} hr ${minutes} min`
}

function formatDistanceText(distanceMeters: Legacy) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return ''

  const miles = distanceMeters / 1609.344
  const decimals = miles >= 10 ? 0 : 1
  return `${miles.toFixed(decimals)} mi`
}

function buildAnimatedPath(google: Legacy,  path: Legacy) {
  if (!path?.length || path.length < 4) return path

  const totalLength = google.maps.geometry.spherical.computeLength(path)
  const spacingMeters = Math.min(Math.max(totalLength / 18, 900), 4200)
  const reduced = [path[0]]
  let carriedDistance = 0

  for (let index = 1; index < path.length - 1; index += 1) {
    carriedDistance += google.maps.geometry.spherical.computeDistanceBetween(path[index - 1], path[index])
    if (carriedDistance >= spacingMeters) {
      reduced.push(path[index])
      carriedDistance = 0
    }
  }

  reduced.push(path[path.length - 1])

  if (reduced.length < 4) return path

  return reduced.map((point: Legacy,  index: Legacy) => {
    if (index === 0 || index === reduced.length - 1) return point

    const previous = reduced[index - 1]
    const next = reduced[index + 1]

    return {
      lat: (previous.lat + point.lat + next.lat) / 3,
      lng: (previous.lng + point.lng + next.lng) / 3,
    }
  })
}

function matchesDay(dayId: Legacy,  focusDayId: Legacy) {
  return focusDayId === 'all' || dayId === 'all' || dayId === focusDayId
}

function isFacility(location: Legacy) {
  return location.category === 'logistics' || location.category === 'park'
}

function colorForCategory(location: Legacy) {
  if (location.category === 'meal') return '#D29922'
  if (location.category === 'park') return '#3FB950'
  if (location.category === 'logistics') return '#8B949E'
  return '#58A6FF'
}

function getPlaybackCueTone(route: Legacy,  location: Legacy) {
  if (location) return colorForCategory(location)
  return getVehicleColor(route)
}

function getPlaybackCueSlotBucket(slot: Legacy) {
  return Number.isFinite(slot) ? Math.floor(slot * 10) : 'na'
}

function buildPlaybackCueKey({ kind, route = null, location = null, entity = null, slot = null }: LegacyProps) {
  const dayId = entity?.dayId || route?.dayId || 'all'
  const anchorId = entity?.id || location?.id || route?.destinationLocationId || route?.id || 'unknown'
  return `${kind}:${dayId}:${anchorId}:${getPlaybackCueSlotBucket(slot)}`
}

function getPlaybackCueSignature(cue: Legacy) {
  const familyIds = [...(cue.families || [])]
    .map((family: Legacy) => family.id)
    .sort()
    .join('|')
  return [
    cue.kind,
    cue.title,
    cue.subtitle,
    cue.caption,
    cue.locationId || '',
    cue.entityId || '',
    familyIds,
  ].join(':')
}

function buildPlaybackCue({ cueKey, families, route, kind, location, anchor, entity = null, subtitleOverride = null, captionOverride = null }: LegacyProps) {
  const tone = getPlaybackCueTone(route, location)
  const familyTitles = families.map((family: Legacy) => family.title)
  const caravan = families.length > 1
  const caravanLabel = caravan ? `${families.length}-car caravan` : familyTitles[0]
  if (kind === 'departure') {
    return {
      key: cueKey || `departure:${route.destinationLocationId || route.id}:${familyTitles.join('|')}`,
      kind,
      title: caravan ? caravanLabel : familyTitles[0],
      subtitle: subtitleOverride || 'Departure',
      caption: captionOverride || location?.title || familyTitles.join(' + '),
      tone,
      familyId: families[0]?.id || null,
      locationId: location?.id || null,
      entityType: entity?.type || null,
      entityId: entity?.id || null,
      families,
      anchor,
      clickable: true,
    }
  }

  return {
    key: cueKey || `${kind}:${location?.id || route.destinationLocationId || route.id}:${familyTitles.join('|')}`,
    kind,
    title: location?.title || (kind === 'arrival' ? 'Arrival' : 'Road stop'),
    subtitle: subtitleOverride || (caravan ? caravanLabel : kind === 'arrival' ? 'Arrival' : kind === 'stop' ? 'Road stop' : 'On site'),
    caption: captionOverride || (caravan ? familyTitles.join(' + ') : familyTitles[0]),
    tone,
    familyId: families[0]?.id || null,
    locationId: location?.id || null,
    entityType: entity?.type || null,
    entityId: entity?.id || null,
    families,
    anchor,
    clickable: true,
  }
}

function averagePoint(points: Legacy) {
  if (!points.length) return null
  return {
    lat: points.reduce((sum: Legacy,  point: Legacy) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum: Legacy,  point: Legacy) => sum + point.lng, 0) / points.length,
  }
}

function getCueEntityPriority(entity: Legacy) {
  if (!entity) return 0
  if (entity.type === 'meal') return 4
  if (entity.type === 'itineraryItem' && entity.rowId === 'activities') return 3
  if (entity.type === 'activity') return 2
  if (entity.type === 'itineraryItem') return 1
  return 0
}

function collapseOnsiteCueEntities(entities: Legacy) {
  if (!entities.length) return []

  const sorted = [...entities].sort((left: Legacy,  right: Legacy) => {
    if (left.dayId !== right.dayId) return `${left.dayId}`.localeCompare(`${right.dayId}`)
    if (left.locationId !== right.locationId) return `${left.locationId}`.localeCompare(`${right.locationId}`)
    if (left.startSlot !== right.startSlot) return left.startSlot - right.startSlot
    return getCueEntityPriority(right) - getCueEntityPriority(left)
  })

  const groups: Legacy[] = []
  sorted.forEach((entity: Legacy) => {
    const previous = groups[groups.length - 1]
    if (
      previous &&
      previous.dayId === entity.dayId &&
      previous.locationId === entity.locationId &&
      Math.abs(previous.startSlot - entity.startSlot) <= 0.22
    ) {
      previous.entities.push(entity)
      previous.startSlot = Math.min(previous.startSlot, entity.startSlot)
      return
    }

    groups.push({
      dayId: entity.dayId,
      locationId: entity.locationId,
      startSlot: entity.startSlot,
      entities: [entity],
    })
  })

  return groups.map((group: Legacy) => {
    const primary = [...group.entities].sort((left: Legacy,  right: Legacy) => {
      const priorityDelta = getCueEntityPriority(right) - getCueEntityPriority(left)
      if (priorityDelta !== 0) return priorityDelta
      return left.startSlot - right.startSlot
    })[0]

    return {
      primary,
      entities: group.entities,
    }
  })
}

function escapeHtml(value: Legacy = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCategoryLabel(location: Legacy) {
  if (location.stopType) return location.stopType
  if (!location.category) return 'Location'
  return location.category.replaceAll('-', ' ')
}

function getLocationPhoto(location: Legacy) {
  return [...(location.livePhotos || []), ...(location.photos || [])].find((media: Legacy) => media?.imageUrl) || null
}

function getHoursPreview(location: Legacy) {
  return Array.isArray(location.openingHours) && location.openingHours.length ? location.openingHours[0] : ''
}

function getRatingSummary(location: Legacy) {
  if (typeof location.rating !== 'number') return ''
  const reviewText = location.userRatingsTotal ? ` · ${location.userRatingsTotal} reviews` : ''
  return `${location.rating.toFixed(1)} rating${reviewText}`
}

function buildLocationBriefingContent(location: Legacy) {
  const accent = colorForCategory(location)
  const photo = getLocationPhoto(location)
  const categoryLabel = formatCategoryLabel(location)
  const ratingSummary = getRatingSummary(location)
  const hoursPreview = getHoursPreview(location)
  const website = location.websiteUrl || location.externalUrl || ''
  const phone = location.phoneNumber || ''
  const address = location.address || 'Address pending'
  const summary = location.summary || location.reservationNote || location.note || 'Location intel syncing from trip plan.'
  const photoMarkup = photo
    ? `<div class="trip-briefing__photo" style="background-image:url('${escapeHtml(photo.imageUrl)}')"></div>`
    : `<div class="trip-briefing__photo trip-briefing__photo--fallback">
         <div class="trip-briefing__photo-icon" style="color:${accent}">◆</div>
         <div class="trip-briefing__photo-label">${escapeHtml(categoryLabel)}</div>
       </div>`

  const metaRows = [
    { label: 'Address', value: address },
    { label: 'Hours', value: hoursPreview },
    { label: 'Rating', value: ratingSummary },
    { label: 'Phone', value: phone },
  ].filter((row: Legacy) => row.value)

  const actions = [
    website
      ? `<a class="trip-briefing__action" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Open intel</a>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return `
    <div class="trip-briefing">
      ${photoMarkup}
      <div class="trip-briefing__body">
        <div class="trip-briefing__header">
          <div class="trip-briefing__eyebrow">Location Briefing</div>
          <div class="trip-briefing__badge" style="color:${accent};border-color:${accent}55;background:${accent}1A">${escapeHtml(categoryLabel)}</div>
        </div>
        <div class="trip-briefing__title">${escapeHtml(location.title || 'Unknown location')}</div>
        <div class="trip-briefing__summary">${escapeHtml(summary)}</div>
        <div class="trip-briefing__meta">
          ${metaRows
            .map(
              (row: Legacy) => `
                <div class="trip-briefing__meta-row">
                  <div class="trip-briefing__meta-label">${escapeHtml(row.label)}</div>
                  <div class="trip-briefing__meta-value">${escapeHtml(row.value)}</div>
                </div>`,
            )
            .join('')}
        </div>
        ${actions ? `<div class="trip-briefing__actions">${actions}</div>` : ''}
      </div>
    </div>
  `
}

function ensureLocationBriefingStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('trip-location-briefing-styles')) return

  const style = document.createElement('style')
  style.id = 'trip-location-briefing-styles'
  style.textContent = `
    .gm-style .gm-style-iw-c {
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42) !important;
    }
    .gm-style .gm-style-iw-d {
      overflow: hidden !important;
      max-height: none !important;
    }
    .gm-style .gm-ui-hover-effect {
      top: 8px !important;
      right: 8px !important;
      opacity: 0.84;
      filter: invert(1) brightness(1.4);
    }
    .trip-briefing {
      width: 320px;
      background: linear-gradient(180deg, rgba(20, 27, 36, 0.98), rgba(10, 15, 22, 0.98));
      color: #c9d1d9;
      font-family: ui-sans-serif, system-ui, sans-serif;
      border: 1px solid rgba(88, 166, 255, 0.18);
    }
    .trip-briefing__photo {
      height: 104px;
      background-size: cover;
      background-position: center;
      border-bottom: 1px solid rgba(88, 166, 255, 0.12);
    }
    .trip-briefing__photo--fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background:
        radial-gradient(circle at top left, rgba(88, 166, 255, 0.14), transparent 42%),
        linear-gradient(180deg, #121922, #0c1117);
    }
    .trip-briefing__photo-icon {
      font-size: 20px;
      font-weight: 900;
    }
    .trip-briefing__photo-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #8b949e;
    }
    .trip-briefing__body {
      padding: 14px 16px 16px;
    }
    .trip-briefing__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .trip-briefing__eyebrow {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #7cc0ff;
    }
    .trip-briefing__badge {
      border: 1px solid;
      padding: 3px 8px;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .trip-briefing__title {
      font-size: 18px;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #e6edf3;
      margin-bottom: 8px;
    }
    .trip-briefing__summary {
      font-size: 12px;
      line-height: 1.55;
      color: #8b949e;
      margin-bottom: 14px;
    }
    .trip-briefing__meta {
      display: grid;
      gap: 8px;
    }
    .trip-briefing__meta-row {
      border: 1px solid rgba(48, 54, 61, 0.72);
      background: rgba(13, 17, 23, 0.88);
      padding: 8px 10px;
    }
    .trip-briefing__meta-label {
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #8b949e;
      margin-bottom: 3px;
    }
    .trip-briefing__meta-value {
      font-size: 11px;
      line-height: 1.45;
      color: #c9d1d9;
    }
    .trip-briefing__actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .trip-briefing__action {
      border: 1px solid rgba(88, 166, 255, 0.3);
      background: rgba(88, 166, 255, 0.08);
      color: #7cc0ff;
      padding: 7px 10px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-decoration: none;
    }
  `
  document.head.appendChild(style)
}

function MapChip({ active, onClick, children, tone = 'neutral' }: LegacyProps) {
  const activeClasses = {
    neutral: 'border-[#58A6FF]/50 bg-[#58A6FF]/12 text-[#C9D1D9]',
    green: 'border-[#3FB950]/50 bg-[#3FB950]/12 text-[#3FB950]',
    amber: 'border-[#D29922]/50 bg-[#D29922]/12 text-[#D29922]',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[2px] border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
        active
          ? (activeClasses as Legacy)[tone]
          : 'border-[#30363D] bg-[#0d1117] text-[#8B949E] hover:border-[#58A6FF]/40 hover:text-[#C9D1D9]'
      }`}
    >
      {children}
    </button>
  )
}

function clamp01(value: Legacy) {
  return Math.min(Math.max(value, 0), 1)
}

function lerp(start: Legacy,  end: Legacy,  alpha: Legacy) {
  return start + (end - start) * alpha
}

function lerpPoint(start: Legacy,  end: Legacy,  alpha: Legacy) {
  return {
    lat: lerp(start.lat, end.lat, alpha),
    lng: lerp(start.lng, end.lng, alpha),
  }
}

function smoothstep(edgeStart: Legacy,  edgeEnd: Legacy,  value: Legacy) {
  if (edgeStart === edgeEnd) {
    return value >= edgeEnd ? 1 : 0
  }
  const normalized = clamp01((value - edgeStart) / (edgeEnd - edgeStart))
  return normalized * normalized * (3 - 2 * normalized)
}

function getVehicleColor(route: Legacy) {
  return TONE_COLORS[route?.tone] || TONE_COLORS.info
}

function buildPathDistanceProfile(google: Legacy,  path: Legacy) {
  if (!google || !path?.length || path.length < 2) return null

  const cumulative = [0]
  let totalDistance = 0

  for (let index = 1; index < path.length; index += 1) {
    totalDistance += google.maps.geometry.spherical.computeDistanceBetween(path[index - 1], path[index])
    cumulative.push(totalDistance)
  }

  if (!totalDistance) return null

  return {
    path,
    cumulative,
    totalDistance,
  }
}

function getNearestPathProgress(google: Legacy,  pathProfile: Legacy,  coordinate: Legacy) {
  if (!google || !pathProfile || !coordinate) return null

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  pathProfile.path.forEach((point: Legacy,  index: Legacy) => {
    const distance = google.maps.geometry.spherical.computeDistanceBetween(point, coordinate)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return clamp01(pathProfile.cumulative[nearestIndex] / pathProfile.totalDistance)
}

function buildRoutePlaybackProfile(google: Legacy,  route: Legacy,  pathProfile: Legacy,  locationsById: Legacy,  routeWindowSlots: Legacy) {
  if (!pathProfile) return null
  const { path } = pathProfile

  const origin = route?.originCoordinates || path[0]
  const intermediateStops = (route?.stopLocationIds || [])
    .map((locationId: Legacy) => locationsById.get(locationId)?.coordinates || null)
    .filter(Boolean)
  const destination = route?.destinationLocationId
    ? locationsById.get(route.destinationLocationId)?.coordinates || path[path.length - 1]
    : path[path.length - 1]

  const rawAnchorProgresses = [origin, ...intermediateStops, destination].map((coordinate: Legacy,  index: Legacy,  anchors: Legacy) => {
    if (index === 0) return 0
    if (index === anchors.length - 1) return 1
    return getNearestPathProgress(google, pathProfile, coordinate)
  })

  const anchorProgresses = rawAnchorProgresses.map((progress: Legacy,  index: Legacy,  anchors: Legacy) => {
    if (index === 0) return 0
    if (index === anchors.length - 1) return 1
    return clamp01(Number.isFinite(progress) ? progress : index / (anchors.length - 1))
  })

  for (let index = 1; index < anchorProgresses.length - 1; index += 1) {
    anchorProgresses[index] = Math.max(anchorProgresses[index], anchorProgresses[index - 1] + 0.0005)
  }

  const legDistanceShares = anchorProgresses
    .slice(1)
    .map((progress: Legacy,  index: Legacy) => Math.max(progress - anchorProgresses[index], 0))
  const totalLegShare = legDistanceShares.reduce((sum: Legacy,  share: Legacy) => sum + share, 0)
  const stopCount = intermediateStops.length
  const shouldPauseAtStops = stopCount > 0 && routeWindowSlots >= 0.5
  const totalStopFraction = shouldPauseAtStops ? Math.min(0.12 * stopCount, 0.24) : 0

  return {
    anchorProgresses,
    legDistanceShares,
    totalLegShare: totalLegShare || 1,
    perStopFraction: stopCount ? totalStopFraction / stopCount : 0,
    totalTravelFraction: Math.max(1 - totalStopFraction, 0),
  }
}

function getRoutePlaybackState(playbackProfile: Legacy,  rawProgress: Legacy) {
  const normalized = clamp01(rawProgress)
  if (!playbackProfile || playbackProfile.anchorProgresses.length < 2) {
    return {
      progress: normalized,
      phase: 'travel',
    }
  }

  let consumedFraction = 0
  const lastLegIndex = playbackProfile.anchorProgresses.length - 2

  for (let index = 0; index <= lastLegIndex; index += 1) {
    const legFraction = playbackProfile.totalTravelFraction
      * (playbackProfile.legDistanceShares[index] / playbackProfile.totalLegShare)
    const startProgress = playbackProfile.anchorProgresses[index]
    const endProgress = playbackProfile.anchorProgresses[index + 1]

    if (normalized <= consumedFraction + legFraction || index === lastLegIndex) {
      const legRatio = legFraction > 0 ? (normalized - consumedFraction) / legFraction : 1
      return {
        progress: lerp(startProgress, endProgress, clamp01(legRatio)),
        phase: 'travel',
      }
    }

    consumedFraction += legFraction

    const hasStopAfterLeg = index < lastLegIndex
    if (!hasStopAfterLeg || !playbackProfile.perStopFraction) continue

    if (normalized <= consumedFraction + playbackProfile.perStopFraction) {
      return {
        progress: endProgress,
        phase: 'stop',
      }
    }

    consumedFraction += playbackProfile.perStopFraction
  }

  return {
    progress: 1,
    phase: 'arrival',
  }
}

function getRoutePlaybackProgress(google: Legacy,  routeEntry: Legacy,  pathProfile: Legacy,  locationsById: Legacy,  rawProgress: Legacy,  routeWindowSlots: Legacy) {
  const profile = buildRoutePlaybackProfile(
    google,
    routeEntry?.route,
    pathProfile,
    locationsById,
    routeWindowSlots,
  )
  return getRoutePlaybackState(profile, rawProgress)
}

function interpolateAlongPath(google: Legacy,  pathProfile: Legacy,  progress: Legacy) {
  const path = pathProfile?.path
  if (!path?.length) return null
  if (path.length === 1 || !pathProfile.totalDistance) return path[0]

  const targetDistance = clamp01(progress) * pathProfile.totalDistance

  for (let index = 1; index < path.length; index += 1) {
    const segmentEndDistance = pathProfile.cumulative[index]
    if (segmentEndDistance < targetDistance) continue

    const start = path[index - 1]
    const end = path[index]
    const segmentStartDistance = pathProfile.cumulative[index - 1]
    const segmentDistance = segmentEndDistance - segmentStartDistance
    const segmentRatio = segmentDistance ? (targetDistance - segmentStartDistance) / segmentDistance : 0
    const point = google.maps.geometry.spherical.interpolate(start, end, clamp01(segmentRatio))
    return { lat: point.lat(), lng: point.lng() }
  }

  return path[path.length - 1]
}

function appendDistinctPoint(points: Legacy,  point: Legacy) {
  if (!point) return

  const normalizedPoint = { lat: point.lat, lng: point.lng }
  const lastPoint = points[points.length - 1]
  if (
    lastPoint &&
    Math.abs(lastPoint.lat - normalizedPoint.lat) < 1e-6 &&
    Math.abs(lastPoint.lng - normalizedPoint.lng) < 1e-6
  ) {
    return
  }

  points.push(normalizedPoint)
}

function extractPathSegment(google: Legacy,  pathProfile: Legacy,  startProgress: Legacy = 0,  endProgress: Legacy = 1) {
  const path = pathProfile?.path
  if (!google || !path?.length) return []
  if (path.length === 1 || !pathProfile.totalDistance) {
    return path.map((point: Legacy) => ({ lat: point.lat, lng: point.lng }))
  }

  const start = clamp01(Math.min(startProgress, endProgress))
  const end = clamp01(Math.max(startProgress, endProgress))
  const startDistance = start * pathProfile.totalDistance
  const endDistance = end * pathProfile.totalDistance
  const segment: Legacy[] = []

  appendDistinctPoint(segment, interpolateAlongPath(google, pathProfile, start))

  for (let index = 1; index < path.length - 1; index += 1) {
    const waypointDistance = pathProfile.cumulative[index]
    if (waypointDistance > startDistance && waypointDistance < endDistance) {
      appendDistinctPoint(segment, path[index])
    }
  }

  appendDistinctPoint(segment, interpolateAlongPath(google, pathProfile, end))
  return segment
}

function buildRouteCameraViewportPoints(google: Legacy,  pathProfile: Legacy,  progress: Legacy,  mode: Legacy) {
  if (!pathProfile?.path?.length) return []
  if (mode === 'arrival') return []
  if (mode === 'premove') {
    return pathProfile.path.map((point: Legacy) => ({ lat: point.lat, lng: point.lng }))
  }

  const clampedProgress = clamp01(progress)
  const tightenAlpha = smoothstep(0.08, 0.74, clampedProgress)
  const trailingContext =
    pathProfile.totalDistance ? Math.min(0.06, 2200 / pathProfile.totalDistance) : 0.04
  const viewportStart = Math.max(0, lerp(0, clampedProgress, tightenAlpha) - trailingContext)

  return extractPathSegment(google, pathProfile, viewportStart, 1)
}

function findNearestPlaybackStop(google: Legacy,  position: Legacy,  route: Legacy,  locationsById: Legacy) {
  if (!google || !position || !route) return null

  const PLAYBACK_STOP_FOCUS_RADIUS_METERS = 1800
  const candidates = [...(route.stopLocationIds || []), route.destinationLocationId]
    .filter(Boolean)
    .map((locationId: Legacy) => locationsById.get(locationId))
    .filter((location: Legacy) => location?.coordinates)

  if (!candidates.length) return null

  let nearest: Legacy = null

  candidates.forEach((location: Legacy) => {
    const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(position, location.coordinates)
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { location, distanceMeters }
    }
  })

  return nearest && nearest.distanceMeters < PLAYBACK_STOP_FOCUS_RADIUS_METERS ? nearest.location : null
}

function getRouteWindowDistance(route: Legacy,  cursorSlot: Legacy,  itineraryItems: Legacy = []) {
  const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)

  if (cursorSlot < startSlot) return startSlot - cursorSlot
  if (cursorSlot > endSlot) return cursorSlot - endSlot
  return 0
}

function getRouteSimulationWindow(route: Legacy,  itineraryItems: Legacy = []) {
  if (!route) {
    return { startSlot: 0, endSlot: 1 }
  }

  if (route.linkedEntityKey) {
    const linked = parseEntityKey(route.linkedEntityKey)
    if (linked.type === 'itineraryItem') {
      const linkedItem = itineraryItems.find((item: Legacy) => item.id === linked.id)
      if (linkedItem && Number.isFinite(linkedItem.startSlot)) {
        const fallbackSpan = Number.isFinite(linkedItem.span) && linkedItem.span > 0 ? linkedItem.span : 1
        const span = getRouteDurationSlotSpan(route, fallbackSpan)
        return {
          startSlot: linkedItem.startSlot,
          endSlot: linkedItem.startSlot + span,
        }
      }
    }
  }

  const startSlot = Number.isFinite(route.simulationStartSlot) ? route.simulationStartSlot : 0
  const fallbackSpan =
    Number.isFinite(route.simulationEndSlot) && route.simulationEndSlot > startSlot
      ? route.simulationEndSlot - startSlot
      : 1
  const endSlot = startSlot + getRouteDurationSlotSpan(route, fallbackSpan)
  return { startSlot, endSlot }
}

function getCursorDayId(cursorSlot: Legacy) {
  const dayIndex = Math.min(Math.max(Math.floor(cursorSlot / TIME_SLOTS.length), 0), DAYS.length - 1)
  return DAYS[dayIndex]?.id || DAYS[0]?.id || 'all'
}

function resolveOnsiteCueFamilies(group: Legacy,  itineraryItems: Legacy,  routeEntries: Legacy,  families: Legacy) {
  if (!group?.primary) return []

  const familyIds = new Set<Legacy>()
  const groupLocationId = group.primary.locationId
  const groupDayId = group.primary.dayId
  const groupStartSlot = group.primary.startSlot

  group.entities.forEach((entity: Legacy) => {
    ;(entity.familyIds || []).forEach((familyId: Legacy) => familyIds.add(familyId))
    ;(entity.linkedEntityKeys || []).forEach((key: Legacy) => {
      const linked = parseEntityKey(key)
      if (linked.type === 'family') {
        familyIds.add(linked.id)
        return
      }
      if (linked.type !== 'itineraryItem') return
      const linkedItem = itineraryItems.find((item: Legacy) => item.id === linked.id)
      ;(linkedItem?.familyIds || []).forEach((familyId: Legacy) => familyIds.add(familyId))
    })
  })

  itineraryItems.forEach((item: Legacy) => {
    if (item.rowId !== 'travel' || !item.familyIds?.length || item.dayId !== groupDayId) return
    const route = routeEntries.find((entry: Legacy) => entry.route.id === item.routeId)?.route
    const routeWindow = route
      ? getRouteSimulationWindow(route, itineraryItems)
      : {
          startSlot: item.startSlot,
          endSlot: item.startSlot + (Number.isFinite(item.span) ? item.span : 0),
        }

    const sameLocation =
      item.locationId === groupLocationId ||
      route?.destinationLocationId === groupLocationId
    const nearWindow =
      Math.abs(routeWindow.startSlot - groupStartSlot) <= 0.35 ||
      Math.abs(routeWindow.endSlot - groupStartSlot) <= 0.35 ||
      (groupStartSlot >= routeWindow.startSlot && groupStartSlot <= routeWindow.endSlot)

    if (!sameLocation || !nearWindow) return
    item.familyIds.forEach((familyId: Legacy) => familyIds.add(familyId))
  })

  return families.filter((family: Legacy) => familyIds.has(family.id))
}

function clamp(value: Legacy,  min: Legacy,  max: Legacy) {
  return Math.min(Math.max(value, min), max)
}

function getCameraPadding(map: Legacy,  pointCount: Legacy,  mode: Legacy) {
  const mapDiv = map?.getDiv?.()
  const width = Math.max(mapDiv?.clientWidth || 0, 1)
  const height = Math.max(mapDiv?.clientHeight || 0, 1)
  const compact = pointCount <= 1

  const horizontalRatio =
    compact && mode !== 'active' ? 0.08
    : compact ? 0.1
    : 0.14
  const verticalRatio =
    compact && mode !== 'active' ? 0.1
    : compact ? 0.12
    : 0.16
  const bottomRatio =
    compact && mode === 'active' ? 0.16
    : compact ? 0.1
    : 0.16

  return {
    left: Math.max(width * horizontalRatio, compact ? 52 : 88),
    right: Math.max(width * horizontalRatio, compact ? 52 : 88),
    top: Math.max(height * verticalRatio, compact ? 46 : 72),
    bottom: Math.max(height * bottomRatio, compact ? 58 : 84),
  }
}

function latRad(lat: Legacy) {
  const sin = Math.sin((lat * Math.PI) / 180)
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2
  return clamp(radX2 / 2, -Math.PI / 2, Math.PI / 2)
}

function getBoundsFromPoints(points: Legacy) {
  return points.reduce(
    (bounds: Legacy,  point: Legacy) => ({
      minLat: Math.min(bounds.minLat, point.lat),
      maxLat: Math.max(bounds.maxLat, point.lat),
      minLng: Math.min(bounds.minLng, point.lng),
      maxLng: Math.max(bounds.maxLng, point.lng),
    }),
    {
      minLat: points[0]?.lat ?? 0,
      maxLat: points[0]?.lat ?? 0,
      minLng: points[0]?.lng ?? 0,
      maxLng: points[0]?.lng ?? 0,
    },
  )
}

function getBoundsCenter(points: Legacy) {
  if (!points.length) return null
  const bounds = getBoundsFromPoints(points)
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  }
}

function getViewportAwareZoom(map: Legacy, points: Legacy, padding: Legacy, { minZoom = 6.9, maxZoom = 10.9 }: Legacy = {}) {
  if (!map || !points.length) return minZoom

  const mapDiv = map.getDiv?.()
  const usableWidth = Math.max((mapDiv?.clientWidth || 0) - padding.left - padding.right, 1)
  const usableHeight = Math.max((mapDiv?.clientHeight || 0) - padding.top - padding.bottom, 1)

  if (points.length === 1) return maxZoom

  const bounds = getBoundsFromPoints(points)
  const lngDiff = bounds.maxLng - bounds.minLng
  const lngFraction = Math.max(((lngDiff < 0 ? lngDiff + 360 : lngDiff) || 0) / 360, 1e-9)
  const latFraction = Math.max((latRad(bounds.maxLat) - latRad(bounds.minLat)) / Math.PI, 1e-9)

  const lngZoom = Math.log2(usableWidth / (256 * lngFraction))
  const latZoom = Math.log2(usableHeight / (256 * latFraction))

  return clamp(Math.min(lngZoom, latZoom), minZoom, maxZoom)
}

function weightedCenter(points: Legacy) {
  if (!points.length) return null
  const totals = points.reduce(
    (accumulator: Legacy,  point: Legacy) => ({
      lat: accumulator.lat + point.lat * point.weight,
      lng: accumulator.lng + point.lng * point.weight,
      weight: accumulator.weight + point.weight,
    }),
    { lat: 0, lng: 0, weight: 0 },
  )
  if (!totals.weight) return { lat: points[0].lat, lng: points[0].lng }
  return {
    lat: totals.lat / totals.weight,
    lng: totals.lng / totals.weight,
  }
}

function buildParticipantCameraTarget({
  google,
  map,
  vehicleEntries,
  highlightedLocation,
  cursorSlot,
}: LegacyProps) {
  const currentDayId = getCursorDayId(cursorSlot)
  const visibleEntries = vehicleEntries
    .filter((entry: Legacy) => entry.marker.getMap())
    .filter((entry: Legacy) => {
      const routeDayId = entry.routeEntry?.route?.dayId
      return !routeDayId || routeDayId === 'all' || routeDayId === currentDayId
    })
    .map((entry: Legacy) => ({
      ...entry,
      position: entry.currentPosition || entry.targetPosition,
    }))
    .filter((entry: Legacy) => entry.position)

  if (!visibleEntries.length) return null

  const activeEntries = visibleEntries.filter((entry: Legacy) => entry.isInTransit)
  const preMoveEntries = visibleEntries.filter((entry: Legacy) => !entry.isInTransit && entry.isPreMove)
  const arrivalEntries = visibleEntries.filter((entry: Legacy) => !entry.isInTransit && !entry.isPreMove)
  const trackedEntries = activeEntries.length
    ? activeEntries
    : preMoveEntries.length
      ? preMoveEntries
      : arrivalEntries.length
        ? arrivalEntries
        : visibleEntries

  let trackedPoints =
    trackedEntries.length === 1
      ? [
          { ...trackedEntries[0].position, weight: 1.15 },
          { ...(trackedEntries[0].cameraLeadPosition || trackedEntries[0].position), weight: 1.85 },
        ]
      : trackedEntries.map((entry: Legacy) => ({ ...entry.position, weight: entry.isInTransit ? 1.2 : 1 }))

  const mode = activeEntries.length ? 'active' : preMoveEntries.length ? 'premove' : 'arrival'
  const routeViewportPoints =
    mode === 'arrival'
      ? []
      : trackedEntries.flatMap((entry: Legacy) => {
          const pathProfile =
            entry.routePathProfile ||
            buildPathDistanceProfile(google, entry.routeEntry?.currentPath || entry.routeEntry?.route?.path || [])
          return buildRouteCameraViewportPoints(
            google,
            pathProfile,
            entry.routePlaybackProgress ?? 0,
            entry.isInTransit ? 'active' : entry.isPreMove ? 'premove' : 'arrival',
          )
        })

  if (highlightedLocation?.coordinates) {
    trackedPoints.push({ ...highlightedLocation.coordinates, weight: 0.95 })
  }

  if (mode === 'arrival' && trackedEntries.length === 1 && highlightedLocation?.coordinates) {
    trackedPoints = [
      { ...highlightedLocation.coordinates, weight: 2.4 },
      { ...trackedEntries[0].position, weight: 1 },
    ]
  }

  const centroid =
    routeViewportPoints.length > 1
      ? getBoundsCenter([
          ...routeViewportPoints,
          ...(highlightedLocation?.coordinates ? [highlightedLocation.coordinates] : []),
        ])
      : weightedCenter(trackedPoints)
  const padding = getCameraPadding(map, trackedEntries.length, mode)
  const currentZoom = map.getZoom()
  const zoomMax =
    trackedEntries.length <= 1
      ? mode === 'arrival' ? 13.2 : 12.2
      : 10.8
  let zoom = getViewportAwareZoom(
    map,
    routeViewportPoints.length > 1
      ? [
          ...routeViewportPoints,
          ...(highlightedLocation?.coordinates ? [highlightedLocation.coordinates] : []),
        ]
      : trackedPoints,
    padding,
    { minZoom: routeViewportPoints.length > 1 ? 5.5 : 6.9, maxZoom: zoomMax },
  )
  if (Number.isFinite(currentZoom) && Math.abs(currentZoom - zoom) < 0.05) {
    zoom = currentZoom
  }

  return {
    center: centroid,
    zoom,
    mode,
    participantCount: trackedEntries.length,
  }
}

function getRouteOrigin(family: Legacy,  route: Legacy,  path: Legacy) {
  return route?.originCoordinates || path?.[0] || family?.originCoordinates || null
}

function buildRouteCoordinatePath(route: Legacy,  locationsById: Legacy) {
  if (route?.path?.length) {
    return route.path
  }

  const origin = route?.originCoordinates || null
  const destination = route?.destinationLocationId
    ? locationsById.get(route.destinationLocationId)?.coordinates || null
    : null
  const stops = (route?.stopLocationIds || [])
    .map((locationId: Legacy) => locationsById.get(locationId)?.coordinates || null)
    .filter(Boolean)

  const points = [origin, ...stops, destination].filter(Boolean)
  return points.length >= 2 ? points : null
}

function pickFamilyRouteEntry(routeEntries: Legacy,  familyId: Legacy,  cursorSlot: Legacy,  focusDayId: Legacy = 'all',  itineraryItems: Legacy = []) {
  const directCandidates = routeEntries.filter((entry: Legacy) => entry.route.familyId === familyId)
  if (!directCandidates.length) return null

  const focusedCandidates = directCandidates.filter((entry: Legacy) => matchesDay(entry.route.dayId, focusDayId))
  const candidates = focusedCandidates.length ? focusedCandidates : directCandidates

  const activeCandidates = candidates.filter((entry: Legacy) => {
    const { startSlot, endSlot } = getRouteSimulationWindow(entry.route, itineraryItems)
    return cursorSlot >= startSlot && cursorSlot <= endSlot
  })

  if (activeCandidates.length) {
    return activeCandidates.reduce((bestEntry: Legacy,  entry: Legacy) => {
      if (!bestEntry) return entry

      const bestStart = getRouteSimulationWindow(bestEntry.route, itineraryItems).startSlot
      const nextStart = getRouteSimulationWindow(entry.route, itineraryItems).startSlot
      return nextStart < bestStart ? entry : bestEntry
    }, null)
  }

  return candidates.reduce((bestEntry: Legacy,  entry: Legacy) => {
    if (!bestEntry) return entry

    const bestDistance = getRouteWindowDistance(bestEntry.route, cursorSlot, itineraryItems)
    const nextDistance = getRouteWindowDistance(entry.route, cursorSlot, itineraryItems)

    if (nextDistance < bestDistance) return entry

    if (nextDistance === bestDistance) {
      const bestStart = getRouteSimulationWindow(bestEntry.route, itineraryItems).startSlot
      const nextStart = getRouteSimulationWindow(entry.route, itineraryItems).startSlot
      if (nextStart < bestStart) return entry
    }

    return bestEntry
  }, null)
}

function getPlaybackDayId(cursorSlot: Legacy) {
  const slotsPerDay = TIME_SLOTS.length || 1
  const dayIndex = Math.min(Math.max(Math.floor(cursorSlot / slotsPerDay), 0), DAYS.length - 1)
  return DAYS[dayIndex]?.id || DAYS[0]?.id || 'all'
}

export default function CommandMap({
  locations,
  routes,
  families,
  itineraryItems = [],
  meals = [],
  activities = [],
  cursorSlot = 0,
  mapUi,
  mapWeather,
  mapWeatherTargets = [],
  selectedLocationId,
  selectedRouteId,
  playbackActive = false,
  playbackHighlightLocationId = null,
  onUpdateMapUi,
  onHydrateLocationDetails,
  onHydrateRouteDetails,
  onSelectEntity,
  onPlaybackFeedItems,
}: LegacyProps) {
  const containerRef = useRef<Legacy>(null)
  const mapRef = useRef<Legacy>(null)
  const googleRef = useRef<Legacy>(null)
  const trafficLayerRef = useRef<Legacy>(null)
  const routeEntriesRef = useRef<Legacy[]>([])
  const markerEntriesRef = useRef<Legacy[]>([])
  const vehicleEntriesRef = useRef<Legacy[]>([])
  const animationFrameRef = useRef<Legacy>(null)
  const lastAnimationTimestampRef = useRef<Legacy>(null)
  const lastViewportTargetRef = useRef('')
  const playbackStopSelectionRef = useRef<Legacy>(null)
  const playbackCameraTargetRef = useRef<Legacy>(null)
  const cameraStateRef = useRef<Legacy>(null)
  const prevCursorSlotRef = useRef<Legacy>(null)
  const playbackCueKeysRef = useRef(new Map())
  const directionsServiceRef = useRef<Legacy>(null)
  const directionsAvailabilityRef = useRef('unknown')
  const placesServiceRef = useRef<Legacy>(null)
  const placesAvailabilityRef = useRef('unknown')
  const [status, setStatus] = useState('loading')
  const [statusDetail, setStatusDetail] = useState('Connecting to Google Maps...')
  const [mapLayerCollapsed, setMapLayerCollapsed] = useState(false)
  const [weatherCollapsed, setWeatherCollapsed] = useState(false)
  const effectiveFocusDayId =
    playbackActive && mapUi.focusDayId === 'all' ? getPlaybackDayId(cursorSlot) : mapUi.focusDayId

  const getRoutePath = (entry: Legacy) => entry.currentPath || entry.route.path

  const showPlaybackCues = useCallback((cues: Legacy) => {
    const nextCues = (Array.isArray(cues) ? cues : [cues]).filter(Boolean)
    if (!nextCues.length) return

    const freshCues = nextCues.filter((cue: Legacy) => {
      const nextSignature = getPlaybackCueSignature(cue)
      const previousSignature = playbackCueKeysRef.current.get(cue.key)
      if (previousSignature === nextSignature) return false
      playbackCueKeysRef.current.set(cue.key, nextSignature)
      return true
    })
    if (!freshCues.length) return

    onPlaybackFeedItems?.(freshCues)
  }, [onPlaybackFeedItems])

  const resolveDrivingPath = async (google: Legacy,  route: Legacy) => {
    const locationsById = new Map<Legacy, Legacy>(locations.map((location: Legacy) => [location.id, location]))
    const fallbackPath = buildRouteCoordinatePath(route, locationsById)
    if (!fallbackPath || fallbackPath.length < 2) {
      return { path: fallbackPath, source: 'seeded' }
    }
    if (!LIVE_EXTERNAL_DATA) return { path: fallbackPath, source: 'seeded' }
    if (SKIP_DEPRECATED_GOOGLE_ROUTING_IN_DEV) return { path: fallbackPath, source: 'seeded' }
    if (directionsAvailabilityRef.current === 'unavailable') return { path: fallbackPath, source: 'seeded' }

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService()
    }

    const origin = route?.originCoordinates || fallbackPath[0]
    const destination = route?.destinationLocationId
      ? (locationsById.get(route.destinationLocationId) as Legacy)?.coordinates || fallbackPath[fallbackPath.length - 1]
      : fallbackPath[fallbackPath.length - 1]
    const waypointPoints = (route?.stopLocationIds || [])
      .map((locationId: Legacy) => (locationsById.get(locationId) as Legacy)?.coordinates || null)
      .filter(Boolean)

    return new Promise<Legacy>((resolve: Legacy,  reject: Legacy) => {
      directionsServiceRef.current.route(
        {
          origin,
          destination,
          waypoints: waypointPoints.map((point: Legacy) => ({ location: point, stopover: false })),
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
        },
        (result: Legacy,  routeStatus: Legacy) => {
          if (routeStatus !== 'OK' || !result?.routes?.length) {
            if (routeStatus === 'REQUEST_DENIED') {
              directionsAvailabilityRef.current = 'unavailable'
            }
            reject(new Error(`Directions failed for ${route.id}: ${routeStatus}`))
            return
          }

          const overviewPath = result.routes[0].overview_path?.map((point: Legacy) => ({
            lat: point.lat(),
            lng: point.lng(),
          }))
          const legs = result.routes[0].legs || []
          const durationSeconds = legs.reduce((sum: Legacy,  leg: Legacy) => sum + (leg.duration?.value || 0), 0)
          const distanceMeters = legs.reduce((sum: Legacy,  leg: Legacy) => sum + (leg.distance?.value || 0), 0)

          resolve({
            path: overviewPath?.length ? overviewPath : fallbackPath,
            source: overviewPath?.length ? 'directions' : 'seeded',
            durationSeconds,
            durationText:
              legs.length === 1
                ? legs[0]?.duration?.text || formatDurationText(durationSeconds)
                : formatDurationText(durationSeconds),
            distanceMeters,
            distanceText:
              legs.length === 1
                ? legs[0]?.distance?.text || formatDistanceText(distanceMeters)
                : formatDistanceText(distanceMeters),
          })
        },
      )
    })
  }

  const resolvePlaceMatch = async (google: Legacy,  location: Legacy) => {
    if (!location.placesQuery || location.placeId) return null
    if (!LIVE_EXTERNAL_DATA) return null
    if (SKIP_DEPRECATED_GOOGLE_PLACES_IN_DEV) return null
    if (placesAvailabilityRef.current === 'unavailable') return null

    if (!placesServiceRef.current) {
      placesServiceRef.current = new google.maps.places.PlacesService(mapRef.current)
    }

    return new Promise<Legacy>((resolve: Legacy,  reject: Legacy) => {
      placesServiceRef.current.findPlaceFromQuery(
        {
          query: location.placesQuery,
          fields: ['name', 'formatted_address', 'geometry', 'place_id'],
        },
        (results: Legacy,  placeStatus: Legacy) => {
          if (placeStatus !== google.maps.places.PlacesServiceStatus.OK || !results?.length) {
            if (placeStatus === google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
              placesAvailabilityRef.current = 'unavailable'
            }
            reject(new Error(`Places failed for ${location.id}: ${placeStatus}`))
            return
          }

          resolve(results[0])
        },
      )
    })
  }

  const resolvePlaceDetails = async (google: Legacy,  placeId: Legacy) => {
    if (!placeId) return null
    if (!LIVE_EXTERNAL_DATA) return null
    if (SKIP_DEPRECATED_GOOGLE_PLACES_IN_DEV) return null
    if (placesAvailabilityRef.current === 'unavailable') return null

    if (!placesServiceRef.current) {
      placesServiceRef.current = new google.maps.places.PlacesService(mapRef.current)
    }

    return new Promise<Legacy>((resolve: Legacy,  reject: Legacy) => {
      placesServiceRef.current.getDetails(
        {
          placeId,
          fields: ['formatted_phone_number', 'website', 'rating', 'user_ratings_total', 'opening_hours', 'photos'],
        },
        (result: Legacy,  placeStatus: Legacy) => {
          if (placeStatus !== google.maps.places.PlacesServiceStatus.OK || !result) {
            if (placeStatus === google.maps.places.PlacesServiceStatus.REQUEST_DENIED) {
              placesAvailabilityRef.current = 'unavailable'
            }
            reject(new Error(`Place details failed for ${placeId}: ${placeStatus}`))
            return
          }

          resolve(result)
        },
      )
    })
  }

  const resolveDriveProfile = async (google: Legacy,  origin: Legacy,  destination: Legacy) => {
    if (!origin || !destination) return null
    if (!LIVE_EXTERNAL_DATA) return null
    if (SKIP_DEPRECATED_GOOGLE_ROUTING_IN_DEV) return null
    if (directionsAvailabilityRef.current === 'unavailable') return null

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService()
    }

    return new Promise<Legacy>((resolve: Legacy,  reject: Legacy) => {
      directionsServiceRef.current.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
        },
        (result: Legacy,  routeStatus: Legacy) => {
          if (routeStatus !== 'OK' || !result?.routes?.length) {
            if (routeStatus === 'REQUEST_DENIED') {
              directionsAvailabilityRef.current = 'unavailable'
            }
            reject(new Error(`Drive profile failed: ${routeStatus}`))
            return
          }

          const leg = result.routes[0]?.legs?.[0]
          if (!leg) {
            resolve(null)
            return
          }

          resolve({
            distanceText: leg.distance?.text || '',
            distanceMeters: leg.distance?.value || 0,
            durationText: leg.duration?.text || '',
            durationSeconds: leg.duration?.value || 0,
          })
        },
      )
    })
  }

  useEffect(() => {
    if (!containerRef.current) return

    if (!GOOGLE_MAPS_API_KEY) {
      setStatus('missing')
      setStatusDetail('Missing VITE_GOOGLE_MAPS_API_KEY')
      return
    }

    let cancelled = false

    async function initializeMap() {
      try {
        // Initialize the Google Map once. Follow-up effects below keep markers,
        // routes, vehicles, and camera state in sync without tearing down the map.
        const initialLocations = locations
        const initialRoutes = routes

        ensureLocationBriefingStyles()

        if (!window.__tripCommandCenterMapsConfigured) {
          (setOptions as Legacy)({
            key: GOOGLE_MAPS_API_KEY,
            version: 'weekly',
            mapIds: GOOGLE_MAP_ID ? [GOOGLE_MAP_ID] : undefined,
          })
          window.__tripCommandCenterMapsConfigured = true
        }

        await importLibrary('maps')
        await importLibrary('geometry')
        const google = window.google
        if (cancelled || !containerRef.current) return

        googleRef.current = google

        const bounds = new google.maps.LatLngBounds()
        initialLocations.forEach((location: Legacy) => bounds.extend(location.coordinates))
        const initialBasecampCenter =
          initialLocations.find((location: Legacy) => location.id === 'pine-airbnb')?.coordinates || { lat: 37.8586, lng: -120.2142 }

        const map = new google.maps.Map(containerRef.current, {
          center: initialBasecampCenter,
          zoom: 7,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          backgroundColor: '#080a0f',
          mapId: GOOGLE_MAP_ID || undefined,
          styles: GOOGLE_MAP_ID ? undefined : DARK_MAP_STYLES,
        })

        map.fitBounds(bounds, 80)
        cameraStateRef.current = {
          center: initialBasecampCenter,
          zoom: 7,
        }
        mapRef.current = map
        trafficLayerRef.current = new google.maps.TrafficLayer()
        if (LIVE_EXTERNAL_DATA) {
          await importLibrary('places')
        }

        const initialLocationsById = new Map<Legacy, Legacy>(initialLocations.map((location: Legacy) => [location.id, location]))

        routeEntriesRef.current = initialRoutes.map((route: Legacy) => {
          const seededPath = buildRouteCoordinatePath(route, initialLocationsById)
          const basePolyline = new google.maps.Polyline({
            map,
            path: seededPath,
            geodesic: true,
            strokeColor: TONE_COLORS[route.tone],
            strokeOpacity: route.tone === 'muted' ? 0.34 : 0.28,
            strokeWeight: route.tone === 'muted' ? 2 : 2.5,
          })

          const animatedPolyline = new google.maps.Polyline({
            map,
            path: seededPath,
            geodesic: true,
            strokeOpacity: 0,
            icons: [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: route.tone === 'muted' ? 0.45 : 0.55,
                  strokeColor: TONE_COLORS[route.tone],
                  scale: route.tone === 'muted' ? 2.5 : 3,
                },
                offset: '0%',
                repeat: route.dashed ? '18px' : '14px',
              },
            ],
          })

          const handleRouteClick = () => {
            const linked = parseEntityKey(route.linkedEntityKey)
            onSelectEntity(linked.type, linked.id)
          }

          basePolyline.addListener('click', handleRouteClick)
          animatedPolyline.addListener('click', handleRouteClick)

          return {
            route,
            basePolyline,
            animatedPolyline,
            currentPath: seededPath,
            animationPath: seededPath,
            routeSource: 'seeded',
            lengthMeters: Math.max(google.maps.geometry.spherical.computeLength(seededPath || []), 1),
            offset: 0,
            nominalSpeedMetersPerSecond:
              (route.tone === 'warning'
                ? 60000
                : route.tone === 'muted'
                  ? 35000
                  : 50000) * SPEED_REDUCTION_FACTOR,
            loopDurationSeconds: 24,
            shouldAnimate: true,
          }
        })

        for (const entry of routeEntriesRef.current) {
          try {
            const {
              path: drivingPath,
              source,
              durationSeconds,
              durationText,
              distanceMeters,
              distanceText,
            } = await resolveDrivingPath(google, entry.route)
            if (cancelled) return
            entry.currentPath = drivingPath
            entry.animationPath = buildAnimatedPath(google, drivingPath)
            entry.routeSource = source
            entry.lengthMeters = Math.max(google.maps.geometry.spherical.computeLength(drivingPath), 1)
            entry.basePolyline.setPath(drivingPath)
            entry.animatedPolyline.setPath(entry.animationPath)
            if (source === 'directions') {
              onHydrateRouteDetails?.(entry.route.id, {
                path: drivingPath,
                durationSeconds,
                durationText,
                distanceMeters,
                distanceText,
              })
            }
          } catch {
            // Keep seeded fallback path if routing is unavailable.
            if (directionsAvailabilityRef.current === 'unavailable') break
          }
        }

        markerEntriesRef.current = initialLocations.map((location: Legacy) => {
          const marker = new google.maps.Marker({
            map,
            position: location.coordinates,
            title: location.title,
            label: null,
            icon: {
              path: 'M -6 0 L 0 -6 L 6 0 L 0 6 Z',
              fillColor: colorForCategory(location),
              fillOpacity: 0.18,
              strokeColor: colorForCategory(location),
              strokeWeight: 2,
              scale: 1.2,
              labelOrigin: new google.maps.Point(0, 18),
            },
          })

          const pulseMarker = new google.maps.Marker({
            map: null,
            clickable: false,
            zIndex: 24,
            position: location.coordinates,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              strokeColor: colorForCategory(location),
              strokeOpacity: 0,
              strokeWeight: 1.4,
              fillColor: colorForCategory(location),
              fillOpacity: 0,
              scale: 0,
            },
          })

          const infoWindow = new google.maps.InfoWindow({
            content: buildLocationBriefingContent(location),
          })

          marker.addListener('click', () => {
            infoWindow.open({ map, anchor: marker })
            onSelectEntity('location', location.id)
          })

          return { location, marker, pulseMarker, infoWindow, pulseOffset: Math.random(), pulseVisible: false }
        })

        vehicleEntriesRef.current = families.map((family: Legacy) => {
          const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
          const originPosition = getRouteOrigin(family, routeEntry?.route, routeEntry?.route.path)
          const marker = new google.maps.Marker({
            map,
            position: originPosition,
            title: `${family.vehicleLabel || 'Vehicle'} · ${family.title}`,
            zIndex: 60,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              fillColor: getVehicleColor(routeEntry?.route),
              fillOpacity: 0.95,
              strokeColor: '#0D1117',
              strokeWeight: 2,
              rotation: 0,
              scale: 5.6,
              anchor: new google.maps.Point(0, 2.8),
            },
          })

          const radarMarker = new google.maps.Marker({
            map: null,
            clickable: false,
            zIndex: 50,
            position: originPosition,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              strokeColor: getVehicleColor(routeEntry?.route),
              strokeOpacity: 0,
              strokeWeight: 1.4,
              fillColor: getVehicleColor(routeEntry?.route),
              fillOpacity: 0,
              scale: 0,
            },
          })

          return {
            family,
            routeEntry,
            marker,
            radarMarker,
            currentPosition: originPosition || null,
            targetPosition: originPosition || null,
            currentHeading: 0,
            targetHeading: 0,
            alertVisible: false,
            alertTone: getVehicleColor(routeEntry?.route),
          }
        })

        const basecampLocation = initialLocations.find((location: Legacy) => location.id === 'pine-airbnb')

        for (const entry of markerEntriesRef.current) {
          try {
            const matchedPlace = await resolvePlaceMatch(google, entry.location)
            if (cancelled) return
            if (!matchedPlace?.geometry?.location) continue

            const coordinates = {
              lat: matchedPlace.geometry.location.lat(),
              lng: matchedPlace.geometry.location.lng(),
            }

            entry.location = {
              ...entry.location,
              title: matchedPlace.name || entry.location.title,
              address: matchedPlace.formatted_address || entry.location.address,
              coordinates,
              placeId: matchedPlace.place_id || entry.location.placeId,
              externalUrl: matchedPlace.place_id
                ? `https://www.google.com/maps/place/?q=place_id:${matchedPlace.place_id}`
                : entry.location.externalUrl,
            }

            let livePhotos = entry.location.livePhotos || []
            let placeDetails = null

            try {
              placeDetails = await resolvePlaceDetails(google, entry.location.placeId)
            } catch {
              placeDetails = null
            }

            if (placeDetails) {
              livePhotos = (placeDetails.photos || []).slice(0, 3).map((photo: Legacy,  index: Legacy) => ({
                id: `${entry.location.id}-live-photo-${index + 1}`,
                label: index === 0 ? 'Live venue photo' : `Venue photo ${index + 1}`,
                imageUrl: photo.getUrl({ maxWidth: 900 }),
                sourceUrl: entry.location.externalUrl,
              }))

              entry.location = {
                ...entry.location,
                phoneNumber: placeDetails.formatted_phone_number || entry.location.phoneNumber,
                websiteUrl: placeDetails.website || entry.location.websiteUrl,
                rating: placeDetails.rating || entry.location.rating,
                userRatingsTotal: placeDetails.user_ratings_total || entry.location.userRatingsTotal,
                openingHours: placeDetails.opening_hours?.weekday_text || entry.location.openingHours,
                livePhotos,
              }
            }

            let basecampDrive = entry.location.basecampDrive
            if (
              entry.location.category === 'meal' &&
              entry.location.id !== 'pine-airbnb' &&
              basecampLocation?.coordinates
            ) {
              try {
                basecampDrive = await resolveDriveProfile(
                  google,
                  basecampLocation.coordinates,
                  entry.location.coordinates,
                )
              } catch {
                basecampDrive = entry.location.basecampDrive
              }
            }

            entry.location = {
              ...entry.location,
              livePhotos,
              basecampDrive,
            }

            entry.marker.setPosition(coordinates)
            entry.pulseMarker?.setPosition(coordinates)
            entry.marker.setTitle(entry.location.title)
            entry.infoWindow.setContent(buildLocationBriefingContent(entry.location))

            onHydrateLocationDetails?.(entry.location.id, {
              title: entry.location.title,
              address: entry.location.address,
              coordinates,
              placeId: entry.location.placeId,
              externalUrl: entry.location.externalUrl,
              phoneNumber: entry.location.phoneNumber,
              websiteUrl: entry.location.websiteUrl,
              rating: entry.location.rating,
              userRatingsTotal: entry.location.userRatingsTotal,
              openingHours: entry.location.openingHours,
              livePhotos: entry.location.livePhotos,
              basecampDrive: entry.location.basecampDrive,
            })
          } catch {
            if (placesAvailabilityRef.current === 'unavailable') break
          }
        }

        setStatus('ready')
        setStatusDetail(
          GOOGLE_MAP_ID
            ? 'Cloud-styled Google Map online'
            : LIVE_EXTERNAL_DATA
              ? 'Use routes, facilities, and traffic layers to inspect the current plan'
              : 'Seeded demo map online with bundled route intel',
        )
      } catch (error) {
        if (cancelled) return
        setStatus('error')
        setStatusDetail((error as Legacy)?.message || 'Google Maps failed to load')
      }
    }

    initializeMap()

    return () => {
      cancelled = true
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      lastAnimationTimestampRef.current = null
      if (trafficLayerRef.current) trafficLayerRef.current.setMap(null)
      routeEntriesRef.current.forEach(({ basePolyline, animatedPolyline }) => {
        basePolyline.setMap(null)
        animatedPolyline.setMap(null)
      })
      markerEntriesRef.current.forEach(({ marker, pulseMarker, infoWindow }) => {
        googleRef.current?.maps.event.clearInstanceListeners(marker)
        infoWindow.close()
        pulseMarker?.setMap(null)
        marker.setMap(null)
      })
      vehicleEntriesRef.current.forEach(({ marker, radarMarker }) => {
        googleRef.current?.maps.event.clearInstanceListeners(marker)
        radarMarker?.setMap(null)
        marker.setMap(null)
      })
    }
  }, [onHydrateLocationDetails, onHydrateRouteDetails, onSelectEntity])

  useEffect(() => {
    if (status !== 'ready') return

    markerEntriesRef.current.forEach((entry: Legacy) => {
      const latestLocation = locations.find((location: Legacy) => location.id === entry.location.id)
      if (!latestLocation) return

      entry.location = latestLocation
      entry.marker.setPosition(latestLocation.coordinates)
      entry.pulseMarker?.setPosition(latestLocation.coordinates)
      entry.marker.setTitle(latestLocation.title)
      entry.infoWindow.setContent(buildLocationBriefingContent(latestLocation))
    })
  }, [locations, status])

  useEffect(() => {
    if (status !== 'ready') return

    vehicleEntriesRef.current.forEach((entry: Legacy) => {
      const latestFamily = families.find((family: Legacy) => family.id === entry.family.id)
      const latestRouteEntry = pickFamilyRouteEntry(
        routeEntriesRef.current,
        entry.family.id,
        cursorSlot,
        effectiveFocusDayId,
        itineraryItems,
      )
      if (!latestFamily || !latestRouteEntry) return

      entry.family = latestFamily
      entry.routeEntry = latestRouteEntry
      entry.marker.setTitle(`${latestFamily.vehicleLabel || 'Vehicle'} · ${latestFamily.title}`)
      entry.marker.setLabel(null)
    })
  }, [cursorSlot, effectiveFocusDayId, families, itineraryItems, routes, status])

  useEffect(() => {
    if (status !== 'ready') return

    routeEntriesRef.current.forEach((entry: Legacy) => {
      const latestRoute = routes.find((route: Legacy) => route.id === entry.route.id)
      if (!latestRoute) return
      entry.route = latestRoute
    })
  }, [routes, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    let targetLocationId = playbackActive ? playbackHighlightLocationId : null

    if (playbackActive && !targetLocationId) {
      const locationsById = new Map<Legacy, Legacy>(locations.map((location: Legacy) => [location.id, location]))
      vehicleEntriesRef.current.some((entry: Legacy) => {
        if (!entry.marker.getMap()) return false
        if (!entry.isInTransit) return false
        const markerPosition = entry.marker.getPosition()
        if (!markerPosition) return false
        const route = entry.routeEntry?.route
        const nearestStop = findNearestPlaybackStop(
          googleRef.current,
          markerPosition,
          route,
          locationsById,
        )
        if (!nearestStop) return false
        targetLocationId = nearestStop.id
        return true
      })
    }

    if (!playbackActive || !targetLocationId) {
      playbackStopSelectionRef.current = null
      return
    }

    const targetEntry = markerEntriesRef.current.find((entry: Legacy) => entry.location.id === targetLocationId)
    if (!targetEntry) return

    if (playbackStopSelectionRef.current === targetLocationId) {
      return
    }

    playbackStopSelectionRef.current = targetLocationId
    console.info('[TripCommand] Playback focused stop', {
      cursorSlot,
      locationId: targetLocationId,
    })
    onSelectEntity('location', targetLocationId)
  }, [cursorSlot, locations, onSelectEntity, playbackActive, playbackHighlightLocationId, status])

  useEffect(() => {
    if (status !== 'ready') return

    let mounted = true

    const animate = (timestamp: Legacy) => {
      const previousTimestamp = lastAnimationTimestampRef.current ?? timestamp
      const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.1)
      lastAnimationTimestampRef.current = timestamp
      const cameraAnimationAlpha = 1 - Math.exp(-deltaSeconds * 2.7)

      routeEntriesRef.current.forEach((entry: Legacy) => {
        if (!entry.animatedPolyline.getMap()) return
        const icons = entry.animatedPolyline.get('icons')
        if (!icons?.length) return
        if (!entry.shouldAnimate) {
          if (entry.offset !== 0) {
            entry.offset = 0
            icons[0].offset = '0%'
            entry.animatedPolyline.set('icons', icons)
          }
          return
        }
        const distancePercent = entry.shouldAnimate
          ? (deltaSeconds / entry.loopDurationSeconds) * 100
          : 0
        entry.offset = (entry.offset + distancePercent) % 100
        icons[0].offset = `${entry.offset}%`
        entry.animatedPolyline.set('icons', icons)
      })

      vehicleEntriesRef.current.forEach((entry: Legacy) => {
        if (!entry.radarMarker) return

        if (!entry.alertVisible || !entry.currentPosition) {
          if (entry.radarMarker.getMap()) entry.radarMarker.setMap(null)
          return
        }

        const pulsePhase = (((timestamp / 1000) * 1.18) + (entry.family?.id === 'north-star' ? 0.12 : entry.family?.id === 'silver-peak' ? 0.34 : 0.56)) % 1
        const cycle = 1 - pulsePhase
        entry.radarMarker.setMap(mapRef.current)
        entry.radarMarker.setPosition(entry.currentPosition)
        entry.radarMarker.setIcon({
          path: googleRef.current.maps.SymbolPath.CIRCLE,
          strokeColor: entry.alertTone || '#58A6FF',
          strokeOpacity: 0.34 * cycle,
          strokeWeight: 1.8,
          fillColor: entry.alertTone || '#58A6FF',
          fillOpacity: 0.06 * cycle,
          scale: 11 + pulsePhase * 10,
        })
      })

      markerEntriesRef.current.forEach((entry: Legacy) => {
        if (!entry.pulseMarker) return

        if (!entry.pulseVisible || !entry.marker.getMap()) {
          if (entry.pulseMarker.getMap()) entry.pulseMarker.setMap(null)
          return
        }

        const pulsePhase = (((timestamp / 1000) * 0.92) + entry.pulseOffset) % 1
        const cycle = 1 - pulsePhase
        const pulseScale = entry.isPlaybackHighlighted ? 10 + pulsePhase * 16 : 8 + pulsePhase * 10
        const pulseStrokeOpacity = (entry.isPlaybackHighlighted ? 0.28 : 0.18) * cycle
        const pulseFillOpacity = (entry.isPlaybackHighlighted ? 0.12 : 0.08) * cycle
        const pulseColor = colorForCategory(entry.location)

        entry.pulseMarker.setMap(mapRef.current)
        entry.pulseMarker.setPosition(entry.location.coordinates)
        entry.pulseMarker.setIcon({
          path: googleRef.current.maps.SymbolPath.CIRCLE,
          strokeColor: pulseColor,
          strokeOpacity: pulseStrokeOpacity,
          strokeWeight: entry.isPlaybackHighlighted ? 2 : 1.6,
          fillColor: pulseColor,
          fillOpacity: pulseFillOpacity,
          scale: pulseScale,
        })
      })

      const map = mapRef.current
      const cameraTarget = playbackCameraTargetRef.current
      if (map && cameraTarget?.center) {
        const mapCenter = map.getCenter()
        const baseCameraState = cameraStateRef.current || {
          center: mapCenter ? { lat: mapCenter.lat(), lng: mapCenter.lng() } : cameraTarget.center,
          zoom: map.getZoom() || cameraTarget.zoom,
        }
        const nextCenter = lerpPoint(baseCameraState.center, cameraTarget.center, cameraAnimationAlpha)
        const nextZoom = lerp(baseCameraState.zoom, cameraTarget.zoom, cameraAnimationAlpha)
        cameraStateRef.current = {
          center: nextCenter,
          zoom: nextZoom,
        }

        if (typeof map.moveCamera === 'function') {
          map.moveCamera({
            center: nextCenter,
            zoom: nextZoom,
          })
        } else {
          map.setCenter(nextCenter)
          if (Math.abs(nextZoom - (map.getZoom() || nextZoom)) > 0.01) {
            map.setZoom(nextZoom)
          }
        }
      }

      if (mounted) {
        animationFrameRef.current = requestAnimationFrame(animate)
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      mounted = false
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      lastAnimationTimestampRef.current = null
    }
  }, [status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    const locationsById = new Map<Legacy, Legacy>(locations.map((location: Legacy) => [location.id, location]))
    let playbackAutoLocationId = playbackHighlightLocationId || null

    if (playbackActive && !playbackAutoLocationId) {
      vehicleEntriesRef.current.some((entry: Legacy) => {
        if (!entry.isInTransit) return false
        const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, entry.family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
        if (!routeEntry) return false

        const { family } = entry
        const { route } = routeEntry
        const relevantToFocus =
          matchesDay(route.dayId, effectiveFocusDayId) &&
          (mapUi.focusFamilyId === 'all' || mapUi.focusFamilyId === family.id)
        const selectedRoute = selectedRouteId === route.id
        const visible = mapUi.showRoutes && (relevantToFocus || selectedRoute)

        if (!visible) return false

        const path = getRoutePath(routeEntry)
        const pathProfile = buildPathDistanceProfile(googleRef.current, path)
        const origin = getRouteOrigin(family, route, path)
        const destination = path?.[path.length - 1] || origin
        const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
        const rawProgress = endSlot === startSlot ? 1 : (cursorSlot - startSlot) / (endSlot - startSlot)
        const { progress: mappedProgress } = getRoutePlaybackProgress(
          googleRef.current,
          routeEntry,
          pathProfile,
          locationsById,
          rawProgress,
          endSlot - startSlot,
        )

        let position = origin
        if (cursorSlot >= endSlot) {
          position = destination
        } else if (cursorSlot > startSlot) {
          position = interpolateAlongPath(googleRef.current, pathProfile, mappedProgress) || origin
        }

        const nearestStop = findNearestPlaybackStop(googleRef.current, position, route, locationsById)
        if (!nearestStop) return false

        playbackAutoLocationId = nearestStop.id
        return true
      })
    }

    routeEntriesRef.current.forEach((entry: Legacy) => {
      const { route, basePolyline, animatedPolyline } = entry
      const visible =
        route.id === selectedRouteId ||
        (mapUi.showRoutes &&
          matchesDay(route.dayId, effectiveFocusDayId) &&
          (mapUi.focusFamilyId === 'all' || route.familyId === 'all' || route.familyId === mapUi.focusFamilyId))
      const emphasized =
        visible && (route.id === selectedRouteId || mapUi.focusFamilyId !== 'all' || mapUi.focusDayId !== 'all')
      const hasSpecificFocus = mapUi.focusFamilyId !== 'all' || mapUi.focusDayId !== 'all'

      basePolyline.setOptions({
        strokeColor: TONE_COLORS[route.tone] || TONE_COLORS.info,
        strokeOpacity:
          route.tone === 'muted'
            ? emphasized ? 0.44 : 0.24
            : emphasized ? 0.64 : 0.26,
        strokeWeight:
          route.tone === 'muted'
            ? emphasized ? 2.6 : 1.8
            : emphasized ? 3.2 : 2.1,
      })

      const icons = animatedPolyline.get('icons')
      if (icons?.length) {
        icons[0].icon = {
          ...icons[0].icon,
          strokeColor: TONE_COLORS[route.tone] || TONE_COLORS.info,
          strokeOpacity:
            entry.routeSource === 'directions'
              ? emphasized ? 0.72 : 0.3
              : route.tone === 'muted' ? (emphasized ? 0.62 : 0.34) : emphasized ? 0.95 : 0.55,
          scale:
            entry.routeSource === 'directions'
              ? emphasized ? 3.1 : 2.4
              : route.tone === 'muted' ? (emphasized ? 2.9 : 2.3) : emphasized ? 3.6 : 3,
        }
        icons[0].repeat =
          entry.routeSource === 'directions'
            ? emphasized ? '18px' : '22px'
            : emphasized ? '12px' : route.dashed ? '18px' : '15px'
        animatedPolyline.set('icons', icons)
      }

      const nominalLoopDuration = entry.lengthMeters / entry.nominalSpeedMetersPerSecond
      entry.loopDurationSeconds = Math.min(
        Math.max(nominalLoopDuration, MIN_ROUTE_LOOP_SECONDS),
        MAX_ROUTE_LOOP_SECONDS,
      )
      entry.shouldAnimate =
        visible &&
        (route.id === selectedRouteId ||
          (entry.routeSource === 'seeded' && (!hasSpecificFocus || emphasized)))

      basePolyline.setMap(visible ? map : null)
      animatedPolyline.setMap(visible ? map : null)
    })

    markerEntriesRef.current.forEach((entry: Legacy) => {
      const { location, marker, pulseMarker } = entry
      const highlightedByPlayback = playbackActive && location.id === playbackAutoLocationId
      const visible =
        location.id === selectedLocationId ||
        highlightedByPlayback ||
        (isFacility(location)
          ? mapUi.showFacilities && matchesDay(location.dayId, effectiveFocusDayId)
          : mapUi.showRoutes && matchesDay(location.dayId, effectiveFocusDayId))

      marker.setMap(visible ? map : null)
      entry.isPlaybackHighlighted = highlightedByPlayback
      entry.pulseVisible = visible && (location.id === selectedLocationId || highlightedByPlayback)
      pulseMarker?.setPosition(location.coordinates)
      if (!entry.pulseVisible && pulseMarker?.getMap()) {
        pulseMarker.setMap(null)
      }
      marker.setOptions({
        label:
          location.id === selectedLocationId || highlightedByPlayback
            ? {
                text: location.title,
                color: '#C9D1D9',
                fontSize: '8px',
                fontWeight: '700',
              }
            : null,
        icon: {
          path: 'M -6 0 L 0 -6 L 6 0 L 0 6 Z',
          fillColor: colorForCategory(location),
          fillOpacity: location.id === selectedLocationId || highlightedByPlayback ? 0.32 : 0.18,
          strokeColor: colorForCategory(location),
          strokeWeight: location.id === selectedLocationId || highlightedByPlayback ? 3 : 2,
          scale: location.id === selectedLocationId || highlightedByPlayback ? 1.5 : 1.2,
          labelOrigin: new googleRef.current.maps.Point(0, 18),
        },
      })
    })

    vehicleEntriesRef.current.forEach((entry: Legacy) => {
      const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, entry.family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
      if (!routeEntry) {
        entry.marker.setMap(null)
        entry.isInTransit = false
        entry.isPreMove = false
        entry.cameraLeadPosition = null
        entry.routePathProfile = null
        entry.routePlaybackProgress = null
        return
      }

      entry.routeEntry = routeEntry

      const { family } = entry
      const { route } = routeEntry
      const relevantToFocus =
        matchesDay(route.dayId, effectiveFocusDayId) &&
        (mapUi.focusFamilyId === 'all' || mapUi.focusFamilyId === family.id)
      const selectedFamily = mapUi.focusFamilyId === family.id
      const selectedRoute = selectedRouteId === route.id
      const visible = mapUi.showRoutes && (relevantToFocus || selectedRoute)

      if (!visible) {
        entry.marker.setMap(null)
        entry.isInTransit = false
        entry.isPreMove = false
        entry.cameraLeadPosition = null
        entry.routePathProfile = null
        entry.routePlaybackProgress = null
        return
      }

      const path = getRoutePath(routeEntry)
      const pathProfile = buildPathDistanceProfile(googleRef.current, path)
      const origin = getRouteOrigin(family, route, path)
      const destination = path?.[path.length - 1] || origin
      const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
      const rawProgress = endSlot === startSlot ? 1 : (cursorSlot - startSlot) / (endSlot - startSlot)
      const { progress: mappedProgress } = getRoutePlaybackProgress(
        googleRef.current,
        routeEntry,
        pathProfile,
        locationsById,
        rawProgress,
        endSlot - startSlot,
      )

      let position = origin
      if (cursorSlot >= endSlot) {
        position = destination
      } else if (cursorSlot > startSlot) {
        position = interpolateAlongPath(googleRef.current, pathProfile, mappedProgress) || origin
      }

      const lookaheadMeters = pathProfile ? Math.min(Math.max(pathProfile.totalDistance * 0.018, 180), 1400) : 420
      const nextProgress = pathProfile?.totalDistance
        ? clamp01(mappedProgress + lookaheadMeters / pathProfile.totalDistance)
        : clamp01(Math.min(mappedProgress + 0.01, 1))
      const nextPosition =
        cursorSlot >= endSlot
          ? destination
          : interpolateAlongPath(googleRef.current, pathProfile, nextProgress) || destination
      const heading =
        position && nextPosition
          ? googleRef.current.maps.geometry.spherical.computeHeading(position, nextPosition) || 0
          : 0
      const emphasized = selectedRoute || selectedFamily
      const fillColor = getVehicleColor(route)
      const alertWindowSlots = 0.34
      const preMoveWindowStart = startSlot - alertWindowSlots
      const aboutToMove = cursorSlot < startSlot && cursorSlot >= preMoveWindowStart
      const inTransit = cursorSlot >= startSlot && cursorSlot <= endSlot

      entry.marker.setMap(map)
      entry.targetPosition = position
      entry.targetHeading = heading
      entry.currentPosition = position
      entry.currentHeading = heading
      entry.cameraLeadPosition = nextPosition
      entry.isInTransit = inTransit
      entry.isPreMove = aboutToMove
      entry.routePathProfile = pathProfile
      entry.routePlaybackProgress = mappedProgress
      entry.alertVisible = aboutToMove
      entry.alertTone = fillColor
      entry.marker.setPosition(position)
      entry.marker.setZIndex(emphasized ? 85 : 60)
      entry.marker.setOpacity(emphasized ? 1 : 0.9)
      entry.marker.setIcon({
        path: googleRef.current.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        fillColor,
        fillOpacity: emphasized ? 1 : 0.9,
        strokeColor: emphasized ? '#E6EDF3' : '#0D1117',
        strokeWeight: emphasized ? 2.4 : 2,
        rotation: heading,
        scale: emphasized ? 6.3 : 5.6,
        anchor: new googleRef.current.maps.Point(0, 2.8),
      })
    })

    if (trafficLayerRef.current) {
      trafficLayerRef.current.setMap(mapUi.showTraffic ? map : null)
    }
  }, [cursorSlot, effectiveFocusDayId, itineraryItems, locations, mapUi, playbackActive, playbackHighlightLocationId, selectedLocationId, selectedRouteId, status])

  useEffect(() => {
    if (status !== 'ready') return

    if (!playbackActive) {
      prevCursorSlotRef.current = null
      playbackCueKeysRef.current.clear()
      return
    }

    const previousCursor = prevCursorSlotRef.current
    if (previousCursor != null && cursorSlot + 0.12 < previousCursor) {
      playbackCueKeysRef.current.clear()
    }

    const locationsById = new Map<Legacy, Legacy>(locations.map((location: Legacy) => [location.id, location]))
    const crossedThreshold = (threshold: Legacy) => {
      if (previousCursor == null) {
        return cursorSlot >= threshold && cursorSlot <= threshold + 0.08
      }
      return previousCursor < threshold && cursorSlot >= threshold
    }

    const onsiteEntities = [
      ...meals,
      ...activities,
      ...itineraryItems.filter((item: Legacy) => item.rowId !== 'travel' && item.locationId),
    ].filter((entity: Legacy) => entity.locationId && matchesDay(entity.dayId, effectiveFocusDayId))

    const crossedOnsiteEntityGroups = collapseOnsiteCueEntities(
      onsiteEntities.filter((entity: Legacy) => crossedThreshold(entity.startSlot)),
    )
    const hasNearbyOnsitePhase = (locationId: Legacy,  slot: Legacy) =>
      onsiteEntities.some(
        (entity: Legacy) =>
          entity.locationId === locationId &&
          entity.startSlot >= slot &&
          entity.startSlot <= slot + 0.22,
      )

    const candidates: Legacy[] = []

    vehicleEntriesRef.current.forEach((entry: Legacy) => {
      if (!entry.marker.getMap() || !entry.routeEntry) return false

      const { family, routeEntry } = entry
      const { route } = routeEntry
      const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
      const position = entry.currentPosition || entry.targetPosition

      if (crossedThreshold(startSlot)) {
        candidates.push({
          groupKey: `departure:${route.dayId}:${route.destinationLocationId || route.id}`,
          cueKey: buildPlaybackCueKey({
            kind: 'departure',
            route,
            location: route.destinationLocationId ? locationsById.get(route.destinationLocationId) || null : null,
            slot: startSlot,
          }),
          kind: 'departure',
          family,
          route,
          location: route.destinationLocationId ? locationsById.get(route.destinationLocationId) || null : null,
          anchor: position || route.originCoordinates || null,
        })
        return
      }

      if (!position) return

      const stopLocations: Legacy[] = [...(route.stopLocationIds || []), route.destinationLocationId]
        .filter(Boolean)
        .map((locationId: Legacy) => locationsById.get(locationId) as Legacy)
        .filter((location: Legacy) => location?.coordinates)

      for (const location of stopLocations) {
        const distanceMeters = googleRef.current.maps.geometry.spherical.computeDistanceBetween(position, location.coordinates)
        const isArrival = location.id === route.destinationLocationId
        const threshold = isArrival ? 2200 : 1800
        if (distanceMeters <= threshold) {
          if (isArrival && hasNearbyOnsitePhase(location.id, endSlot)) {
            return
          }
          const cueKind = isArrival || crossedThreshold(endSlot) ? 'arrival' : 'stop'
          candidates.push({
            groupKey: `${cueKind}:${route.dayId}:${location.id}`,
            cueKey: buildPlaybackCueKey({
              kind: cueKind,
              route,
              location,
              slot: isArrival ? endSlot : startSlot,
            }),
            kind: cueKind,
            family,
            route,
            location,
            anchor: location.coordinates,
          })
          return
        }
      }
    })

    crossedOnsiteEntityGroups.forEach((group: Legacy) => {
      const entity = group.primary
      const location = locationsById.get(entity.locationId)
      if (!location) return

      const visibleFamilies = vehicleEntriesRef.current
        .filter((entry: Legacy) => entry.marker.getMap())
        .map((entry: Legacy) => entry.family)
      const cueFamilies = resolveOnsiteCueFamilies(group, itineraryItems, routeEntriesRef.current, families)

      candidates.push({
        groupKey: `onsite:${entity.dayId}:${entity.locationId}:${Math.round(entity.startSlot * 100)}`,
        cueKey: buildPlaybackCueKey({
          kind: 'onsite',
          entity,
          location,
          slot: entity.startSlot,
        }),
        kind: 'onsite',
        entity,
        location,
        route: visibleFamilies[0]?.id
          ? vehicleEntriesRef.current.find((entry: Legacy) => entry.family.id === visibleFamilies[0].id)?.routeEntry?.route || null
          : null,
        families: cueFamilies.length ? cueFamilies : visibleFamilies.length ? visibleFamilies : families,
        anchor: location.coordinates,
      })
    })

    let cuesToShow: Legacy[] = []
    if (candidates.length) {
      const grouped = new Map()
      candidates.forEach((candidate: Legacy) => {
        const existing = grouped.get(candidate.groupKey) || {
          cueKey: candidate.cueKey,
          kind: candidate.kind,
          route: candidate.route,
          location: candidate.location,
          entity: candidate.entity || null,
          families: candidate.families ? [...candidate.families] : [],
          anchors: [],
        }
        if (candidate.family) existing.families.push(candidate.family)
        if (candidate.families?.length) {
          existing.families = candidate.families
        }
        if (candidate.anchor) existing.anchors.push(candidate.anchor)
        grouped.set(candidate.groupKey, existing)
      })

      cuesToShow = [...grouped.values()]
        .sort((left: Legacy,  right: Legacy) => right.families.length - left.families.length)
        .map((group: Legacy) => buildPlaybackCue({
          cueKey: group.cueKey,
          families: group.families,
          route: group.route,
          kind: group.kind,
          location: group.location,
          anchor: averagePoint(group.anchors) || group.location?.coordinates || null,
          entity: group.entity,
          subtitleOverride:
            group.kind === 'onsite'
              ? group.entity?.type === 'meal' ? 'Meal on site' : 'On site'
              : null,
          captionOverride: group.kind === 'onsite' ? group.entity?.title || null : null,
        }))
        .filter(Boolean)
    }

    if (cuesToShow.length) {
      showPlaybackCues(cuesToShow)
    }

    prevCursorSlotRef.current = cursorSlot
  }, [activities, cursorSlot, effectiveFocusDayId, families, itineraryItems, locations, meals, playbackActive, showPlaybackCues, status])

  useEffect(() => {
    const map = mapRef.current
    const selectedLocation = locations.find((location: Legacy) => location.id === selectedLocationId)
    const selectedRouteEntry = routeEntriesRef.current.find((entry: Legacy) => entry.route.id === selectedRouteId)
    if (!map || status !== 'ready') return

    const highlightedLocation =
      locations.find((location: Legacy) => location.id === playbackHighlightLocationId) ||
      locations.find((location: Legacy) => location.id === playbackStopSelectionRef.current) ||
      (!playbackActive ? locations.find((location: Legacy) => location.id === selectedLocationId) : null)

    const participantCameraTarget = buildParticipantCameraTarget({
      google: googleRef.current,
      map,
      vehicleEntries: vehicleEntriesRef.current,
      highlightedLocation,
      cursorSlot,
    })

    if (participantCameraTarget && (playbackActive || (!selectedRouteEntry && !selectedLocation))) {
      playbackCameraTargetRef.current = participantCameraTarget
      lastViewportTargetRef.current = `participants:${participantCameraTarget.mode}:${participantCameraTarget.participantCount}`
      return
    }

    playbackCameraTargetRef.current = null
    const currentCenter = map.getCenter()
    cameraStateRef.current = currentCenter
      ? {
          center: { lat: currentCenter.lat(), lng: currentCenter.lng() },
          zoom: map.getZoom() || cameraStateRef.current?.zoom || 7,
        }
      : cameraStateRef.current

    if (selectedRouteEntry) {
      const viewportKey = `route:${selectedRouteEntry.route.id}`
      if (lastViewportTargetRef.current === viewportKey) return
      const routePath = getRoutePath(selectedRouteEntry)
      const routeLengthMeters = selectedRouteEntry.lengthMeters || 0

      if (routeLengthMeters < 25000) {
        const midpoint = routePath[Math.floor(routePath.length / 2)]
        if (midpoint) map.panTo(midpoint)
        if ((map.getZoom() || 0) < 10) {
          map.setZoom(10)
        }
      } else {
        const bounds = new googleRef.current.maps.LatLngBounds()
        routePath.forEach((point: Legacy) => bounds.extend(point))
        map.fitBounds(bounds, 120)
      }

      const routeCenter = map.getCenter()
      cameraStateRef.current = routeCenter
        ? {
            center: { lat: routeCenter.lat(), lng: routeCenter.lng() },
            zoom: map.getZoom() || cameraStateRef.current?.zoom || 7,
          }
        : cameraStateRef.current

      lastViewportTargetRef.current = viewportKey
      return
    }

    if (selectedLocation) {
      const viewportKey = `location:${selectedLocation.id}`
      if (lastViewportTargetRef.current === viewportKey) return
      const currentCenter = map.getCenter()
      const distanceFromCenter = currentCenter
        ? googleRef.current.maps.geometry.spherical.computeDistanceBetween(currentCenter, selectedLocation.coordinates)
        : Infinity
      map.panTo(selectedLocation.coordinates)
      if (distanceFromCenter > 6000 && (map.getZoom() || 0) < 12) {
        map.setZoom(12)
      }
      cameraStateRef.current = {
        center: selectedLocation.coordinates,
        zoom: map.getZoom() || cameraStateRef.current?.zoom || 12,
      }
      lastViewportTargetRef.current = viewportKey
      return
    }

    lastViewportTargetRef.current = ''
  }, [cursorSlot, locations, mapUi, playbackActive, playbackHighlightLocationId, selectedLocationId, selectedRouteId, status])

  const summaryText = useMemo(() => {
    const summaryBits = []
    if (mapUi.showRoutes) {
      summaryBits.push(
        mapUi.focusFamilyId === 'all'
          ? 'all family routes'
          : `${families.find((item: Legacy) => item.id === mapUi.focusFamilyId)?.title || 'family'} route focus`,
      )
    }
    if (mapUi.showFacilities) summaryBits.push('logistics facilities')
    if (mapUi.showTraffic) summaryBits.push('live traffic')
    if (mapUi.focusDayId !== 'all') {
      summaryBits.push(`${DAYS.find((item: Legacy) => item.id === mapUi.focusDayId)?.title.toLowerCase() || mapUi.focusDayId} focus`)
    }
    return summaryBits.length ? `Showing ${summaryBits.join(', ')}` : 'No operational layers visible'
  }, [families, mapUi])

  const badgeTone =
    status === 'ready'
      ? 'border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950]'
      : status === 'error' || status === 'missing'
        ? 'border-[#F85149]/30 bg-[#F85149]/10 text-[#F85149]'
        : 'border-[#58A6FF]/30 bg-[#58A6FF]/10 text-[#58A6FF]'
  const WeatherIcon = WEATHER_ICONS[mapWeather?.iconKey] || Cloud

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#080a0f]">
      <div ref={containerRef} className="absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0 bg-[#071019] transition-opacity duration-300"
        style={{ opacity: mapUi.showTraffic ? 0.14 : 0 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(17,27,34,0.35)_1px,transparent_1px)] [background-size:32px_32px]" />

      {mapLayerCollapsed ? (
        <button
          type="button"
          onClick={() => setMapLayerCollapsed(false)}
          className="absolute left-6 top-6 z-20 flex items-center gap-2 border border-[#30363D] bg-[#161b22]/92 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#C9D1D9] shadow-lg backdrop-blur"
        >
          <Layers3 size={14} className="text-[#58A6FF]" />
          Map Layer
          <ChevronDown size={14} className="text-[#8B949E]" />
        </button>
      ) : (
        <div className="absolute left-6 top-6 z-20 w-[360px] border border-[#30363D] bg-[#161b22]/92 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Map Layer
            </div>
            <div className="flex items-center gap-2">
              <div className={`rounded-[2px] border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${badgeTone}`}>
                {status === 'ready' ? 'Map online' : status === 'loading' ? 'Loading' : 'Attention'}
              </div>
              <button type="button" onClick={() => setMapLayerCollapsed(true)} className="text-[#8B949E] hover:text-[#C9D1D9]">
                <ChevronUp size={14} />
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <MapChip active={mapUi.showRoutes} onClick={() => onUpdateMapUi({ showRoutes: !mapUi.showRoutes })} tone="green">
              Routes
            </MapChip>
            <MapChip active={mapUi.showFacilities} onClick={() => onUpdateMapUi({ showFacilities: !mapUi.showFacilities })} tone="neutral">
              Facilities
            </MapChip>
            <MapChip active={mapUi.showTraffic} onClick={() => onUpdateMapUi({ showTraffic: !mapUi.showTraffic })} tone="amber">
              Traffic
            </MapChip>
          </div>

          <div className="mb-2 text-[8px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
            Family Focus
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[{ id: 'all', label: 'All Families' }, ...families.map((family: Legacy) => ({ id: family.id, label: family.title }))].map((item: Legacy) => (
              <MapChip
                key={item.id}
                active={mapUi.focusFamilyId === item.id}
                onClick={() => onUpdateMapUi({ focusFamilyId: item.id })}
              >
                {item.label}
              </MapChip>
            ))}
          </div>

          <div className="mb-2 text-[8px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
            Day Focus
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[{ id: 'all', label: 'All Days' }, ...DAYS.map((day: Legacy) => ({ id: day.id, label: day.title.replace(' Day', '') }))].map((item: Legacy) => (
              <MapChip
                key={item.id}
                active={mapUi.focusDayId === item.id}
                onClick={() => onUpdateMapUi({ focusDayId: item.id })}
              >
                {item.label}
              </MapChip>
            ))}
          </div>

          <div className="border-t border-[#30363D]/60 pt-2 text-[10px] leading-relaxed text-[#8B949E]">
            {status === 'ready' ? summaryText : statusDetail}
          </div>
        </div>
      )}

      {weatherCollapsed ? (
        <button
          type="button"
          onClick={() => setWeatherCollapsed(false)}
          className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-[#58A6FF]/25 bg-[#111722]/94 px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.42)] backdrop-blur"
        >
          {mapWeatherTargets.slice(0, 2).map((target: Legacy) => {
            const TargetIcon = WEATHER_ICONS[target.iconKey] || Cloud
            return (
              <div key={target.id} className="flex items-center gap-1 text-[#E6EDF3]">
                <TargetIcon size={14} className={target.active ? 'text-[#7CC0FF]' : 'text-[#8B949E]'} />
                <span className="text-[10px] font-black uppercase tracking-[0.08em]">{target.temperature}</span>
              </div>
            )
          })}
          <ChevronDown size={14} className="text-[#8B949E]" />
        </button>
      ) : (
        <div className="absolute right-6 top-6 z-20 w-[292px] overflow-hidden border border-[#58A6FF]/25 bg-[linear-gradient(180deg,rgba(15,23,34,0.97),rgba(11,17,24,0.95))] shadow-[0_18px_40px_rgba(0,0,0,0.42)] backdrop-blur">
          <div className="flex items-center justify-between border-b border-[#58A6FF]/15 bg-[linear-gradient(90deg,rgba(88,166,255,0.12),rgba(88,166,255,0.02))] px-4 py-2.5">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-[#7CC0FF]">
              Weather Intel
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-[2px] border border-[#58A6FF]/35 bg-[#58A6FF]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#7CC0FF]">
                NOAA
              </div>
              <button type="button" onClick={() => setWeatherCollapsed(true)} className="text-[#8B949E] hover:text-[#C9D1D9]">
                <ChevronUp size={14} />
              </button>
            </div>
          </div>
          <div className="grid gap-px bg-[#58A6FF]/10 p-px">
            {mapWeatherTargets.length ? mapWeatherTargets.map((target: Legacy) => {
              const TargetIcon = WEATHER_ICONS[target.iconKey] || Cloud
              return (
                <div
                  key={target.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 ${
                    target.active ? 'bg-[#131d28]' : 'bg-[#0d1117]/92'
                  }`}
                >
                  <div className={`rounded-[2px] border px-2 py-2 ${target.active ? 'border-[#58A6FF]/35 bg-[#58A6FF]/10' : 'border-[#30363D] bg-[#161b22]'}`}>
                    <TargetIcon size={16} className={target.active ? 'text-[#7CC0FF]' : 'text-[#8B949E]'} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                      {target.label}
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-[#E6EDF3]">{target.summary}</div>
                    <div className="mt-1 text-[10px] text-[#8B949E]">{target.placeLabel}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-black uppercase tracking-[0.08em] text-[#E6EDF3]">
                      {target.temperature}
                    </div>
                    {target.active ? (
                      <div className="mt-1 text-[8px] font-black uppercase tracking-[0.18em] text-[#7CC0FF]">
                        Focus
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            }) : (
              <div className="bg-[#0d1117]/92 px-4 py-4 text-[11px] text-[#8B949E]">
                Waiting for basecamp and Yosemite weather feeds.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
