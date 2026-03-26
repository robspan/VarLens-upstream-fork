/**
 * Deep-clone a value to strip Vue reactive proxies for IPC serialization.
 *
 * structuredClone() throws on Vue 3 Proxy objects. JSON round-trip is the
 * simplest reliable alternative. This utility centralizes that pattern so
 * callers don't duplicate it and the strategy can be swapped in one place.
 */
export function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
