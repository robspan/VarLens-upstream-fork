export interface WebImportUpload {
  ref: string
  fileName: string
  size: number
}

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

export async function uploadWebImportFiles(files: readonly File[]): Promise<WebImportUpload[]> {
  const uploaded: WebImportUpload[] = []
  for (const file of files) {
    uploaded.push(await uploadWebImportFile(file))
  }
  return uploaded
}

async function uploadWebImportFile(file: File): Promise<WebImportUpload> {
  const response = await fetch(`${API_BASE}/import/upload`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/octet-stream',
      'x-varlens-file-name': file.name
    },
    body: file
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}: ${text}`)
  }
  return JSON.parse(text) as WebImportUpload
}
