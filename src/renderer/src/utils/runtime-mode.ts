export function isWebRuntime(): boolean {
  return typeof window !== 'undefined' && window.__VARLENS_WEB__ === true
}
