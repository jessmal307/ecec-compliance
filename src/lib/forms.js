import { supabase } from './supabase'

const TEMPLATE_FIELDS =
  'id, org_id, name, archetype, schema, reg_ref, description, is_system, archived_at, created_at'

function mapTemplate(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    archetype: row.archetype,
    schema: row.schema ?? {},
    reg_ref: row.reg_ref ?? '',
    description: row.description ?? '',
    is_system: Boolean(row.is_system),
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
  }
}

export function archetypeLabel(archetype) {
  if (archetype === 'register') return 'Register'
  if (archetype === 'checklist') return 'Checklist'
  if (archetype === 'risk_matrix') return 'Risk matrix'
  return 'Form'
}

export async function listFormTemplates() {
  const { data, error } = await supabase
    .from('form_templates')
    .select(TEMPLATE_FIELDS)
    .is('archived_at', null)
    .order('name')

  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapTemplate), error: null }
}

export async function getFormTemplate(id) {
  const { data, error } = await supabase
    .from('form_templates')
    .select(TEMPLATE_FIELDS)
    .eq('id', id)
    .maybeSingle()

  if (error) return { data: null, error }
  if (!data) return { data: null, error: null }
  return { data: mapTemplate(data), error: null }
}
