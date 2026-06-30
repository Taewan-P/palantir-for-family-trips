import { DAYS } from './tripData'
import type { Coordinates } from './shared/trip-types'

const WEATHER_API_ROOT = 'https://api.weather.gov'
const DEFAULT_ACCEPT_HEADERS = {
  Accept: 'application/geo+json',
}

type DayId = (typeof DAYS)[number]['id']
type WeatherTargetKey = 'basecamp' | 'yosemite'

type ForecastPeriod = {
  startTime: string
  isDaytime?: boolean
  shortForecast?: string
  temperature?: number
  temperatureUnit?: string
}

export type WeatherBundle = {
  label: string
  coordinates: Coordinates
  placeLabel: string
  forecastPeriods: ForecastPeriod[]
  hourlyPeriods: ForecastPeriod[]
  live: {
    summary: string
    temperature: string
    iconKey: string
    timestamp: string | null
    wind: unknown
  }
}

export type WeatherBundleMap = Partial<Record<WeatherTargetKey, WeatherBundle>>

export type TripDayWeather = (typeof DAYS)[number] & {
  weather: string
  temperature: string
  weatherIconKey: string
  weatherLocation: string
}

export type MapWeather = {
  label: string
  placeLabel: string
  summary: string
  temperature: string
  iconKey: string
}

export type MapWeatherTarget = MapWeather & {
  id: WeatherTargetKey
  active: boolean
}

export const DAY_WEATHER_TARGET: Record<DayId, WeatherTargetKey> = {
  thu: 'basecamp',
  fri: 'basecamp',
  sat: 'yosemite',
  sun: 'basecamp',
}

function parseTripDate(dayId: DayId, year = new Date().getFullYear()): Date | null {
  const day = DAYS.find((item) => item.id === dayId)
  const match = day?.shortLabel?.match(/(\d{1,2})\/(\d{1,2})/)
  if (!match) return null

  const month = Number(match[1]) - 1
  const date = Number(match[2])
  return new Date(Date.UTC(year, month, date))
}

function toIsoDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function getWeatherIconKey(condition = ''): string {
  const text = condition.toLowerCase()

  if (text.includes('thunder')) return 'storm'
  if (text.includes('snow')) return 'snow'
  if (text.includes('rain') || text.includes('shower') || text.includes('drizzle')) return 'rain'
  if (text.includes('fog') || text.includes('haze') || text.includes('smoke')) return 'fog'
  if (text.includes('wind') || text.includes('breezy')) return 'wind'
  if (text.includes('sunny') || text.includes('clear')) return 'sun'
  if (text.includes('partly') || text.includes('mostly')) return 'partly'
  if (text.includes('cloud')) return 'cloud'
  return 'cloud'
}

function celsiusToFahrenheit(value: unknown): number | null {
  if (typeof value !== 'number') return null
  return Math.round((value * 9) / 5 + 32)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => asRecord(current)[key], value)
}

function formatObservationTemperature(observation: unknown): string | null {
  const celsius = readPath(observation, ['properties', 'temperature', 'value'])
  const fahrenheit = celsiusToFahrenheit(celsius)
  return fahrenheit == null ? null : `${fahrenheit} F`
}

