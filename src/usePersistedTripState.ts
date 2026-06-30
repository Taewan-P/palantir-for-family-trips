import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

type PersistedTripStateOptions<T> = {
  deserialize?: (raw: string, fallback: T) => T
}

export function usePersistedTripState<T>(
  key: string,
  initialValue: T,
  options: PersistedTripStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return initialValue

    try {
      const raw = window.localStorage.getItem(key)
      if (raw == null) return initialValue
      if (typeof options.deserialize === 'function') return options.deserialize(raw, initialValue)
      return JSON.parse(raw)
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Ignore persistence errors so the app still works in restricted environments.
    }
  }, [key, state])

  return [state, setState]
}
