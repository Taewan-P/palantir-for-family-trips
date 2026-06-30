import { parsePersistedTripDocument, projectTripDocument } from '../../tripModel'
import { createTripFromTemplate } from '../trip-template'
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

describe('createTripFromTemplate', () => {
  it('creates a fresh document with the requested id and title', () => {
    const trip = createTripFromTemplate({ id: 'trip_abc', title: 'Tahoe Weekend' })

    expect(trip.id).toBe('trip_abc')
    expect(trip.title).toBe('Tahoe Weekend')
    expect(trip.families.length).toBeGreaterThan(0)
    expect(trip.activities.length).toBeGreaterThan(0)
    expect(trip.ui.searchQuery).toBe('')
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
