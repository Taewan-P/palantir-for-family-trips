import { projectTripDocument } from '../tripModel'
import type { FamilyEntity, LocationEntity, RouteEntity, StayItemEntity, TripDocument } from './trip-types'

function sanitizeFamily(family: FamilyEntity): FamilyEntity {
  const { assignedUserId, assignedUserEmail, originAddress, originCoordinates, ...safeFamily } = family
  return { ...safeFamily, note: '' }
}

function sanitizeLocation(location: LocationEntity): LocationEntity {
  const sanitized: LocationEntity = {
    id: location.id,
    type: 'location',
    title: location.title,
    category: location.category,
    note: '',
  }

  if (typeof location.name === 'string') sanitized.name = location.name
  if (typeof location.dayId === 'string') sanitized.dayId = location.dayId
  if (typeof location.summary === 'string') sanitized.summary = location.summary
  if (Array.isArray(location.linkedEntityKeys)) sanitized.linkedEntityKeys = [...location.linkedEntityKeys]
  if (Array.isArray(location.taskIds)) sanitized.taskIds = [...location.taskIds]
  if (Array.isArray(location.familyIds)) sanitized.familyIds = [...location.familyIds]
  if (typeof location.createdByFamilyId === 'string' || location.createdByFamilyId === null) {
    sanitized.createdByFamilyId = location.createdByFamilyId
  }
  if (typeof location.createdAt === 'string') sanitized.createdAt = location.createdAt
  if (typeof location.lastEditedByFamilyId === 'string' || location.lastEditedByFamilyId === null) {
    sanitized.lastEditedByFamilyId = location.lastEditedByFamilyId
  }
  if (typeof location.lastEditedAt === 'string') sanitized.lastEditedAt = location.lastEditedAt
  if (typeof location.status === 'string') sanitized.status = location.status
  if (typeof location.websiteUrl === 'string') sanitized.websiteUrl = location.websiteUrl
  if (typeof location.stopType === 'string') sanitized.stopType = location.stopType
  if (typeof location.placesQuery === 'string') sanitized.placesQuery = location.placesQuery
  if (typeof location.placeId === 'string') sanitized.placeId = location.placeId
  if (typeof location.rating === 'number' && Number.isFinite(location.rating)) sanitized.rating = location.rating
  if (typeof location.userRatingsTotal === 'number' && Number.isFinite(location.userRatingsTotal)) {
    sanitized.userRatingsTotal = location.userRatingsTotal
  }
  if (Array.isArray(location.openingHours)) {
    sanitized.openingHours = location.openingHours.filter((item): item is string => typeof item === 'string')
  }
  if (location.basecampDrive && typeof location.basecampDrive === 'object') {
    sanitized.basecampDrive = {
      ...(typeof location.basecampDrive.durationText === 'string'
        ? { durationText: location.basecampDrive.durationText }
        : {}),
      ...(typeof location.basecampDrive.distanceText === 'string'
        ? { distanceText: location.basecampDrive.distanceText }
        : {}),
    }
  }
  if (location.category === 'stay') sanitized.address = 'Private lodging details hidden'

  return sanitized
}

function sanitizeStayItem(item: StayItemEntity): StayItemEntity {
  const {
    address,
    accessNote,
    directionsNote,
    parkingNote,
    lockNote,
    wifiNetwork,
    wifiPassword,
    hostName,
    coHostName,
    guestSummary,
    confirmationCode,
    reservationNote,
    phoneNumber,
    externalUrl,
    manualUrl,
    ...safeItem
  } = item
  const safeItemWithAliases = { ...safeItem } as StayItemEntity & Record<string, unknown>
  delete safeItemWithAliases.privateNotes
  delete safeItemWithAliases.operationalNote
  delete safeItemWithAliases.operationalNotes
  delete safeItemWithAliases.hostContact
  delete safeItemWithAliases.contactName
  delete safeItemWithAliases.contactEmail
  delete safeItemWithAliases.contactPhone

  return { ...safeItemWithAliases, note: '' }
}

function sanitizeRoute(route: RouteEntity): RouteEntity {
  const { originCoordinates, path, ...safeRoute } = route
  return { ...safeRoute, note: '' }
}

export function sanitizeTripForShare(document: TripDocument): TripDocument {
  const projected = projectTripDocument(document, 'public')

  return {
    ...projected,
    days: projected.days?.map((day) => ({ ...day, note: '' })),
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      ...projected.ui,
      searchQuery: '',
    },
    families: projected.families.map(sanitizeFamily),
    locations: projected.locations.map(sanitizeLocation),
    routes: projected.routes.map(sanitizeRoute),
    itineraryItems: projected.itineraryItems.map((item) => ({ ...item, note: '' })),
    meals: projected.meals.map((meal) => ({ ...meal, note: '' })),
    activities: projected.activities.map((activity) => ({ ...activity, note: '' })),
    stayItems: projected.stayItems.map(sanitizeStayItem),
    expenses: projected.expenses.map((expense) => ({ ...expense, note: '', allocations: {} })),
    tasks: projected.tasks.map((task) => ({ ...task, note: '' })),
  }
}
