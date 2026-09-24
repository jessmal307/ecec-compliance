import { supabase } from './supabase'

export const FORM_UPLOADS_BUCKET = 'form-uploads'
export const MAX_FORM_UPLOAD_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
])

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
])

export const FORM_EVIDENCE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,.jpg,.jpeg,.png,.webp,.gif,.heic'

function fileExtension(name) {
  const match = /\.[^.]+$/.exec(String(name ?? ''))
  return match ? match[0].toLowerCase() : ''
}

export function sanitizeFormFilename(name) {
  const base = String(name || 'photo').split(/[/\\]/).pop()
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'photo'
}

export function isSignatureDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/')
}

export function validateFormUpload(file) {
  if (!file) return { error: null }
  if (file.size > MAX_FORM_UPLOAD_BYTES) {
    return { error: 'File is too large. Use an image under 10MB.' }
  }
  const extension = fileExtension(file.name)
  const typeOk =
    ALLOWED_MIME_TYPES.has(file.type) || ALLOWED_EXTENSIONS.has(extension)
  if (!typeOk) {
    return { error: 'Upload a photo (JPG, PNG, WebP, or GIF).' }
  }
  return { error: null }
}

export async function dataUrlToFile(dataUrl, name = 'signature.png') {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type || 'image/png' })
}

export async function uploadFormFile({ orgId, submissionId, file, kind }) {
  const invalid = validateFormUpload(file)
  if (invalid.error) return { path: null, error: { message: invalid.error } }
  if (!orgId || !submissionId) {
    return { path: null, error: { message: 'Save a draft before uploading.' } }
  }

  const filename = sanitizeFormFilename(file.name)
  const path =
    kind === 'signature'
      ? `${orgId}/${submissionId}/signature.png`
      : kind === 'field'
        ? `${orgId}/${submissionId}/fields/${filename}`
        : `${orgId}/${submissionId}/evidence/${filename}`

  await supabase.storage.from(FORM_UPLOADS_BUCKET).remove([path])

  const { error } = await supabase.storage
    .from(FORM_UPLOADS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    })

  if (error) return { path: null, error }
  return { path, error: null }
}

export async function getFormUploadUrl(path) {
  if (!path) return { url: null, error: null }
  if (isSignatureDataUrl(path)) return { url: path, error: null }

  const { data, error } = await supabase.storage
    .from(FORM_UPLOADS_BUCKET)
    .createSignedUrl(path, 5 * 60)

  if (error) return { url: null, error }
  return { url: data?.signedUrl ?? null, error: null }
}
