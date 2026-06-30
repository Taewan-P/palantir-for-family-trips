import { sanitizeTripForShare } from '../trip-sanitizer'
import type { TripDocument } from '../trip-types'

describe('sanitizeTripForShare', () => {
  it('removes private lodging and note fields', () => {
    const doc = {
      id: 'trip_1',
      title: 'Private Trip',
      selectedPage: 'stay',
      selection: { type: 'location', id: 'loc_1' },
      pageNotes: { stay: 'Door code is private' },
      pageNoteMeta: {},
      ui: {
        searchQuery: 'door',
        timeline: { mode: 'scenario', cursorSlot: 0 },
        map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
      },
      families: [],
      locations: [{
        id: 'loc_1',
        type: 'location',
        title: 'Cabin',
        category: 'stay',
        dayId: 'all',
        address: '123 Secret Lane',
        coordinates: { lat: 1, lng: 2 },
        confirmationCode: 'ABC123',
        hostName: 'Private Host',
        accessNote: 'Gate code 1234',
        externalUrl: 'https://booking.example/private',
        wifiNetwork: 'private-wifi',
        wifiPassword: 'secret',
        lockNote: 'Key under mat',
        photos: ['https://photos.example/private.jpg'],
        note: 'Owner phone is private',
      }],
      routes: [],
      itineraryItems: [],
      meals: [],
      activities: [],
      stayItems: [],
      expenses: [],
      tasks: [],
    } satisfies TripDocument

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.pageNotes).toEqual({})
    expect(sanitized.ui.searchQuery).toBe('')
    expect(sanitized.locations[0]?.address).toBe('Private lodging details hidden')
    expect(sanitized.locations[0]?.accessNote).toBeNull()
    expect(sanitized.locations[0]?.wifiPassword).toBeNull()
    expect(sanitized.locations[0]?.note).toBe('')
    expect(sanitized.locations[0]?.coordinates).toBeUndefined()
    expect(sanitized.locations[0]?.confirmationCode).toBeUndefined()
    expect(sanitized.locations[0]?.hostName).toBeUndefined()
    expect(sanitized.locations[0]?.externalUrl).toBeUndefined()
    expect(sanitized.locations[0]?.photos).toBeUndefined()
  })

  it('removes private family origin fields', () => {
    const doc = {
      id: 'trip_1',
      title: 'Private Trip',
      selectedPage: 'families',
      selection: { type: 'family', id: 'family_1' },
      pageNotes: {},
      pageNoteMeta: {},
      ui: {
        searchQuery: '',
        timeline: { mode: 'scenario', cursorSlot: 0 },
        map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
      },
      families: [{
        id: 'family_1',
        type: 'family',
        title: 'Parkers',
        origin: 'Los Angeles',
        shortOrigin: 'LA',
        originAddress: '2800 E Observatory Rd, Los Angeles, CA 90027',
        originCoordinates: { lat: 34.1184, lng: -118.3004 },
        note: 'Private note',
      }],
      locations: [],
      routes: [],
      itineraryItems: [],
      meals: [],
      activities: [],
      stayItems: [],
      expenses: [],
      tasks: [],
    } satisfies TripDocument

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.families[0]?.title).toBe('Parkers')
    expect(sanitized.families[0]?.origin).toBe('Los Angeles')
    expect(sanitized.families[0]?.shortOrigin).toBe('LA')
    expect(sanitized.families[0]?.note).toBe('')
    expect(sanitized.families[0]?.originAddress).toBeUndefined()
    expect(sanitized.families[0]?.originCoordinates).toBeUndefined()
  })

  it('removes private route origin geometry', () => {
    const doc = {
      id: 'trip_1',
      title: 'Private Trip',
      selectedPage: 'itinerary',
      selection: { type: 'route', id: 'route_1' },
      pageNotes: {},
      pageNoteMeta: {},
      ui: {
        searchQuery: '',
        timeline: { mode: 'scenario', cursorSlot: 0 },
        map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
      },
      families: [],
      locations: [],
      routes: [{
        id: 'route_1',
        type: 'route',
        title: 'Private inbound route',
        familyId: 'family_1',
        originCoordinates: { lat: 34.1184, lng: -118.3004 },
        path: [
          { lat: 34.1184, lng: -118.3004 },
          { lat: 37.8586, lng: -120.2142 },
        ],
        note: 'Private route note',
      }],
      itineraryItems: [],
      meals: [],
      activities: [],
      stayItems: [],
      expenses: [],
      tasks: [],
    } satisfies TripDocument

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.routes[0]?.title).toBe('Private inbound route')
    expect(sanitized.routes[0]?.familyId).toBe('family_1')
    expect(sanitized.routes[0]?.note).toBe('')
    expect(sanitized.routes[0]?.originCoordinates).toBeUndefined()
    expect(sanitized.routes[0]?.path).toBeUndefined()
  })
})
