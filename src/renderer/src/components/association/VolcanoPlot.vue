<template>
  <div ref="plotContainer" style="width: 100%; height: 500px" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Plotly: any = null

interface AssociationResult {
  gene_symbol: string
  fisher: { p_value: number | null; odds_ratio: number | null }
  logistic_burden: { p_value: number | null; beta: number | null }
  q_value: number | null
}

const props = defineProps<{
  results: AssociationResult[]
  primaryTest: string
  fdrThreshold?: number
}>()

const plotContainer = ref<HTMLDivElement>()

async function loadPlotly(): Promise<void> {
  if (Plotly !== null) return
  Plotly = await import('plotly.js-dist-min')
}

function buildPlotData(): Array<Record<string, unknown>> {
  const threshold = props.fdrThreshold ?? 0.05
  const significant: AssociationResult[] = []
  const notSignificant: AssociationResult[] = []

  for (const r of props.results) {
    const p = props.primaryTest === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
    const effect = props.primaryTest === 'fisher' ? r.fisher.odds_ratio : r.logistic_burden.beta
    if (p === null || effect === null) continue

    if (r.q_value !== null && r.q_value < threshold) {
      significant.push(r)
    } else {
      notSignificant.push(r)
    }
  }

  const getX = (r: AssociationResult): number => {
    const effect = props.primaryTest === 'fisher' ? r.fisher.odds_ratio : r.logistic_burden.beta
    if (props.primaryTest === 'fisher') {
      // Guard against non-finite values (0 or negative odds ratio)
      const val = effect!
      return val > 0 ? Math.log2(val) : 0
    }
    return effect!
  }
  const getY = (r: AssociationResult): number => {
    const p = props.primaryTest === 'fisher' ? r.fisher.p_value : r.logistic_burden.p_value
    // Guard against 0 p-values which produce Infinity
    const pVal = p!
    return pVal > 0 ? -Math.log10(pVal) : 0
  }

  return [
    {
      x: notSignificant.map(getX),
      y: notSignificant.map(getY),
      text: notSignificant.map((r) => r.gene_symbol),
      mode: 'markers',
      type: 'scatter',
      name: 'Not significant',
      marker: { color: '#999', size: 6 },
      hovertemplate: '%{text}<br>x: %{x:.3f}<br>-log10(p): %{y:.2f}<extra></extra>'
    },
    {
      x: significant.map(getX),
      y: significant.map(getY),
      text: significant.map((r) => r.gene_symbol),
      mode: 'markers+text',
      type: 'scatter',
      name: `FDR < ${threshold}`,
      marker: { color: '#e53935', size: 8 },
      textposition: 'top center',
      textfont: { size: 10 },
      hovertemplate: '%{text}<br>x: %{x:.3f}<br>-log10(p): %{y:.2f}<extra></extra>'
    }
  ]
}

async function render(): Promise<void> {
  if (!plotContainer.value) return
  await loadPlotly()
  if (Plotly === null) return

  const data = buildPlotData()
  const layout = {
    xaxis: {
      title: props.primaryTest === 'fisher' ? 'log2(Odds Ratio)' : '\u03B2 (effect size)'
    },
    yaxis: { title: '-log10(p-value)' },
    hovermode: 'closest',
    showlegend: true,
    margin: { t: 30, l: 60, r: 20, b: 50 }
  }
  Plotly.newPlot(plotContainer.value, data, layout, { responsive: true })
}

watch(() => props.results, render, { deep: true })
onMounted(render)
onBeforeUnmount(() => {
  if (plotContainer.value !== undefined && Plotly !== null) Plotly.purge(plotContainer.value)
})
</script>
