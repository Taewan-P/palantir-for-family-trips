import { sanitizeTripForShare } from '../trip-sanitizer'
import { createGuidedTripDocument } from '../trip-template'
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
    expect(sanitized.locations[0]?.note).toBe('')
    expect(sanitized.locations[0]?.coordinates).toBeUndefined()
    expect(sanitized.locations[0]?.accessNote).toBeUndefined()
    expect(sanitized.locations[0]?.wifiNetwork).toBeUndefined()
    expect(sanitized.locations[0]?.wifiPassword).toBeUndefined()
    expect(sanitized.locations[0]?.lockNote).toBeUndefined()
    expect(sanitized.locations[0]?.parkingNote).toBeUndefined()
    expect(sanitized.locations[0]?.directionsNote).toBeUndefined()
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

  it('removes guided trip account assignments and exact lodging operations from public shares', () => {
    const doc = createGuidedTripDocument({
      title: 'Family Yosemite Operations',
      startDate: '2026-04-09',
      endDate: '2026-04-11',
      destinationName: 'Yosemite',
      basecampAddress: '123 Secret Basecamp Lane, Groveland, CA',
      families: [{ displayName: 'Parker Family', origin: 'Los Angeles', adults: 2, kids: 1 }],
    })

    doc.families[0] = {
      ...doc.families[0]!,
      assignedUserId: 'user_private_123',
      assignedUserEmail: 'private-family@example.com',
    }
    doc.days![0] = { ...doc.days![0]!, note: 'Private arrival coordination note' }
    doc.locations[0] = {
      ...doc.locations[0]!,
      address: 'Exact Yosemite meetup pin, Groveland, CA',
      coordinates: { lat: 37.8631, lng: -119.5383 },
      accessNote: 'Gate keypad code 4455',
      directionsNote: 'Turn behind the unmarked service road',
      parkingNote: 'Park in host driveway bay 2',
      wifiNetwork: 'Private Cabin WiFi',
      wifiPassword: 'super-secret-wifi',
      lockNote: 'Lockbox 7788',
      hostName: 'Host Alice',
      coHostName: 'Co-host Bob',
      guestSummary: 'Private guest roster',
      confirmationCode: 'CONF-SECRET-1',
      phoneNumber: '+1-555-0100',
      reservationNote: 'Internal booking note',
      privateNotes: 'Owner contact is private',
      privateDoorCode: '4455',
    }
    doc.stayItems[0] = {
      ...doc.stayItems[0]!,
      summary: 'Basecamp summary safe for rendering',
      note: 'Private basecamp note',
      accessNote: 'Stay gate code 9911',
      directionsNote: 'Stay private driveway directions',
      parkingNote: 'Stay reserved parking stall',
      wifiNetwork: 'Stay Private WiFi',
      wifiPassword: 'stay-wifi-secret',
      lockNote: 'Stay lockbox code',
      hostName: 'Stay Host',
      coHostName: 'Stay Co-host',
      guestSummary: 'Stay private guest roster',
      confirmationCode: 'STAY-CONF-SECRET',
      reservationNote: 'Stay private reservation note',
    }

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.families[0]?.title).toBe('Parker Family')
    expect(sanitized.families[0]?.assignedUserId).toBeUndefined()
    expect(sanitized.families[0]?.assignedUserEmail).toBeUndefined()
    expect(sanitized.days?.[0]?.note).toBe('')

    expect(sanitized.locations[0]?.title).toBe('Yosemite')
    expect(sanitized.locations[0]?.category).toBe('destination')
    expect(sanitized.locations[0]?.address).toBeUndefined()
    expect(sanitized.locations[0]?.coordinates).toBeUndefined()
    expect(sanitized.locations[0]?.accessNote).toBeUndefined()
    expect(sanitized.locations[0]?.directionsNote).toBeUndefined()
    expect(sanitized.locations[0]?.parkingNote).toBeUndefined()
    expect(sanitized.locations[0]?.wifiNetwork).toBeUndefined()
    expect(sanitized.locations[0]?.wifiPassword).toBeUndefined()
    expect(sanitized.locations[0]?.lockNote).toBeUndefined()
    expect(sanitized.locations[0]?.hostName).toBeUndefined()
    expect(sanitized.locations[0]?.coHostName).toBeUndefined()
    expect(sanitized.locations[0]?.guestSummary).toBeUndefined()
    expect(sanitized.locations[0]?.confirmationCode).toBeUndefined()
    expect(sanitized.locations[0]?.phoneNumber).toBeUndefined()
    expect(sanitized.locations[0]?.reservationNote).toBeUndefined()
    expect(sanitized.locations[0]?.privateNotes).toBeUndefined()
    expect(sanitized.locations[0]?.privateDoorCode).toBeUndefined()

    expect(sanitized.stayItems[0]?.title).toBe('Yosemite Basecamp')
    expect(sanitized.stayItems[0]?.category).toBe('basecamp')
    expect(sanitized.stayItems[0]?.summary).toBe('Basecamp summary safe for rendering')
    expect(sanitized.stayItems[0]?.address).toBeUndefined()
    expect(sanitized.stayItems[0]?.note).toBe('')
    expect(sanitized.stayItems[0]?.accessNote).toBeUndefined()
    expect(sanitized.stayItems[0]?.directionsNote).toBeUndefined()
    expect(sanitized.stayItems[0]?.parkingNote).toBeUndefined()
    expect(sanitized.stayItems[0]?.wifiNetwork).toBeUndefined()
    expect(sanitized.stayItems[0]?.wifiPassword).toBeUndefined()
    expect(sanitized.stayItems[0]?.lockNote).toBeUndefined()
    expect(sanitized.stayItems[0]?.hostName).toBeUndefined()
    expect(sanitized.stayItems[0]?.coHostName).toBeUndefined()
    expect(sanitized.stayItems[0]?.guestSummary).toBeUndefined()
    expect(sanitized.stayItems[0]?.confirmationCode).toBeUndefined()
    expect(sanitized.stayItems[0]?.reservationNote).toBeUndefined()
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

  it('generalizes stay item summaries before sharing', () => {
    const doc = {
      id: 'trip_1',
      title: 'Private Trip',
      selectedPage: 'stay',
      selection: { type: 'stayItem', id: 'stay-gate-access' },
      pageNotes: {},
      pageNoteMeta: {},
      ui: {
        searchQuery: '',
        timeline: { mode: 'scenario', cursorSlot: 0 },
        map: { showRoutes: true, showFacilities: true, showTraffic: false, focusFamilyId: 'all', focusDayId: 'all' },
      },
      families: [],
      locations: [],
      routes: [],
      itineraryItems: [],
      meals: [],
      activities: [],
      stayItems: [{
        id: 'stay-gate-access',
        type: 'stayItem',
        title: 'Gate and access protocol',
        category: 'access',
        summary: 'Confirm community access, guest passes, and the arrival handoff before departure.',
        note: 'Private access note',
      }],
      expenses: [],
      tasks: [],
    } satisfies TripDocument

    const sanitized = sanitizeTripForShare(doc)

    expect(sanitized.stayItems[0]?.summary).toBe('Arrival logistics are intentionally generalized in the public version.')
    expect(sanitized.stayItems[0]?.summary).not.toContain('guest passes')
    expect(sanitized.stayItems[0]?.note).toBe('')
  })
})
