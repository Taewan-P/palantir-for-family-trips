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
})
