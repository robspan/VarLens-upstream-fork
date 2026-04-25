#!/usr/bin/env bash
# Idempotent downloader for the GIAB HG002 GRCh38 v4.2.1 high-confidence VCF
# used by the WGS perf benchmarks (tests/perf/postgres-vcf-wgs-import.perf.test.ts
# and tests/perf/sqlite-vcf-wgs-import.perf.test.ts).
#
# The download lands in tests/.cache/wgs/ which is gitignored. Re-runs are no-ops
# once the file is present. The pinned SHA256 is verified after download to catch
# accidental corruption or upstream replacement.
#
# Usage:
#   scripts/postgres/download-wgs-fixture.sh
set -euo pipefail

CACHE_DIR="$(git rev-parse --show-toplevel)/tests/.cache/wgs"
mkdir -p "${CACHE_DIR}"

VCF_URL="https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/AshkenazimTrio/HG002_NA24385_son/NISTv4.2.1/GRCh38/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz"
VCF_TBI_URL="${VCF_URL}.tbi"
VCF_FILE="${CACHE_DIR}/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz"
VCF_TBI_FILE="${VCF_FILE}.tbi"

# Pin after the first verified download:
#   sha256sum tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz
# then paste the value below to enable verification on subsequent runs.
VCF_SHA256=""

download_if_missing() {
  local url="$1"
  local out="$2"
  if [[ -f "${out}" ]]; then
    echo "[wgs-fixture] ${out} already present"
    return 0
  fi
  echo "[wgs-fixture] downloading ${url}"
  curl -fL --retry 3 --retry-delay 5 -o "${out}.partial" "${url}"
  mv "${out}.partial" "${out}"
}

download_if_missing "${VCF_URL}" "${VCF_FILE}"
download_if_missing "${VCF_TBI_URL}" "${VCF_TBI_FILE}"

if [[ -n "${VCF_SHA256}" ]]; then
  echo "${VCF_SHA256}  ${VCF_FILE}" | sha256sum -c -
else
  echo "[wgs-fixture] no SHA256 pinned yet; compute via 'sha256sum ${VCF_FILE}' and update VCF_SHA256 in this script"
fi

echo "[wgs-fixture] ready: ${VCF_FILE}"
