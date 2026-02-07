import type { ImportStrategy, FormatInfo } from './ImportStrategy'

/**
 * Custom error for unsupported formats
 */
export class UnsupportedFormatError extends Error {
  readonly code = 'UNSUPPORTED_FORMAT'

  constructor(format: string) {
    super(`No import strategy available for format: ${format}`)
    this.name = 'UnsupportedFormatError'
  }
}

/**
 * Registry for import strategies with dynamic format detection
 */
export class StrategyRegistry {
  private strategies = new Map<string, ImportStrategy>()

  /**
   * Register an import strategy
   * @param strategy - Strategy to register
   */
  register(strategy: ImportStrategy): void {
    this.strategies.set(strategy.formatId, strategy)
  }

  /**
   * Get strategy for a detected format
   * @param formatInfo - Format detection result
   * @returns Matching strategy
   * @throws UnsupportedFormatError if no strategy can handle the format
   */
  getStrategy(formatInfo: FormatInfo): ImportStrategy {
    for (const strategy of this.strategies.values()) {
      if (strategy.canHandle(formatInfo)) {
        return strategy
      }
    }
    throw new UnsupportedFormatError(formatInfo.format)
  }

  /**
   * Get strategy by format ID directly
   * @param formatId - Format identifier
   * @returns Strategy or undefined
   */
  get(formatId: string): ImportStrategy | undefined {
    return this.strategies.get(formatId)
  }

  /**
   * Check if a strategy is registered for a format
   * @param formatId - Format identifier
   */
  has(formatId: string): boolean {
    return this.strategies.has(formatId)
  }

  /**
   * Get all registered format IDs
   */
  getFormats(): string[] {
    return Array.from(this.strategies.keys())
  }
}

/**
 * Global strategy registry instance
 * Strategies register themselves when imported
 */
export const importRegistry = new StrategyRegistry()
