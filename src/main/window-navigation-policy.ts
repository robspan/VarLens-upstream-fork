export function isMainWindowNavigationAllowed(
  url: string,
  rendererUrl: string | undefined
): boolean {
  return (
    (rendererUrl !== undefined && rendererUrl !== '' && url.startsWith(rendererUrl)) ||
    url.startsWith('file://')
  )
}
