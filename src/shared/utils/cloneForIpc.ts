/**
 * Deep-clone a value to strip Vue reactive proxies for IPC serialization.
 */
export function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
