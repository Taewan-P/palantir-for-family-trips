export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonArray = readonly JsonValue[]

export function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return isPlainJsonObject(value, new WeakSet<object>())
}

function isJsonValue(value: unknown, seen: WeakSet<object>): value is JsonValue {
  if (value === null) {
    return true
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object':
      return Array.isArray(value) ? isJsonArray(value, seen) : isPlainJsonObject(value, seen)
    default:
      return false
  }
}

function isJsonArray(value: readonly unknown[], seen: WeakSet<object>): value is JsonArray {
  if (seen.has(value)) {
    return false
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false
  }

  seen.add(value)

  const descriptors = Object.getOwnPropertyDescriptors(value)

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === 'length') {
      continue
    }

    if (!isArrayIndex(key) || !('value' in descriptor)) {
      seen.delete(value)
      return false
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index]

    if (!descriptor || !('value' in descriptor) || !isJsonValue(descriptor.value, seen)) {
      seen.delete(value)
      return false
    }
  }

  seen.delete(value)
  return true
}

function isArrayIndex(key: string): boolean {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key
}

function isPlainJsonObject(value: unknown, seen: WeakSet<object>): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }

  if (seen.has(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return false
  }

  seen.add(value)

  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !isJsonValue(descriptor.value, seen)) {
      seen.delete(value)
      return false
    }
  }

  seen.delete(value)
  return true
}
