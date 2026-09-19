import { supabase } from './supabase'

export const COMPLIANCE_DOCS_BUCKET = 'compliance-docs'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
])

export const DOCUMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic'

function fileExtension(name) {
  const match = /\.[^.]+$/.exec(String(name ?? ''))
  return match ? match[0].toLowerCase() : ''
}

export function documentFileName(path) {
  if (!path) return ''
  return String(path).split('/').pop() || path
}

export function sanitizeDocumentFilename(name) {
  const base = String(name || 'certificate').split(/[/\\]/).pop()
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'certificate'
}

export function validateComplianceDocument(file) {
  if (!file) return { error: null }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: 'File is too large. Use a PDF or image under 10MB.' }
  }

  const extension = fileExtension(file.name)
  const typeOk =
    ALLOWED_MIME_TYPES.has(file.type) || ALLOWED_EXTENSIONS.has(extension)

  if (!typeOk) {
    return {
      error: 'Wrong file type. Upload a PDF or image (JPG, PNG, WebP, or GIF).',
    }
  }

  return { error: null }
}

export async function uploadComplianceDocument({ orgId, itemId, file }) {
  const invalid = validateComplianceDocument(file)
  if (invalid.error) {
    return { path: null, error: { message: invalid.error } }
  }
  if (!orgId || !itemId) {
    return {
      path: null,
      error: { message: 'Cannot upload until the compliance item is saved.' },
    }
  }

  const filename = sanitizeDocumentFilename(file.name)
  const path = `${orgId}/${itemId}/${filename}`

  await supabase.storage.from(COMPLIANCE_DOCS_BUCKET).remove([path])

  const { error } = await supabase.storage
    .from(COMPLIANCE_DOCS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    })

  if (error) {
    return { path: null, error }
  }

  return { path, error: null }
}

export async function deleteComplianceDocument(path) {
  if (!path) return { error: null }

  const { error } = await supabase.storage
    .from(COMPLIANCE_DOCS_BUCKET)
    .remove([path])

  return { error }
}

export async function persistComplianceDocument({
  orgId,
  itemId,
  file,
  currentPath,
}) {
  if (!file) return { path: currentPath ?? null, error: null }

  const { path, error } = await uploadComplianceDocument({ orgId, itemId, file })
  if (error) return { path: null, error }

  if (currentPath && currentPath !== path) {
    await deleteComplianceDocument(currentPath)
  }

  const { error: updateError } = await supabase
    .from('compliance_items')
    .update({ document_url: path })
    .eq('id', itemId)

  if (updateError) {
    return { path: null, error: updateError }
  }

  return { path, error: null }
}

export async function removeComplianceDocument({ itemId, path }) {
  const { error } = await deleteComplianceDocument(path)
  if (error) return { error }

  const { error: updateError } = await supabase
    .from('compliance_items')
    .update({ document_url: null })
    .eq('id', itemId)

  return { error: updateError }
}

export async function getComplianceDocumentUrl(path) {
  if (!path) return { url: null, error: { message: 'No document attached.' } }

  const { data, error } = await supabase.storage
    .from(COMPLIANCE_DOCS_BUCKET)
    .createSignedUrl(path, 5 * 60)

  if (error) {
    return { url: null, error }
  }

  return { url: data?.signedUrl ?? null, error: null }
}
