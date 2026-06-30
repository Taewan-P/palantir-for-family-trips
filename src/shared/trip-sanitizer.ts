import type { LocationEntity, TripDocument } from './trip-types'

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
    accessNote: null,
    directionsNote: null,
    parkingNote: null,
    lockNote: null,
    wifiNetwork: null,
    wifiPassword: null,
    note: '',
  }
}

export function sanitizeTripForShare(document: TripDocument): TripDocument {
  return {
    ...document,
    pageNotes: {},
    pageNoteMeta: {},
    ui: {
      ...document.ui,
      searchQuery: '',
    },
    families: document.families.map((family) => ({ ...family, note: '' })),
    locations: document.locations.map(sanitizeLocation),
    routes: document.routes.map((route) => ({ ...route, note: '' })),
    itineraryItems: document.itineraryItems.map((item) => ({ ...item, note: '' })),
    meals: document.meals.map((meal) => ({ ...meal, note: '' })),
    activities: document.activities.map((activity) => ({ ...activity, note: '' })),
    stayItems: document.stayItems.map((item) => ({ ...item, note: '' })),
    expenses: document.expenses.map((expense) => ({ ...expense, note: '', allocations: {} })),
    tasks: document.tasks.map((task) => ({ ...task, note: '' })),
  }
}