async function fetchWeatherJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: DEFAULT_ACCEPT_HEADERS })
  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`)
  }
  return response.json()
}

async function fetchLatestObservation(stationsUrl?: string): Promise<unknown | null> {
  if (!stationsUrl) return null

  const stations = await fetchWeatherJson(stationsUrl)
  const firstStation = readPath(stations, ['features', '0'])
  const stationUrl = readPath(firstStation, ['id']) || readPath(firstStation, ['properties', '@id'])
  if (typeof stationUrl !== 'string') return null

  return fetchWeatherJson(`${stationUrl}/observations/latest`)
}

export async function fetchWeatherBundle({ label, coordinates }: { label: string; coordinates?: Coordinates | null }): Promise<WeatherBundle | null> {
  if (!coordinates?.lat || !coordinates?.lng) return null

  const points = await fetchWeatherJson(`${WEATHER_API_ROOT}/points/${coordinates.lat},${coordinates.lng}`)
  const pointProps = asRecord(readPath(points, ['properties']))
  const relativeLocation = asRecord(readPath(pointProps, ['relativeLocation', 'properties']))
  const forecastUrl = pointProps.forecast
  const forecastHourlyUrl = pointProps.forecastHourly
  const observationStationsUrl = pointProps.observationStations

  const [forecast, hourly, observation] = await Promise.all([
    typeof forecastUrl === 'string' ? fetchWeatherJson(forecastUrl) : Promise.resolve(null),
    typeof forecastHourlyUrl === 'string' ? fetchWeatherJson(forecastHourlyUrl) : Promise.resolve(null),
    typeof observationStationsUrl === 'string' ? fetchLatestObservation(observationStationsUrl) : Promise.resolve(null),
  ])

  const forecastPeriods = readPath(forecast, ['properties', 'periods'])
  const hourlyPeriods = readPath(hourly, ['properties', 'periods'])
  const safeForecastPeriods = Array.isArray(forecastPeriods) ? forecastPeriods as ForecastPeriod[] : []
  const safeHourlyPeriods = Array.isArray(hourlyPeriods) ? hourlyPeriods as ForecastPeriod[] : []
  const firstHourly = safeHourlyPeriods[0]
  const liveTemperature = formatObservationTemperature(observation) || (
    firstHourly?.temperature != null ? `${firstHourly.temperature} ${firstHourly.temperatureUnit || 'F'}` : null
  )
  const textDescription = readPath(observation, ['properties', 'textDescription'])
  const liveSummary = (typeof textDescription === 'string' ? textDescription : firstHourly?.shortForecast) || ''

  return {
    label,
    coordinates,
    placeLabel: Object.keys(relativeLocation).length
      ? `${typeof relativeLocation.city === 'string' ? relativeLocation.city : label}, ${typeof relativeLocation.state === 'string' ? relativeLocation.state : ''}`.replace(/, $/, '')
      : label,
    forecastPeriods: safeForecastPeriods,
    hourlyPeriods: safeHourlyPeriods,
    live: {
      summary: liveSummary || 'Forecast pending',
      temperature: liveTemperature || '--',
      iconKey: getWeatherIconKey(liveSummary || firstHourly?.shortForecast || ''),
      timestamp: typeof readPath(observation, ['properties', 'timestamp']) === 'string'
        ? readPath(observation, ['properties', 'timestamp']) as string
        : firstHourly?.startTime || null,
      wind: readPath(observation, ['properties', 'windSpeed', 'value']),
    },
  }
}

export function getTripDayWeather(bundleMap: WeatherBundleMap, day: (typeof DAYS)[number]): TripDayWeather {
  const targetKey = DAY_WEATHER_TARGET[day.id]
  const bundle = targetKey ? bundleMap?.[targetKey] : null
  if (!bundle) {
    return {
      ...day,
      weather: day.weather,
      temperature: day.temperature,
      weatherIconKey: getWeatherIconKey(day.weather),
      weatherLocation: day.title,
    }
  }

  const tripDate = parseTripDate(day.id)
  const targetDate = tripDate ? toIsoDate(tripDate) : ''
  const forecastPeriod = bundle.forecastPeriods.find((period) => {
    const periodDate = toIsoDate(new Date(period.startTime))
    return periodDate === targetDate && period.isDaytime
  }) || bundle.forecastPeriods.find((period) => toIsoDate(new Date(period.startTime)) === targetDate)

  if (!forecastPeriod) {
    return {
      ...day,
      weather: day.weather,
      temperature: day.temperature,
      weatherIconKey: getWeatherIconKey(day.weather),
      weatherLocation: bundle.placeLabel,
    }
  }

  return {
    ...day,
    weather: forecastPeriod.shortForecast || day.weather,
    temperature: `${forecastPeriod.temperature} ${forecastPeriod.temperatureUnit || 'F'}`,
    weatherIconKey: getWeatherIconKey(forecastPeriod.shortForecast || day.weather),
    weatherLocation: bundle.placeLabel,
  }
}

export function getMapWeather(bundleMap: WeatherBundleMap, focusDayId: DayId | 'all' = 'all'): MapWeather | null {
  const targetKey = focusDayId !== 'all' ? DAY_WEATHER_TARGET[focusDayId] : 'basecamp'
  const bundle = targetKey ? bundleMap?.[targetKey] : null
  if (!bundle) return null

  return {
    label: focusDayId !== 'all'
      ? `${DAYS.find((day) => day.id === focusDayId)?.title || 'Focused day'} weather`
      : 'Live weather',
    placeLabel: bundle.placeLabel,
    summary: bundle.live.summary,
    temperature: bundle.live.temperature,
    iconKey: bundle.live.iconKey,
  }
}

export function getMapWeatherTargets(bundleMap: WeatherBundleMap, focusDayId: DayId | 'all' = 'all'): MapWeatherTarget[] {
  const focusedTargetKey = focusDayId !== 'all' ? DAY_WEATHER_TARGET[focusDayId] : 'basecamp'
  const targets: { id: WeatherTargetKey; label: string; bundle?: WeatherBundle }[] = [
    { id: 'basecamp', label: 'Basecamp', bundle: bundleMap?.basecamp },
    { id: 'yosemite', label: 'Yosemite', bundle: bundleMap?.yosemite },
  ]

  return targets
    .flatMap((target) => target.bundle ? [{
      id: target.id,
      label: target.label,
      placeLabel: target.bundle.placeLabel,
      summary: target.bundle.live.summary,
      temperature: target.bundle.live.temperature,
      iconKey: target.bundle.live.iconKey,
      active: target.id === focusedTargetKey,
    }] : [])
}
