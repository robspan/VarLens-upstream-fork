INSERT INTO variants
  (id, case_id, chr, pos, ref, alt, gene_symbol, omim_mim_number, consequence, gnomad_af, cadd, clinvar, gt_num, func, qual, hpo_sim_score, transcript, cdna, aa_change, moi, variant_type, end_pos, sv_type, sv_length, caller, source_format)
VALUES
  (1, 1, '1', 1000, 'A', 'G', 'BRCA1', '113705', 'HIGH', 0.001, 28.5, 'Pathogenic', '0/1', 'missense_variant', 99.0, 0.91, 'NM_007294.4', 'c.100A>G', 'p.Lys34Arg', 'AD', 'snv', NULL, NULL, NULL, 'vep', 'vcf'),
  (2, 1, '1', 1050, 'AT', 'A', 'BRCA2', '600185', 'MODERATE', 0.02, 18.1, 'Likely benign', '0/1', 'frameshift_variant', 87.0, 0.72, 'NM_000059.4', 'c.200delT', 'p.Val67fs', 'AD', 'indel', NULL, NULL, NULL, 'vep', 'vcf'),
  (3, 1, '2', 2000, 'N', '<DEL>', 'DMD', '310200', 'HIGH', NULL, 30.0, 'Pathogenic', '0/1', 'transcript_ablation', 80.0, 0.83, NULL, NULL, NULL, 'XR', 'sv', 2600, 'DEL', -600, 'manta', 'vcf'),
  (4, 1, '3', 3000, 'N', '<DUP>', 'PMP22', '601097', 'MODERATE', NULL, 12.2, NULL, '1/1', 'copy_number_gain', 75.0, 0.55, NULL, NULL, NULL, 'AD', 'cnv', 9000, 'DUP', 6000, 'cnvnator', 'vcf'),
  (5, 1, '4', 4000, 'CAG', '<STR>', 'HTT', '613004', 'MODERATE', NULL, 10.5, 'Pathogenic', '0/1', 'repeat_expansion', 60.0, 0.88, NULL, NULL, NULL, 'AD', 'str', 4045, NULL, NULL, 'expansionhunter', 'vcf'),
  (6, 2, '1', 1000, 'A', 'G', 'BRCA1', '113705', 'HIGH', 0.001, 28.5, 'Pathogenic', '0/1', 'missense_variant', 99.0, 0.91, 'NM_007294.4', 'c.100A>G', 'p.Lys34Arg', 'AD', 'snv', NULL, NULL, NULL, 'vep', 'vcf')
ON CONFLICT (id) DO UPDATE SET
  case_id = EXCLUDED.case_id,
  gene_symbol = EXCLUDED.gene_symbol,
  consequence = EXCLUDED.consequence,
  variant_type = EXCLUDED.variant_type;

-- Phase 7 seed uses bare chromosome names (`1`, `2`, `3`, `4`) consistently
-- so variant_frequency joins match the seeded variants literally.

-- Phase 9.1: variant_frequency unique constraint moved to coord_hash;
-- the generated column is computed from chr/pos/ref/alt automatically.
INSERT INTO variant_frequency (chr, pos, ref, alt, case_count)
VALUES ('1', 1000, 'A', 'G', 2)
ON CONFLICT (coord_hash) DO UPDATE SET case_count = EXCLUDED.case_count;

INSERT INTO variant_sv (variant_id, support, event_id, mate_id)
VALUES (3, 12, 'MANTA_EVENT_001', 'MATE_001')
ON CONFLICT (variant_id) DO UPDATE SET support = EXCLUDED.support, event_id = EXCLUDED.event_id, mate_id = EXCLUDED.mate_id;

INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality)
VALUES (4, 4, 70)
ON CONFLICT (variant_id) DO UPDATE SET copy_number = EXCLUDED.copy_number, copy_number_quality = EXCLUDED.copy_number_quality;

INSERT INTO variant_str (variant_id, repeat_id, repeat_unit, disease, str_status)
VALUES (5, 'HTT', 'CAG', 'Huntington disease', 'pathogenic')
ON CONFLICT (variant_id) DO UPDATE SET repeat_id = EXCLUDED.repeat_id, repeat_unit = EXCLUDED.repeat_unit, disease = EXCLUDED.disease, str_status = EXCLUDED.str_status;

UPDATE cases
SET variant_count = seeded.count
FROM (
  SELECT case_id, COUNT(*)::BIGINT AS count
  FROM variants
  GROUP BY case_id
) seeded
WHERE cases.id = seeded.case_id;

SELECT setval(pg_get_serial_sequence('public.variants', 'id'), COALESCE((SELECT MAX(id) FROM variants), 1), true);
SELECT setval(pg_get_serial_sequence('public.variant_transcripts', 'id'), COALESCE((SELECT MAX(id) FROM variant_transcripts), 1), true);
