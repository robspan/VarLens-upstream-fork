# Multi-Transcript Storage and Selection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store all transcript annotations per variant (not just the selected one) and let users view/switch transcripts in the detail panel.

**Architecture:** New `variant_transcripts` table in SQLite (1:N from variants). Import pipeline extracts all transcripts from columnar multi-value arrays. Existing `variants` table keeps denormalized cache of the selected transcript for fast queries. Frontend gets a new `TranscriptSection.vue` in the detail panel with a composable to fetch/switch.

**Tech Stack:** better-sqlite3-multiple-ciphers (DB), Node.js Transform streams (import), Vue 3 + Vuetify 3 (frontend), Vitest (tests)

---

### Task 1: Shared Types — TranscriptAnnotation and TranscriptInsertRow

**Files:**
- Create: `src/shared/types/transcript.ts`
- Modify: `src/shared/types/index.ts:1-5`

**Step 1: Create the transcript types file**

Create `src/shared/types/transcript.ts`:

```typescript
/**
 * TranscriptAnnotation — full row from variant_transcripts table.
 * Returned by getVariantTranscripts() to the renderer.
 */
export interface TranscriptAnnotation {
  id: number
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: boolean
  is_mane_select: boolean | null
  is_canonical: boolean | null
}

/**
 * TranscriptInsertRow — data for inserting into variant_transcripts.
 * Used by the import pipeline (no id or variant_id yet).
 */
export interface TranscriptInsertRow {
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: number // 0 or 1 (SQLite integer boolean)
}
```

**Step 2: Export from shared types barrel**

In `src/shared/types/index.ts`, add:

```typescript
export * from './transcript'
```

after the existing exports.

**Step 3: Commit**

```bash
git add src/shared/types/transcript.ts src/shared/types/index.ts
git commit -m "feat: add TranscriptAnnotation and TranscriptInsertRow shared types"
```

---

### Task 2: Database Migration — variant_transcripts table + backfill

**Files:**
- Modify: `src/main/database/migrations.ts:198` (after version 3 migration)
- Test: `tests/main/database/migrations.test.ts` (new file)

**Step 1: Write the failing test**

Create `tests/main/database/migrations.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../src/main/database/DatabaseService'

describe('migration v4: variant_transcripts', () => {
  let db: DatabaseService

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('should create variant_transcripts table', () => {
    const tables = db.database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='variant_transcripts'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('should create indexes on variant_transcripts', () => {
    const indexes = db.database
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_vt_%'")
      .all() as { name: string }[]
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_vt_variant_id')
    expect(indexNames).toContain('idx_vt_selected')
    expect(indexNames).toContain('idx_vt_transcript')
  })

  it('should backfill existing variants with transcript into variant_transcripts', () => {
    // Insert a case and variant with a transcript
    const caseId = db.createCase('test', '/test.json', 100)
    db.insertVariantsBatch(caseId, [
      {
        chr: '1',
        pos: 100,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        omim_mim_number: null,
        consequence: 'missense_variant',
        gnomad_af: 0.01,
        cadd: 25,
        clinvar: null,
        gt_num: '0/1',
        func: null,
        qual: null,
        hpo_sim_score: null,
        transcript: 'NM_007294.4',
        cdna: 'c.123A>G',
        aa_change: 'p.His41Arg',
        moi: 'AD'
      }
    ])

    // Re-run migrations (simulates opening existing DB)
    // The backfill should have created a transcript row
    const rows = db.database
      .prepare('SELECT * FROM variant_transcripts')
      .all() as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0].transcript_id).toBe('NM_007294.4')
    expect(rows[0].is_selected).toBe(1)
    expect(rows[0].gene_symbol).toBe('BRCA1')
    expect(rows[0].consequence).toBe('missense_variant')
  })

  it('should NOT backfill variants with null transcript', () => {
    const caseId = db.createCase('test', '/test.json', 100)
    db.insertVariantsBatch(caseId, [
      {
        chr: '1',
        pos: 200,
        ref: 'C',
        alt: 'T',
        gene_symbol: null,
        omim_mim_number: null,
        consequence: null,
        gnomad_af: null,
        cadd: null,
        clinvar: null,
        gt_num: null,
        func: null,
        qual: null,
        hpo_sim_score: null,
        transcript: null,
        cdna: null,
        aa_change: null,
        moi: null
      }
    ])

    const rows = db.database.prepare('SELECT * FROM variant_transcripts').all()
    expect(rows).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: FAIL — `variant_transcripts` table does not exist.

**Step 3: Write the migration**

In `src/main/database/migrations.ts`, after the `currentVersion < 3` block (after line 198), add:

```typescript
  // v0.5.0 variant_transcripts table
  if (currentVersion < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL,
        transcript_id TEXT NOT NULL,
        gene_symbol TEXT,
        consequence TEXT,
        cdna TEXT,
        aa_change TEXT,
        hpo_sim_score REAL,
        moi TEXT,
        is_selected INTEGER NOT NULL DEFAULT 0,
        is_mane_select INTEGER,
        is_canonical INTEGER,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        UNIQUE(variant_id, transcript_id)
      );

      CREATE INDEX IF NOT EXISTS idx_vt_variant_id ON variant_transcripts(variant_id);
      CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
      CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
    `)

    // Backfill: create one transcript row per existing variant that has a transcript
    db.exec(`
      INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
      SELECT id, transcript, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, 1
      FROM variants
      WHERE transcript IS NOT NULL AND transcript != ''
    `)

    db.exec('PRAGMA user_version = 4')
  }
```

