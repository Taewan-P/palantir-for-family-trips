import { parsePersistedTripDocument, projectTripDocument } from '../../tripModel'
import { createGuidedTripDocument, createTripFromTemplate, normalizeMemberTripCopy } from '../trip-template'
import type { JsonObject, JsonValue } from '../json'

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasLabel(value: JsonValue | undefined): value is JsonObject & { label: string } {
  return isJsonObject(value) && typeof value.label === 'string'
}

function getPhotoArray(value: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(value) ? value : null
}

describe('createGuidedTripDocument', () => {
  it('creates a blank trip document from guided setup input', () => {
    const doc = createGuidedTripDocument({
      title: 'Japan Summer 2026',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      destinationName: 'Tokyo',
      basecampAddress: '1 Chome Marunouchi, Tokyo',
      families: [
        { displayName: 'Park Household', origin: 'Seoul', adults: 2, kids: 1 },
        { displayName: 'Kim Household', origin: 'Busan', adults: 1, kids: 2 },
      ],
    })

    expect(doc.title).toBe('Japan Summer 2026')
    expect(doc.templateKind).toBe('guided')
    expect(doc.selectedPage).toBe('families')
    expect(doc.selection).toEqual({ type: 'family', id: 'family_1' })
    expect(doc.days).toHaveLength(3)
    expect(doc.days?.map((day) => day.date)).toEqual([
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ])
    expect(doc.families.map((family) => family.title)).toEqual([
      'Park Household',
      'Kim Household',
    ])
    expect(doc.families[0]).toMatchObject({
      assignedUserId: null,
      assignedUserEmail: null,
      headcount: '2 adults, 1 kid',
      origin: 'Seoul',
    })
    expect(doc.families[1]).toMatchObject({
      assignedUserId: null,
      assignedUserEmail: null,
      headcount: '1 adult, 2 kids',
      origin: 'Busan',
    })
    expect(doc.locations).toEqual([{
      id: 'location_destination',
      type: 'location',
      title: 'Tokyo',
      category: 'destination',
    }])
    expect(doc.stayItems).toEqual([{
      id: 'stay_basecamp',
      type: 'stayItem',
      title: 'Tokyo Basecamp',
      category: 'basecamp',
      address: '1 Chome Marunouchi, Tokyo',
      locationId: 'location_destination',
    }])
    expect(doc.routes).toEqual([])
    expect(doc.itineraryItems).toEqual([])
    expect(doc.meals).toEqual([])
    expect(doc.activities).toEqual([])
    expect(doc.expenses).toEqual([])
    expect(doc.tasks).toEqual([])
  })

  it('does not include seeded names or copied demo content', () => {
    const serialized = JSON.stringify(
      createGuidedTripDocument({
        title: 'Real Trip',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        destinationName: 'Osaka',
        families: [{ displayName: 'Lee Family', adults: 2, kids: 0 }],
      }),
    )

    expect(serialized).not.toContain('Parkers')
    expect(serialized).not.toContain('Jiangs')
    expect(serialized).not.toContain('Riveras')
    expect(serialized).not.toContain('Duckfat')
    expect(serialized).not.toContain('Portland Head Light')
  })

  it('throws when destination is blank', () => {
    expect(() =>
      createGuidedTripDocument({
        title: 'Real Trip',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        destinationName: '   ',
        families: [{ displayName: 'Lee Family', adults: 2, kids: 0 }],
      }),
    ).toThrow('Destination name is required')
  })

  it('throws when family headcount values are invalid', () => {
    for (const counts of [
      { adults: -1, kids: 1 },
      { adults: 1.5, kids: 1 },
      { adults: Number.POSITIVE_INFINITY, kids: 1 },
      { adults: 1, kids: Number.NaN },
    ]) {
      expect(() =>
        createGuidedTripDocument({
          title: 'Real Trip',
          startDate: '2026-08-01',
          endDate: '2026-08-01',
          destinationName: 'Osaka',
          families: [{ displayName: 'Lee Family', ...counts }],
        }),
      ).toThrow('Family headcount must use finite non-negative integers')
    }
  })

  it('throws when family headcount is zero', () => {
    expect(() =>
      createGuidedTripDocument({
        title: 'Real Trip',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        destinationName: 'Osaka',
        families: [{ displayName: 'Lee Family', adults: 0, kids: 0 }],
      }),
    ).toThrow('Family headcount must include at least one person')
  })

  it('reloads persisted guided trips without seeded fallback data', () => {
    const persisted = createGuidedTripDocument({
      title: 'Real Trip',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      destinationName: 'Osaka',
      families: [{ displayName: 'Lee Family', adults: 2, kids: 0 }],
    })

    const parsed = parsePersistedTripDocument(JSON.stringify(persisted))

    expect(parsed.templateKind).toBe('guided')
    expect(parsed.days).toEqual(persisted.days)
    expect(parsed.families).toEqual(persisted.families)
    expect(parsed.routes).toEqual([])
    expect(parsed.itineraryItems).toEqual([])
    expect(parsed.meals).toEqual([])
    expect(parsed.activities).toEqual([])
    expect(parsed.expenses).toEqual([])
    expect(parsed.tasks).toEqual([])
  })
})

