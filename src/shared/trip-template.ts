import { createInitialTripDocument } from '../tripModel'
import type {
  CreateGuidedTripRequest,
  FamilyEntity,
  LocationEntity,
  StayItemEntity,
  TripDay,
  TripDocument,
} from './trip-types'

export type CreateTripFromTemplateInput = {
  id: string
  title: string
}

const MEMBER_COPY_REPLACEMENTS = new Map([
  ['Community access details are intentionally withheld in the sanitized demo.', 'Confirm community access, guest passes, and the arrival handoff before departure.'],
  ['Parking guidance is intentionally simplified in the sanitized demo.', 'Confirm vehicle count, parking capacity, and Friday local movement before arrival.'],
  ['Use the Pine Mountain Lake waypoint for planning. Exact arrival instructions are intentionally withheld.', 'Use the Pine Mountain Lake waypoint for approach planning; add exact host directions when confirmed.'],
  ['Community access details withheld', 'Confirm community vehicle fees and guest-pass requirements'],
  ['Arrival and access details are intentionally redacted in the public version.', 'Confirm community access, guest passes, and the arrival handoff before departure.'],
  ['Basecamp operations run through the public Groveland-area staging house.', 'Basecamp operations run through the Groveland-area staging house.'],
  ['Arrival logistics are intentionally generalized in the public version.', 'Confirm community access, guest passes, and the arrival handoff before departure.'],
  ['Sleeping assignments are intentionally generalized in the public version.', 'Room assignments should be confirmed before first arrival.'],
  ['Parking guidance is intentionally simplified in the public version.', 'Confirm vehicle count, parking capacity, and Friday local movement before arrival.'],
  ['Arrival details are intentionally kept high level in the public version.', 'Confirm arrival details before Thursday departures.'],
  ['Public trip unit used for same-day Bay Area arrival coverage.', 'Thursday arrival unit for Bay Area coverage.'],
  ['Public trip unit used for the delayed-arrival branch of the plan.', 'Friday arrival unit for the delayed-arrival branch of the plan.'],
])

function repairMemberCopy(value: string | null | undefined): string | undefined {
  return typeof value === 'string' ? MEMBER_COPY_REPLACEMENTS.get(value) || value : undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Expected YYYY-MM-DD date: ${value}`)

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (formatDate(date) !== value) throw new Error(`Invalid trip date: ${value}`)
  return date
}

function buildTripDays(startDate: string, endDate: string): TripDay[] {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (end < start) throw new Error('Trip end date must be on or after the start date')

  const days: TripDay[] = []
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    const date = new Date(time)
    const dateText = formatDate(date)
    const index = days.length + 1
    days.push({
      id: `day_${dateText.replaceAll('-', '_')}`,
      date: dateText,
      title: `Day ${index}`,
      shortLabel: `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      code: `D${index}`,
    })
  }

  return days
}

function formatHeadcount(adults: number, kids: number): string {
  return `${adults} ${adults === 1 ? 'adult' : 'adults'}, ${kids} ${kids === 1 ? 'kid' : 'kids'}`
}

function isHeadcountValue(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

export function normalizeMemberTripCopy(document: TripDocument): TripDocument {
  return {
    ...document,
    families: document.families.map((family) => ({ ...family, note: repairMemberCopy(family.note) })),
    locations: document.locations.map((location) => ({
      ...location,
      accessNote: repairMemberCopy(location.accessNote),
      directionsNote: repairMemberCopy(location.directionsNote),
      parkingNote: repairMemberCopy(location.parkingNote),
      vehicleFee: repairMemberCopy(location.vehicleFee),
    })),
    stayItems: document.stayItems.map((item) => ({
      ...item,
      summary: repairMemberCopy(item.summary),
      note: repairMemberCopy(item.note),
    })),
  }
}

export function createTripFromTemplate(input: CreateTripFromTemplateInput): TripDocument {
  const document = createInitialTripDocument()
  return normalizeMemberTripCopy({
    ...document,
    id: input.id,
    title: input.title,
    templateKind: 'seeded',
    ui: {
      ...document.ui,
      searchQuery: '',
    },
  })
}

export function createGuidedTripDocument(input: CreateGuidedTripRequest): TripDocument {
  const title = input.title.trim()
  const destinationName = input.destinationName.trim()
  if (!title) throw new Error('Trip title is required')
  if (!destinationName) throw new Error('Destination name is required')
  if (input.families.length === 0) throw new Error('At least one family is required')

  const days = buildTripDays(input.startDate, input.endDate)
  const families: FamilyEntity[] = input.families.map((family, index) => {
    const familyTitle = family.displayName.trim()
    if (!familyTitle) throw new Error('Family display name is required')
    if (!isHeadcountValue(family.adults) || !isHeadcountValue(family.kids)) {
      throw new Error('Family headcount must use finite non-negative integers')
    }
    if (family.adults + family.kids < 1) {
      throw new Error('Family headcount must include at least one person')
    }
    return {
      id: `family_${index + 1}`,
      type: 'family',
      title: familyTitle,
      name: familyTitle,
      assignedUserId: null,
      assignedUserEmail: null,
      origin: family.origin?.trim() || 'Unspecified origin',
      arrivalDayId: days[0]?.id,
      headcount: formatHeadcount(family.adults, family.kids),
      plannedStopIds: [],
      taskIds: [],
      linkedEntityKeys: [],
    }
  })
  const basecampAddress = input.basecampAddress?.trim()
  const destination: LocationEntity = {
    id: 'location_destination',
    type: 'location',
    title: destinationName,
    category: 'destination',
  }
  const stayItems: StayItemEntity[] = [{
    id: 'stay_basecamp',
    type: 'stayItem',
    title: `${destinationName} Basecamp`,
    category: 'basecamp',
    address: basecampAddress || undefined,
    locationId: destination.id,
  }]
  const selectedFamilyId = families[0]!.id

  return {
    title,
    templateKind: 'guided',
    days,
    selectedPage: 'families',
    selection: { type: 'family', id: selectedFamilyId },
    pageNotes: {
      itinerary: '',
      stay: '',
      meals: '',
      activities: '',
      expenses: '',
      families: '',
    },
    pageNoteMeta: {},
    ui: {
      searchQuery: '',
      timeline: {
        mode: 'scenario',
        cursorSlot: 0,
      },
      map: {
        showRoutes: true,
        showFacilities: true,
        showTraffic: false,
        focusFamilyId: selectedFamilyId || 'all',
        focusDayId: days[0]?.id || 'all',
      },
    },
    families,
    locations: [destination],
    routes: [],
    itineraryItems: [],
    meals: [],
    activities: [],
    stayItems,
    expenses: [],
    tasks: [],
  }
}
