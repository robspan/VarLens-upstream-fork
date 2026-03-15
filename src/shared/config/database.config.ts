export const DATABASE_CONFIG = {
  /** SQLite cache size in KB (negative = KB, positive = pages) */
  CACHE_SIZE_KB: -32000,
  /** SQLite cache size for import worker (64 MB, larger for bulk writes) */
  IMPORT_CACHE_SIZE_KB: -64000,
  /** Memory-mapped I/O size in bytes (1 GB — virtual address reservation is free on 64-bit) */
  MMAP_SIZE_BYTES: 1_073_741_824,
  /** Busy timeout in milliseconds */
  BUSY_TIMEOUT_MS: 5000,
  /** Max rows sampled per table during ANALYZE (caps optimizer stat-gathering time) */
  ANALYSIS_LIMIT: 400,
  /** Batch insert size for variant imports */
  BATCH_INSERT_SIZE: 10_000,
  /** API cache TTL in days */
  CACHE_TTL_DAYS: 30,
  /** Max recent databases in history */
  MAX_RECENT_DATABASES: 5
} as const