Also update the version history comment at top of file (line 17-19) to add:
```
 * - 3: v0.4.0 schema fix (starred, ACMG per-case)
 * - 4: v0.5.0 variant_transcripts table
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/migrations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/database/migrations.ts tests/main/database/migrations.test.ts
git commit -m "feat: add variant_transcripts table migration with backfill"
```

---

### Task 3: DatabaseService — getVariantTranscripts and switchSelectedTranscript

**Files:**
- Modify: `src/main/database/DatabaseService.ts` (add methods after `insertVariantsBatch`, ~line 354)
- Test: `tests/main/database/transcripts.test.ts` (new file)

**Step 1: Write the failing tests**

Create `tests/main/database/transcripts.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../src/main/database/DatabaseService'
import type { Variant } from '../../src/main/database/types'

type VariantInsert = Omit<Variant, 'id' | 'case_id'>

function makeVariant(overrides: Partial<VariantInsert> = {}): VariantInsert {
  return {
    chr: '17',
    pos: 43094000,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'BRCA1',
    omim_mim_number: null,
    consequence: 'missense_variant',
    gnomad_af: 0.001,
    cadd: 28,
    clinvar: null,
    gt_num: '0/1',
    func: null,
    qual: 30,
    hpo_sim_score: null,
    transcript: 'NM_007294.4',
    cdna: 'c.123A>G',
    aa_change: 'p.His41Arg',
    moi: 'AD',
    ...overrides
  }
}

describe('DatabaseService transcript methods', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.createCase('test', '/test.json', 100)
    db.insertVariantsBatch(caseId, [makeVariant()])

    // Get the variant ID
    const variants = db.getVariants({ case_id: caseId }, 10)
    variantId = variants.data[0].id

    // Insert multiple transcript rows for testing
    const insertTx = db.database.prepare(`
      INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertTx.run(variantId, 'NM_007294.4', 'BRCA1', 'missense_variant', 'c.123A>G', 'p.His41Arg', null, 'AD', 1)
    insertTx.run(variantId, 'NM_007299.4', 'BRCA1', 'synonymous_variant', 'c.456C>T', null, null, 'AD', 0)
    insertTx.run(variantId, 'NR_027676.2', 'BRCA1', 'non_coding_transcript_variant', null, null, null, null, 0)
  })

  afterEach(() => {
    db.close()
  })

  describe('getVariantTranscripts', () => {
    it('should return all transcripts for a variant', () => {
      const transcripts = db.getVariantTranscripts(variantId)
      expect(transcripts).toHaveLength(3)
    })

    it('should return selected transcript first', () => {
      const transcripts = db.getVariantTranscripts(variantId)
      expect(transcripts[0].transcript_id).toBe('NM_007294.4')
      expect(transcripts[0].is_selected).toBe(true)
    })

    it('should return empty array for variant with no transcripts', () => {
      // Insert variant without transcripts
      db.insertVariantsBatch(caseId, [makeVariant({ transcript: null, chr: '2', pos: 999 })])
      const variants = db.getVariants({ case_id: caseId }, 10)
      const otherVariant = variants.data.find((v) => v.chr === '2')!
      const transcripts = db.getVariantTranscripts(otherVariant.id)
      expect(transcripts).toHaveLength(0)
    })
  })

  describe('switchSelectedTranscript', () => {
    it('should update is_selected flags', () => {
      db.switchSelectedTranscript(variantId, 'NM_007299.4')

      const transcripts = db.getVariantTranscripts(variantId)
      const selected = transcripts.find((t) => t.is_selected)
      expect(selected!.transcript_id).toBe('NM_007299.4')

      const deselected = transcripts.find((t) => t.transcript_id === 'NM_007294.4')
      expect(deselected!.is_selected).toBe(false)
    })

    it('should update denormalized fields on variants table', () => {
      db.switchSelectedTranscript(variantId, 'NM_007299.4')

      const variants = db.getVariants({ case_id: caseId }, 10)
      const v = variants.data[0]
      expect(v.transcript).toBe('NM_007299.4')
      expect(v.consequence).toBe('synonymous_variant')
      expect(v.cdna).toBe('c.456C>T')
      expect(v.aa_change).toBeNull()
    })

    it('should be atomic (transaction)', () => {
      // Switching to non-existent transcript should throw and leave state unchanged
      expect(() => db.switchSelectedTranscript(variantId, 'FAKE_TRANSCRIPT')).toThrow()

      const transcripts = db.getVariantTranscripts(variantId)
      const selected = transcripts.find((t) => t.is_selected)
      expect(selected!.transcript_id).toBe('NM_007294.4')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/transcripts.test.ts`
Expected: FAIL — `db.getVariantTranscripts is not a function`

**Step 3: Implement the methods**

In `src/main/database/DatabaseService.ts`, add these methods after `insertVariantsBatch` (after line 354):

```typescript
  /**
   * Get all transcripts for a variant, selected first
   */
  getVariantTranscripts(variantId: number): TranscriptAnnotation[] {
    const rows = this.stmt(`
      SELECT id, variant_id, transcript_id, gene_symbol, consequence,
             cdna, aa_change, hpo_sim_score, moi, is_selected,
             is_mane_select, is_canonical
      FROM variant_transcripts
      WHERE variant_id = ?
      ORDER BY is_selected DESC, transcript_id ASC
    `).all(variantId) as {
      id: number
      variant_id: number
      transcript_id: string
      gene_symbol: string | null
      consequence: string | null
      cdna: string | null
      aa_change: string | null
      hpo_sim_score: number | null
      moi: string | null
      is_selected: number
      is_mane_select: number | null
      is_canonical: number | null
    }[]

    return rows.map((r) => ({
      ...r,
      is_selected: r.is_selected === 1,
      is_mane_select: r.is_mane_select === null ? null : r.is_mane_select === 1,
      is_canonical: r.is_canonical === null ? null : r.is_canonical === 1
    }))
  }

  /**
   * Switch the selected transcript for a variant.
   * Updates both variant_transcripts flags and denormalized fields on variants.
   * Throws if transcriptId not found (transaction rolls back).
   */
  switchSelectedTranscript(variantId: number, transcriptId: string): void {
    const switchTx = this.db.transaction(() => {
      // Clear all selected flags for this variant
      this.stmt(
        'UPDATE variant_transcripts SET is_selected = 0 WHERE variant_id = ?'
      ).run(variantId)

      // Set the new selected transcript
      const result = this.stmt(
        'UPDATE variant_transcripts SET is_selected = 1 WHERE variant_id = ? AND transcript_id = ?'
      ).run(variantId, transcriptId)

      if (result.changes === 0) {
        throw new Error(`Transcript ${transcriptId} not found for variant ${variantId}`)
      }

      // Read the new transcript data
      const transcript = this.stmt(
        'SELECT gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi FROM variant_transcripts WHERE variant_id = ? AND transcript_id = ?'
      ).get(variantId, transcriptId) as {
        gene_symbol: string | null
        consequence: string | null
        cdna: string | null
        aa_change: string | null
        hpo_sim_score: number | null
        moi: string | null
      }

      // Update denormalized fields on variants table
      this.stmt(`
        UPDATE variants
        SET transcript = ?, gene_symbol = ?, consequence = ?, cdna = ?, aa_change = ?, hpo_sim_score = ?, moi = ?
        WHERE id = ?
      `).run(
        transcriptId,
        transcript.gene_symbol,
        transcript.consequence,
        transcript.cdna,
        transcript.aa_change,
        transcript.hpo_sim_score,
        transcript.moi,
        variantId
      )
    })

    switchTx()
  }
```

Add the import at the top of `DatabaseService.ts`:

```typescript
import type { TranscriptAnnotation } from '../../shared/types/transcript'
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/database/transcripts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/database/DatabaseService.ts tests/main/database/transcripts.test.ts
git commit -m "feat: add getVariantTranscripts and switchSelectedTranscript DB methods"
```

---

### Task 4: DatabaseService — insertVariantsBatch transcript support

**Files:**
- Modify: `src/main/database/DatabaseService.ts:312-354` (extend insertVariantsBatch)
- Test: `tests/main/database/transcripts-insert.test.ts` (new file)

**Step 1: Write the failing test**

Create `tests/main/database/transcripts-insert.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../src/main/database/DatabaseService'
import type { Variant } from '../../src/main/database/types'
import type { TranscriptInsertRow } from '../../src/shared/types/transcript'

type VariantInsert = Omit<Variant, 'id' | 'case_id'>

interface VariantWithTranscripts extends VariantInsert {
  _transcripts?: TranscriptInsertRow[]
}

describe('insertVariantsBatch with transcripts', () => {
  let db: DatabaseService
  let caseId: number

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = db.createCase('test', '/test.json', 100)
  })

  afterEach(() => {
    db.close()
  })

  it('should insert transcript rows alongside variant', () => {
    const variants: VariantWithTranscripts[] = [
      {
        chr: '17',
        pos: 43094000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        omim_mim_number: null,
        consequence: 'missense_variant',
        gnomad_af: 0.001,
        cadd: 28,
        clinvar: null,
        gt_num: '0/1',
        func: null,
        qual: 30,
        hpo_sim_score: null,
        transcript: 'NM_007294.4',
        cdna: 'c.123A>G',
        aa_change: 'p.His41Arg',
        moi: 'AD',
        _transcripts: [
          {
            transcript_id: 'NM_007294.4',
            gene_symbol: 'BRCA1',
            consequence: 'missense_variant',
            cdna: 'c.123A>G',
            aa_change: 'p.His41Arg',
            hpo_sim_score: null,
            moi: 'AD',
            is_selected: 1
          },
          {
            transcript_id: 'NM_007299.4',
            gene_symbol: 'BRCA1',
            consequence: 'synonymous_variant',
            cdna: 'c.456C>T',
            aa_change: null,
            hpo_sim_score: null,
            moi: 'AD',
            is_selected: 0
          }
        ]
      }
    ]

    db.insertVariantsBatch(caseId, variants)

    const txRows = db.database
      .prepare('SELECT * FROM variant_transcripts')
      .all() as Record<string, unknown>[]
    expect(txRows).toHaveLength(2)
    expect(txRows[0].transcript_id).toBe('NM_007294.4')
    expect(txRows[0].is_selected).toBe(1)
    expect(txRows[1].transcript_id).toBe('NM_007299.4')
    expect(txRows[1].is_selected).toBe(0)
  })

  it('should work without _transcripts (backwards compatible)', () => {
    const variants: VariantInsert[] = [
      {
        chr: '1',
        pos: 100,
        ref: 'C',
        alt: 'T',
        gene_symbol: null,
        omim_mim_number: null,
        consequence: null,
        gnomad_af: null,
        cadd: null,
        clinvar: null,
        gt_num: null,
        func: null,
        qual: null,
        hpo_sim_score: null,
        transcript: null,
        cdna: null,
        aa_change: null,
        moi: null
      }
    ]

    db.insertVariantsBatch(caseId, variants)

    const txRows = db.database.prepare('SELECT * FROM variant_transcripts').all()
    expect(txRows).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/database/transcripts-insert.test.ts`
Expected: FAIL — transcript rows not inserted (current implementation doesn't handle `_transcripts`).

**Step 3: Modify insertVariantsBatch**

In `src/main/database/DatabaseService.ts`, update `insertVariantsBatch` (lines 312-354).

Change the method signature type and add transcript insert logic inside the transaction:

```typescript
  insertVariantsBatch(
    caseId: number,
    variants: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]
  ): number {
    // Verify case exists (throws NotFoundError if not)
    this.getCase(caseId)

    const insert = this.stmt(`
      INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertTranscript = this.stmt(`
      INSERT INTO variant_transcripts (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertBatch = this.db.transaction(
      (batch: (Omit<Variant, 'id' | 'case_id'> & { _transcripts?: TranscriptInsertRow[] })[]) => {
        for (const v of batch) {
          const result = insert.run(
            caseId,
            v.chr,
            v.pos,
            v.ref,
            v.alt,
            v.gene_symbol,
            v.omim_mim_number,
            v.consequence,
            v.gnomad_af,
            v.cadd,
            v.clinvar,
            v.gt_num,
            v.func,
            v.qual,
            v.hpo_sim_score,
            v.transcript,
            v.cdna,
            v.aa_change,
            v.moi
          )

          // Insert transcript rows if present
          if (v._transcripts !== undefined && v._transcripts.length > 0) {
            const variantId = result.lastInsertRowid as number
            for (const t of v._transcripts) {
              insertTranscript.run(
                variantId,
                t.transcript_id,
                t.gene_symbol,
                t.consequence,
                t.cdna,
                t.aa_change,
                t.hpo_sim_score,
                t.moi,
                t.is_selected
              )
            }
          }
        }
      }
    )

    for (let i = 0; i < variants.length; i += BATCH_SIZE) {
      const batch = variants.slice(i, i + BATCH_SIZE)
      insertBatch(batch)
    }

    this.updateCaseVariantCount(caseId, variants.length)
    return variants.length
  }
```

Add the import at top if not already present:

```typescript
import type { TranscriptInsertRow } from '../../shared/types/transcript'
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/database/transcripts-insert.test.ts tests/main/database/transcripts.test.ts`
Expected: PASS

Also run the existing tests to verify backwards compatibility:

Run: `npx vitest run tests/main/database/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/main/database/DatabaseService.ts tests/main/database/transcripts-insert.test.ts
git commit -m "feat: extend insertVariantsBatch to insert transcript rows"
```

---

### Task 5: FieldMapper — extractAllTranscripts

**Files:**
- Modify: `src/main/import/transforms/FieldMapper.ts`
- Test: `tests/main/import/FieldMapper.test.ts` (extend existing)

**Step 1: Write the failing tests**

Add to the existing `tests/main/import/FieldMapper.test.ts`:

```typescript
describe('extractAllTranscripts (multi-transcript output)', () => {
  it('should emit _transcripts array with all transcript entries', async () => {
    const row = createTestRow({
      1: 0, // selectedTranscript = 0
      28: ['1', '2'], // Transcript IDs (use dictionary)
      24: ['29808', '32952'], // Gene IDs (use dictionary)
      21: ['2', '3'], // Impact codes (use dictionary)
      29: ['c.123A>G', 'c.456C>T'], // cDNA
      30: ['p.His41Arg', null], // AA change
    })

    const results = await runTransform([row])
    expect(results).toHaveLength(1)

    const variant = results[0] as Record<string, unknown>
    const transcripts = variant._transcripts as Record<string, unknown>[]
    expect(transcripts).toHaveLength(2)
    expect(transcripts[0].is_selected).toBe(1)
    expect(transcripts[1].is_selected).toBe(0)
  })

  it('should resolve dictionaries for transcript fields', async () => {
    const row = createTestRow({
      1: 0,
      28: ['1', '2'], // → transcript dict lookup
      24: ['29808', '32952'], // → gene dict lookup
      21: ['1', '2'], // → IMPACT_DICTIONARY: 1=HIGH, 2=MODERATE
    })

    const results = await runTransform([row])
    const variant = results[0] as Record<string, unknown>
    const transcripts = variant._transcripts as Record<string, unknown>[]

    // Transcript IDs should be resolved via transcript dictionary
    expect(transcripts[0].transcript_id).toBeTruthy()
    // Gene symbols should be resolved via gene dictionary
    expect(transcripts[0].gene_symbol).toBeTruthy()
    // Consequences should be resolved via IMPACT_DICTIONARY
    expect(transcripts[0].consequence).toBe('HIGH')
    expect(transcripts[1].consequence).toBe('MODERATE')
  })

  it('should emit single transcript for non-array columns', async () => {
    const row = createTestRow({
      1: 0,
      28: 'single_tx_id', // Not an array — single value
    })

    const results = await runTransform([row])
    const variant = results[0] as Record<string, unknown>
    const transcripts = variant._transcripts as Record<string, unknown>[]
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0].is_selected).toBe(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/FieldMapper.test.ts`
Expected: FAIL — `_transcripts` is undefined.

**Step 3: Implement extractAllTranscripts**

In `src/main/import/transforms/FieldMapper.ts`, add the import and new method, then modify `_transform`:

Add import at top:

```typescript
import type { TranscriptInsertRow } from '../../shared/types/transcript'
```

Change the output type (line 11):

```typescript
type MappedVariantWithTranscripts = Omit<Variant, 'id' | 'case_id'> & {
  _transcripts?: TranscriptInsertRow[]
}
```

Add the `extractAllTranscripts` method after `extractNumericFromDict`:

```typescript
  /**
   * Extract all transcript annotations from multi-value arrays.
   * Returns one TranscriptInsertRow per transcript in the source data.
   */
  private extractAllTranscripts(
    row: RawVariantRow,
    selectedTranscript: number
  ): TranscriptInsertRow[] {
    const transcriptCol = row[COLUMN_INDICES.TRANSCRIPT]
    const isArray = Array.isArray(transcriptCol)
    const count = isArray ? (transcriptCol as unknown[]).length : transcriptCol != null ? 1 : 0

    if (count === 0) return []

    const transcripts: TranscriptInsertRow[] = []

    for (let i = 0; i < count; i++) {
      const transcriptId = this.extractValue(
        row, COLUMN_INDICES.TRANSCRIPT, i, true, this.dictionaries.transcript
      ) as string | null
      if (transcriptId === null) continue

      transcripts.push({
        transcript_id: transcriptId,
        gene_symbol: this.extractValue(
          row, COLUMN_INDICES.GENE, i, true, this.dictionaries.gene
        ) as string | null,
        consequence: this.extractValue(
          row, COLUMN_INDICES.IMPACT, i, true, IMPACT_DICTIONARY
        ) as string | null,
        cdna: this.extractValue(row, COLUMN_INDICES.CDNA, i, false) as string | null,
        aa_change: this.extractValue(row, COLUMN_INDICES.AA_CHANGE, i, false) as string | null,
        hpo_sim_score: this.extractNumericFromDict(
          row, COLUMN_INDICES.HPO_SIM_SCORE, i, this.dictionaries.hpoSimScore
        ),
        moi: this.extractValue(
          row, COLUMN_INDICES.MOI, i, true, this.dictionaries.moi
        ) as string | null,
        is_selected: i === selectedTranscript ? 1 : 0
      })
    }

    return transcripts
  }
```

Modify `_transform` to call `extractAllTranscripts` and attach to output. After building `mapped` and before validation (between lines 104 and 106), add:

```typescript
      // Extract all transcript annotations
      const transcripts = this.extractAllTranscripts(row, selectedTranscript)
```

Change the push (line 125) from `this.push(mapped)` to:

```typescript
      const output: MappedVariantWithTranscripts = mapped
      if (transcripts.length > 0) {
        output._transcripts = transcripts
      }
      this.push(output)
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/import/FieldMapper.test.ts`
Expected: All PASS (new and existing)

**Step 5: Commit**

```bash
git add src/main/import/transforms/FieldMapper.ts tests/main/import/FieldMapper.test.ts
git commit -m "feat: extract all transcripts from columnar multi-value arrays"
```

---

### Task 6: ObjectFormatMapper — single transcript row

**Files:**
- Modify: `src/main/import/transforms/ObjectFormatMapper.ts`
- Test: `tests/main/import/ObjectFormatMapper.test.ts` (extend or create)

**Step 1: Write the failing test**

Create or extend `tests/main/import/ObjectFormatMapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createObjectFormatMapper } from '../../src/main/import/transforms/ObjectFormatMapper'
import type { ObjectFormatVariant } from '../../src/main/import/transforms/ObjectFormatMapper'

async function runObjectTransform(variants: ObjectFormatVariant[]): Promise<unknown[]> {
  const mapper = createObjectFormatMapper()
  const results: unknown[] = []
  const readable = Readable.from(
    variants.map((v, i) => ({ key: i, value: v })),
    { objectMode: true }
  )
  const writable = new Writable({
    objectMode: true,
    write(chunk, _enc, cb) {
      results.push(chunk)
      cb()
    }
  })
  await pipeline(readable, mapper, writable)
  return results
}

describe('ObjectFormatMapper transcript output', () => {
  it('should emit _transcripts with one selected row when transcript present', async () => {
    const results = await runObjectTransform([
      {
        chr: '17',
        pos: 43094000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'BRCA1',
        consequence: 'missense_variant',
        transcript: 'NM_007294.4',
        cdna: 'c.123A>G',
        aa_change: 'p.His41Arg',
        moi: [{ accessionId: 1, name: 'Autosomal dominant', abbreviation: 'AD' }]
      }
    ])

    const v = results[0] as Record<string, unknown>
    const transcripts = v._transcripts as Record<string, unknown>[]
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0].transcript_id).toBe('NM_007294.4')
    expect(transcripts[0].is_selected).toBe(1)
    expect(transcripts[0].gene_symbol).toBe('BRCA1')
  })

  it('should NOT emit _transcripts when transcript is null', async () => {
    const results = await runObjectTransform([
      { chr: '1', pos: 100, ref: 'A', alt: 'G' }
    ])

    const v = results[0] as Record<string, unknown>
    expect(v._transcripts).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/import/ObjectFormatMapper.test.ts`
Expected: FAIL — `_transcripts` is undefined.

**Step 3: Implement the change**

In `src/main/import/transforms/ObjectFormatMapper.ts`, add the import:

```typescript
import type { TranscriptInsertRow } from '../../shared/types/transcript'
```

Change the output type (line 4):

```typescript
type MappedVariantWithTranscripts = Omit<Variant, 'id' | 'case_id'> & {
  _transcripts?: TranscriptInsertRow[]
}
```

After building `mapped` (line 125) and before validation (line 128), add:

```typescript
      // Build single transcript row if transcript is present
      if (mapped.transcript !== null) {
        ;(mapped as MappedVariantWithTranscripts)._transcripts = [
          {
            transcript_id: mapped.transcript,
            gene_symbol: mapped.gene_symbol,
            consequence: mapped.consequence,
            cdna: mapped.cdna,
            aa_change: mapped.aa_change,
            hpo_sim_score: mapped.hpo_sim_score,
            moi: mapped.moi,
            is_selected: 1
          }
        ]
      }
```

Change `this.push(mapped)` (line 146) to push the extended type:

```typescript
      this.push(mapped as MappedVariantWithTranscripts)
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/import/ObjectFormatMapper.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/import/transforms/ObjectFormatMapper.ts tests/main/import/ObjectFormatMapper.test.ts
git commit -m "feat: emit single transcript row from object format mapper"
```

---

### Task 7: IPC Handlers — transcripts:list and transcripts:switch

**Files:**
- Create: `src/main/ipc/handlers/transcripts.ts`
- Modify: `src/main/ipc/index.ts:27` (register new handler)

**Step 1: Create the handler file**

Create `src/main/ipc/handlers/transcripts.ts`:

```typescript
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch
 */

/**
 * List all transcripts for a variant
 */
ipcMain.handle('transcripts:list', async (_event, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.getVariantTranscripts(variantId)
  })
})

/**
 * Switch the selected transcript for a variant
 */
ipcMain.handle(
  'transcripts:switch',
  async (_event, variantId: number, transcriptId: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.switchSelectedTranscript(variantId, transcriptId)
      return { success: true }
    })
  }
)
```

**Step 2: Register in IPC index**

In `src/main/ipc/index.ts`, add to the `Promise.all` array (after line 27):

```typescript
    import('./handlers/transcripts')
```

**Step 3: Extend preload API**

In `src/preload/index.ts`, add after the `tags` section (after line 268):

```typescript
  transcripts: {
    list: (variantId: number) => ipcRenderer.invoke('transcripts:list', variantId),
    switch: (variantId: number, transcriptId: string) =>
      ipcRenderer.invoke('transcripts:switch', variantId, transcriptId)
  },
```

**Step 4: Commit**

```bash
git add src/main/ipc/handlers/transcripts.ts src/main/ipc/index.ts src/preload/index.ts
git commit -m "feat: add transcripts:list and transcripts:switch IPC handlers"
```

---

### Task 8: Frontend Composable — useTranscripts

**Files:**
- Create: `src/renderer/src/composables/useTranscripts.ts`

**Step 1: Create the composable**

```typescript
import { ref, watch, type Ref } from 'vue'
import type { TranscriptAnnotation } from '../../../shared/types/transcript'

/**
 * Composable for loading and switching variant transcripts.
 *
 * @param variantId - reactive variant ID (null when no variant selected)
 * @returns transcripts list, loading state, and switch function
 */
export function useTranscripts(variantId: Ref<number | null>) {
  const transcripts = ref<TranscriptAnnotation[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadTranscripts(id: number): Promise<void> {
    loading.value = true
    error.value = null
    try {
      transcripts.value = await window.api.transcripts.list(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      transcripts.value = []
    } finally {
      loading.value = false
    }
  }

  async function switchTranscript(transcriptId: string): Promise<boolean> {
    if (variantId.value === null) return false
    try {
      await window.api.transcripts.switch(variantId.value, transcriptId)
      // Reload to get updated state
      await loadTranscripts(variantId.value)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  watch(
    variantId,
    async (newId) => {
      if (newId !== null) {
        await loadTranscripts(newId)
      } else {
        transcripts.value = []
      }
    },
    { immediate: true }
  )

  return {
    transcripts,
    loading,
    error,
    switchTranscript
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/composables/useTranscripts.ts
git commit -m "feat: add useTranscripts composable for transcript list and switch"
```

---

### Task 9: TranscriptSection.vue — UI Component

**Files:**
- Create: `src/renderer/src/components/TranscriptSection.vue`

**Step 1: Create the component**

```vue
<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { TranscriptAnnotation } from '../../../shared/types/transcript'
import { useTranscripts } from '../composables/useTranscripts'

const props = defineProps<{
  variantId: number | null
}>()

const emit = defineEmits<{
  'transcript-switched': []
}>()

const variantIdRef = toRef(props, 'variantId')
const { transcripts, loading, switchTranscript } = useTranscripts(variantIdRef)

const hasTranscripts = computed(() => transcripts.value.length > 0)

const headers = [
  { title: 'Transcript', key: 'transcript_id', sortable: false },
  { title: 'Gene', key: 'gene_symbol', sortable: false },
  { title: 'Consequence', key: 'consequence', sortable: false },
  { title: 'cDNA', key: 'cdna', sortable: false },
  { title: 'Protein', key: 'aa_change', sortable: false },
  { title: 'Status', key: 'status', sortable: false, width: '180px' }
]

function consequenceColor(consequence: string | null): string {
  if (consequence === null) return 'grey'
  if (consequence === 'HIGH') return 'error'
  if (consequence === 'MODERATE') return 'warning'
  if (consequence === 'LOW') return 'info'
  return 'grey'
}

async function handleSwitch(transcript: TranscriptAnnotation): Promise<void> {
  const success = await switchTranscript(transcript.transcript_id)
  if (success) {
    emit('transcript-switched')
  }
}
</script>

<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-title class="d-flex align-center text-body-large py-2 px-4">
      Transcripts
      <v-chip v-if="hasTranscripts" size="x-small" class="ml-2" color="secondary">
        {{ transcripts.length }}
      </v-chip>
    </v-card-title>

    <v-divider />

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <div v-if="!loading && !hasTranscripts" class="pa-4 text-body-medium text-medium-emphasis">
      No transcript annotations available for this variant.
    </div>

    <v-data-table
      v-if="hasTranscripts && !loading"
      :headers="headers"
      :items="transcripts"
      density="compact"
      :items-per-page="-1"
      hide-default-footer
      class="transcript-table"
    >
      <template #item.consequence="{ value }">
        <v-chip v-if="value" :color="consequenceColor(value)" size="x-small" label>
          {{ value }}
        </v-chip>
        <span v-else class="text-medium-emphasis">-</span>
      </template>

      <template #item.cdna="{ value }">
        <span class="text-body-medium">{{ value ?? '-' }}</span>
      </template>

      <template #item.aa_change="{ value }">
        <span class="text-body-medium">{{ value ?? '-' }}</span>
      </template>

      <template #item.status="{ item }">
        <div class="d-flex ga-1 align-center">
          <v-chip
            v-if="item.is_selected"
            size="x-small"
            color="primary"
            label
          >
            Selected
          </v-chip>
          <v-chip
            v-if="item.is_mane_select"
            size="x-small"
            color="teal"
            label
          >
            MANE
          </v-chip>
          <v-chip
            v-if="item.is_canonical"
            size="x-small"
            color="grey"
            label
          >
            Canonical
          </v-chip>
          <v-btn
            v-if="!item.is_selected"
            size="x-small"
            variant="text"
            color="primary"
            @click="handleSwitch(item)"
          >
            Use
          </v-btn>
        </div>
      </template>
    </v-data-table>
  </v-card>
</template>

<style scoped>
.transcript-table :deep(th) {
  font-size: 0.75rem !important;
}
</style>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/TranscriptSection.vue
git commit -m "feat: add TranscriptSection component for viewing/switching transcripts"
```

---

### Task 10: VariantDetailsPanel Integration

**Files:**
- Modify: `src/renderer/src/components/VariantDetailsPanel.vue:29-33` (add TranscriptSection between Identity and Scores)

**Step 1: Add the component**

In `src/renderer/src/components/VariantDetailsPanel.vue`:

Add the import in the `<script setup>` section:

```typescript
import TranscriptSection from './TranscriptSection.vue'
```

Add the component in the template, between `VariantIdentitySection` (line 33) and the next section. After line 33 (`/>`), insert:

```vue
          <TranscriptSection
            :variant-id="variant?.id ?? null"
            @transcript-switched="$emit('variant-updated')"
            class="mb-4"
          />
```

Add `variant-updated` to the emit declarations. In the `defineEmits` (line 142-144), add:

```typescript
const emit = defineEmits<{
  'update:open': [value: boolean]
  'variant-updated': []
}>()
```

**Step 2: Wire up variant-updated in parent (VariantTable or CaseAnalysis)**

Check which parent uses VariantDetailsPanel and add the listener. The parent should re-fetch the current variant row when `variant-updated` fires. This integration depends on the specific parent component — at minimum, listening to the event and calling `loadVariants()` or similar refresh method.

**Step 3: Commit**

```bash
git add src/renderer/src/components/VariantDetailsPanel.vue
git commit -m "feat: integrate TranscriptSection into VariantDetailsPanel"
```

---

### Task 11: Window API Type Declaration

**Files:**
- Modify: `src/renderer/src/env.d.ts` or wherever `window.api` is typed

**Step 1: Find and extend the Window API type**

Search for the `window.api` type declaration and add the `transcripts` namespace. Add:

```typescript
transcripts: {
  list: (variantId: number) => Promise<TranscriptAnnotation[]>
  switch: (variantId: number, transcriptId: string) => Promise<{ success: boolean }>
}
```

Import `TranscriptAnnotation` type in the declaration file.

**Step 2: Run typecheck**

Run: `npx vue-tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/src/env.d.ts
git commit -m "feat: add transcripts to Window API type declaration"
```

---

### Task 12: Full Integration Test

**Step 1: Run all tests**

```bash
npm run rebuild:node && npx vitest run
```

Expected: All existing + new tests pass.

**Step 2: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: No errors.

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/typecheck issues from multi-transcript feature"
```
