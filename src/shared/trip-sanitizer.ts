import { projectTripDocument } from '../tripModel'
import type { FamilyEntity, LocationEntity, RouteEntity, TripDocument } from './trip-types'

function sanitizeFamily(family: FamilyEntity): FamilyEntity {
  const { originAddress, originCoordinates, ...safeFamily } = family
  return { ...safeFamily, note: '' }
}

function sanitizeLocation(location: LocationEntity): LocationEntity {
  if (location.category !== 'stay') {
    return { ...location, note: '' }
  }

  const { id, type, title, category, dayId, linkedEntityKeys, taskIds, createdByFamilyId, createdAt, lastEditedByFamilyId, lastEditedAt, status } = location

  return {
    id,
    type,
    title,
    category,
    ...(dayId === undefined ? {} : { dayId }),
    ...(linkedEntityKeys === undefined ? {} : { linkedEntityKeys: [...linkedEntityKeys] }),
    ...(taskIds === undefined ? {} : { taskIds: [...taskIds] }),
    ...(createdByFamilyId === undefined ? {} : { createdByFamilyId }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(lastEditedByFamilyId === undefined ? {} : { lastEditedByFamilyId }),
    ...(lastEditedAt === undefined ? {} : { lastEditedAt }),
    ...(status === undefined ? {} : { status }),
    address: 'Private lodging details hidden',
    note: '',
  }
}

function sanitizeRoute(route: RouteEntity): RouteEntity {
  const { originCoordinates, path, ...safeRoute } = route
  return { ...safeRoute, note: '' }
}

export function sanitizeTripForShare(document: TripDocument): TripDocument {
  const projected = projectTripDocument(document, 'public')

  return {
    ...projected,
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
    stayItems: projected.stayItems.map((item) => ({ ...item, note: '' })),
    expenses: projected.expenses.map((expense) => ({ ...expense, note: '', allocations: {} })),
    tasks: projected.tasks.map((task) => ({ ...task, note: '' })),
  }
}
