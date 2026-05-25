import type { IpcScenario } from './shared'

function auditEntryKey(entry: unknown): string {
  const value = entry as Record<string, unknown>
  return [
    value.action_type,
    value.entity_type,
    value.entity_key,
    value.old_value,
    value.new_value,
    value.user_name
  ]
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .join('\0')
}

function sortAuditRows(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const value = raw as { data?: unknown[] }
  if (!Array.isArray(value.data)) return raw
  return {
    ...value,
    data: [...value.data].sort((left, right) =>
      auditEntryKey(left).localeCompare(auditEntryKey(right))
    )
  }
}

export const auditScenario: IpcScenario = {
  area: 'audit',
  run: async (ctx) => [sortAuditRows(await ctx.call('audit', 'query', [{ limit: 20, offset: 0 }]))]
}