describe('createTripFromTemplate', () => {
  it('creates a fresh document with the requested id and title', () => {
    const trip = createTripFromTemplate({ id: 'trip_abc', title: 'Tahoe Weekend' })

    expect(trip.id).toBe('trip_abc')
    expect(trip.title).toBe('Tahoe Weekend')
    expect(trip.templateKind).toBe('seeded')
    expect(trip.families.length).toBeGreaterThan(0)
    expect(trip.activities.length).toBeGreaterThan(0)
    expect(trip.ui.searchQuery).toBe('')
  })

  it('does not seed member trips with public-share redaction copy', () => {
    const trip = createTripFromTemplate({ id: 'trip_member', title: 'Member Trip' })
    const text = JSON.stringify(trip).toLowerCase()

    expect(text).not.toContain('sanitized demo')
    expect(text).not.toContain('public version')
    expect(text).not.toContain('public trip unit')
    expect(text).not.toContain('intentionally withheld')
    expect(text).not.toContain('intentionally generalized')
    expect(text).not.toContain('intentionally simplified')
    expect(text).not.toContain('intentionally redacted')
  })

  it('repairs legacy member snapshots without dropping custom entities', () => {
    const trip = createTripFromTemplate({ id: 'trip_legacy', title: 'Legacy Trip' })
    trip.locations[0]!.accessNote = 'Arrival and access details are intentionally redacted in the public version.'
    trip.stayItems[0]!.summary = 'Basecamp operations run through the public Groveland-area staging house.'
    trip.families[0]!.note = 'Public trip unit used for same-day Bay Area arrival coverage.'
    trip.meals.push({ id: 'custom-meal', type: 'meal', title: 'Custom meal', dayId: 'thu' })

    const normalized = normalizeMemberTripCopy(trip)
    const text = JSON.stringify(normalized).toLowerCase()

    expect(text).not.toContain('public version')
    expect(text).not.toContain('public trip unit')
    expect(normalized.meals.some((meal) => meal.id === 'custom-meal')).toBe(true)
  })

  it('does not share mutable nested seed data between generated trips', () => {
    const first = createTripFromTemplate({ id: 'trip_one', title: 'First Trip' })
    const second = createTripFromTemplate({ id: 'trip_two', title: 'Second Trip' })

    const firstLocation = first.locations.find((location) => location.coordinates && getPhotoArray(location.photos)?.length)
    const secondLocation = second.locations.find((location) => location.id === firstLocation?.id)
    const firstRoute = first.routes.find((route) => route.path?.length && route.simulationMilestones?.length)
    const secondRoute = second.routes.find((route) => route.id === firstRoute?.id)
    const firstPhotos = getPhotoArray(firstLocation?.photos)
    const secondPhotos = getPhotoArray(secondLocation?.photos)
    expect(firstLocation?.coordinates).toBeDefined()
    expect(firstPhotos?.[0]).toBeDefined()
    expect(secondLocation?.coordinates).toBeDefined()
    expect(secondPhotos?.[0]).toBeDefined()
    expect(firstRoute?.path?.[0]).toBeDefined()
    expect(secondRoute?.path?.[0]).toBeDefined()
    expect(firstRoute?.simulationMilestones?.[0]).toBeDefined()
    expect(secondRoute?.simulationMilestones?.[0]).toBeDefined()

    const originalSecondSelectionId = second.selection.id
    const originalSecondLat = secondLocation?.coordinates?.lat
    const originalSecondRouteLat = secondRoute?.path?.[0]?.lat
    const originalSecondMilestone = { ...secondRoute!.simulationMilestones![0]! }
    const originalSecondPhotoLabel = hasLabel(secondPhotos?.[0]) ? secondPhotos[0].label : undefined

    first.selection.id = 'mutated-selection'
    firstLocation!.coordinates!.lat = 0
    firstRoute!.path![0]!.lat = 0
    firstRoute!.simulationMilestones![0]!.progress = 0.99
    if (hasLabel(firstPhotos?.[0])) {
      firstPhotos[0].label = 'Mutated media'
    }
    firstPhotos!.push({
      id: 'mutated-photo',
      label: 'Mutated extra media',
      imageUrl: 'https://example.com/mutated.jpg',
      sourceUrl: null,
    })

    const later = createTripFromTemplate({ id: 'trip_three', title: 'Third Trip' })
    const laterLocation = later.locations.find((location) => location.id === firstLocation?.id)
    const laterRoute = later.routes.find((route) => route.id === firstRoute?.id)
    const laterPhotos = getPhotoArray(laterLocation?.photos)

    expect(second.selection.id).toBe(originalSecondSelectionId)
    expect(secondLocation?.coordinates?.lat).toBe(originalSecondLat)
    expect(secondRoute?.path?.[0]?.lat).toBe(originalSecondRouteLat)
    expect(secondRoute?.simulationMilestones?.[0]).toEqual(originalSecondMilestone)
    expect(hasLabel(secondPhotos?.[0]) ? secondPhotos[0].label : undefined).toBe(originalSecondPhotoLabel)
    expect(secondPhotos).toHaveLength(firstPhotos!.length - 1)
    expect(later.selection.id).toBe(originalSecondSelectionId)
    expect(laterLocation?.coordinates?.lat).toBe(originalSecondLat)
    expect(laterRoute?.path?.[0]?.lat).toBe(originalSecondRouteLat)
    expect(laterRoute?.simulationMilestones?.[0]).toEqual(originalSecondMilestone)
    expect(hasLabel(laterPhotos?.[0]) ? laterPhotos[0].label : undefined).toBe(originalSecondPhotoLabel)
  })

  it('projects public trips without family origins or route geometry', () => {
    const trip = createTripFromTemplate({ id: 'trip_public', title: 'Public Trip' })

    expect(trip.families.some((family) => family.originAddress || family.originCoordinates)).toBe(true)
    expect(trip.routes.some((route) => route.originCoordinates || route.path?.length)).toBe(true)

    const projected = projectTripDocument(trip, 'public')

    expect(projected.families.every((family) => family.originAddress === undefined)).toBe(true)
    expect(projected.families.every((family) => family.originCoordinates === undefined)).toBe(true)
    expect(projected.routes.every((route) => route.originCoordinates === undefined)).toBe(true)
    expect(projected.routes.every((route) => route.path === undefined)).toBe(true)
  })

  it('parses persisted trip documents through a validated snapshot path', () => {
    const fallback = createTripFromTemplate({ id: 'fallback', title: 'Fallback Trip' })
    const persisted = createTripFromTemplate({ id: 'persisted', title: 'Persisted Trip' })
    persisted.families[0]!.status = 'Custom status'

    const parsed = parsePersistedTripDocument(JSON.stringify(persisted), fallback)

    expect(parsed.id).toBe('persisted')
    expect(parsed.title).toBe('Persisted Trip')
    expect(parsed.families[0]?.status).toBe('Custom status')
    expect(parsePersistedTripDocument('{"locations":[]}', fallback).families.length).toBeGreaterThan(0)
    expect(parsePersistedTripDocument('{not json', fallback)).toBe(fallback)
  })

  it('does not let malformed nested persisted values survive as trip state', () => {
    const fallback = createTripFromTemplate({ id: 'fallback', title: 'Fallback Trip' })
    const persisted = createTripFromTemplate({ id: 'persisted', title: 'Persisted Trip' })
    const malformed = {
      ...persisted,
      families: [{ ...persisted.families[0], note: {} }],
      meals: [123],
      tasks: [{ id: 'x', type: 'task', title: 'Broken task', status: 42 }],
    }

    const parsed = parsePersistedTripDocument(JSON.stringify(malformed), fallback)

    expect(parsed.meals.every((meal) => meal.type === 'meal' && typeof meal.id === 'string')).toBe(true)
    expect(parsed.tasks.every((task) => task.type === 'task' && typeof task.status === 'string')).toBe(true)
    expect(parsed.families.every((family) => family.note === undefined || typeof family.note === 'string')).toBe(true)
    expect(parsed.meals).not.toContain(123)
    expect(parsed.tasks.some((task) => task.id === 'x')).toBe(false)
  })
})
