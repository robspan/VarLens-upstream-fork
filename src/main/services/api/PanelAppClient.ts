/**
 * PanelApp API client for searching and fetching gene panels
 *
 * Supports both Genomics England (UK) and PanelApp Australia.
 * Uses Node.js built-in fetch with 15s timeout.
 *
 * API docs:
 * - UK: https://panelapp.genomicsengland.co.uk/api/v1/
 * - AU: https://panelapp-aus.org/api/v1/
 */

import { mainLogger } from '../MainLogger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelAppSearchResult {
  id: number
  name: string
  version: string
  disease_group: string
  disease_sub_group: string
  status: string
  relevant_disorders: string[]
  stats: {
    number_of_genes: number
  }
  types: Array<{ name: string; slug: string }>
  region: 'uk' | 'aus'
}

export interface PanelAppGene {
  gene_data: {
    gene_symbol: string
    hgnc_id: string
    gene_name: string
  }
  confidence_level: string
  mode_of_inheritance: string
  phenotypes: string[]
}

export interface PanelAppPanel {
  id: number
  name: string
  version: string
  genes: PanelAppGene[]
  stats: { number_of_genes: number }
  region: 'uk' | 'aus'
}

/** Raw paginated response from PanelApp list endpoints */
interface PanelAppListResponse {
  count: number
  next: string | null
  results: Array<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URLS: Record<'uk' | 'aus', string> = {
  uk: 'https://panelapp.genomicsengland.co.uk/api/v1',
  aus: 'https://panelapp-aus.org/api/v1'
}

const TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PanelAppClient {
  /**
   * Search panels by keyword across one or both PanelApp instances.
   *
   * @param keyword - Search term for panel name
   * @param region  - 'uk', 'aus', or 'both' (parallel query)
   * @returns Array of search results tagged with region
   */
  async searchPanels(
    keyword: string,
    region: 'uk' | 'aus' | 'both'
  ): Promise<PanelAppSearchResult[]> {
    if (region === 'both') {
      const [uk, aus] = await Promise.all([
        this.searchSingleRegion(keyword, 'uk'),
        this.searchSingleRegion(keyword, 'aus')
      ])
      return [...uk, ...aus]
    }
    return this.searchSingleRegion(keyword, region)
  }

  /**
   * Fetch a full panel (including genes) by ID from a specific region.
   *
   * @param panelId - Panel numeric ID
   * @param region  - 'uk' or 'aus'
   */
  async getPanel(panelId: number, region: 'uk' | 'aus'): Promise<PanelAppPanel> {
    const base = BASE_URLS[region]
    const url = `${base}/panels/${panelId}/?format=json`

    mainLogger.debug(`PanelApp getPanel: ${url}`, 'api')

    const response = await this.fetchWithTimeout(url)

    if (!response.ok) {
      throw new Error(`PanelApp API error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.mapPanelResponse(data, region)
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async searchSingleRegion(
    keyword: string,
    region: 'uk' | 'aus'
  ): Promise<PanelAppSearchResult[]> {
    const base = BASE_URLS[region]
    const url = `${base}/panels/?name=${encodeURIComponent(keyword)}&format=json`

    mainLogger.debug(`PanelApp search: ${url}`, 'api')

    let response: Response
    try {
      response = await this.fetchWithTimeout(url)
    } catch (error) {
      mainLogger.warn(
        `PanelApp ${region} search failed: ${error instanceof Error ? error.message : String(error)}`,
        'api'
      )
      return []
    }

    if (!response.ok) {
      mainLogger.warn(`PanelApp ${region} search returned ${response.status}`, 'api')
      return []
    }

    const body = (await response.json()) as PanelAppListResponse
    const results = body.results ?? []

    return results.map((r) => this.mapSearchResult(r, region))
  }

  private mapSearchResult(raw: Record<string, unknown>, region: 'uk' | 'aus'): PanelAppSearchResult {
    const stats = (raw.stats as Record<string, unknown>) ?? {}
    const types = Array.isArray(raw.types)
      ? (raw.types as Array<{ name: string; slug: string }>)
      : []
    const disorders = Array.isArray(raw.relevant_disorders)
      ? (raw.relevant_disorders as string[])
      : []

    return {
      id: raw.id as number,
      name: (raw.name as string) ?? '',
      version: (raw.version as string) ?? '',
      disease_group: (raw.disease_group as string) ?? '',
      disease_sub_group: (raw.disease_sub_group as string) ?? '',
      status: (raw.status as string) ?? '',
      relevant_disorders: disorders,
      stats: {
        number_of_genes: (stats.number_of_genes as number) ?? 0
      },
      types,
      region
    }
  }

  private mapPanelResponse(raw: Record<string, unknown>, region: 'uk' | 'aus'): PanelAppPanel {
    const rawGenes = Array.isArray(raw.genes) ? (raw.genes as Array<Record<string, unknown>>) : []
    const stats = (raw.stats as Record<string, unknown>) ?? {}

    const genes: PanelAppGene[] = rawGenes.map((g) => {
      const geneData = (g.gene_data as Record<string, unknown>) ?? {}
      return {
        gene_data: {
          gene_symbol: (geneData.gene_symbol as string) ?? '',
          hgnc_id: (geneData.hgnc_id as string) ?? '',
          gene_name: (geneData.gene_name as string) ?? ''
        },
        confidence_level: (g.confidence_level as string) ?? '',
        mode_of_inheritance: (g.mode_of_inheritance as string) ?? '',
        phenotypes: Array.isArray(g.phenotypes) ? (g.phenotypes as string[]) : []
      }
    })

    return {
      id: raw.id as number,
      name: (raw.name as string) ?? '',
      version: (raw.version as string) ?? '',
      genes,
      stats: {
        number_of_genes: (stats.number_of_genes as number) ?? 0
      },
      region
    }
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
    } finally {
      clearTimeout(timer)
    }
  }
}
