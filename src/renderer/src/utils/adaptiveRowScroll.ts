export type RowScrollBehavior = ScrollBehavior

export function getAdaptiveRowScrollBehavior(
  lastKeyboardMoveAtMs: number | null,
  nowMs: number,
  thresholdMs = 150
): RowScrollBehavior {
  if (lastKeyboardMoveAtMs === null) {
    return 'smooth'
  }

  return nowMs - lastKeyboardMoveAtMs < thresholdMs ? 'auto' : 'smooth'
}
