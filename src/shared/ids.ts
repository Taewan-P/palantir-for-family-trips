const TOKEN_BYTES = 32

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createId(prefix: string): string {
  return `${prefix}_${hex(randomBytes(18))}`
}

export function createToken(): string {
  return hex(randomBytes(TOKEN_BYTES))
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let diff = left.length ^ right.length

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0
    const rightCode = index < right.length ? right.charCodeAt(index) : 0
    diff |= leftCode ^ rightCode
  }

  return diff === 0
}
