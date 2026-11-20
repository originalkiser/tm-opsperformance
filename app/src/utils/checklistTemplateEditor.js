import { requiredChecklistPhotos } from './checklistRules.js'
import { withViewWrite } from './managerViewPolicy.js'
export const questionPresets = {
  completion: { options: ['Completed', 'Not Completed'], failure_values: ['Not Completed'] },
  yesno: { options: ['Yes', 'No'], failure_values: ['No'] },
  passfail: { options: ['Passed', 'Failed'], failure_values: ['Failed'] },
  text: { options: [], failure_values: [] },
}
export function newChecklistQuestion(type, section, makeId = () => crypto.randomUUID()) {
  if (!questionPresets[type]) throw new Error('Choose an approved question type.')
  return { id: `q-${makeId()}`, section, text: 'New question', instruction: '', type, ...structuredClone(questionPresets[type]), critical: false, photo_required: false, photo_min_count: 0, na_allowed: false, required: true }
}
export function photoBudget(items) {
  try { return 1 + items.reduce((sum, item) => sum + Math.max(requiredChecklistPhotos(item), item.photo_on_failure ? 1 : 0) + (item.signature_required ? 1 : 0), 0) }
  catch { return Infinity }
}
export function moveChecklistSection(items, section, direction) {
  const groups = []
  for (const item of items) {
    if (groups.at(-1)?.[0].section !== item.section) groups.push([])
    groups.at(-1).push(item)
  }
  const index = groups.findIndex(g => g[0].section === section), target = index + direction
  if (index < 0 || target < 0 || target >= groups.length) return items
  ;[groups[index], groups[target]] = [groups[target], groups[index]]
  return groups.flat()
}
// The server repeats these checks against trusted published/restored definitions.
export function questionRemovalReason(key, item, items, baseline = items) {
  if (items.length <= 1) return 'A checklist must contain at least one question.'
  const protectedItems = [...baseline, ...items]
  if (protectedItems.some(i => i.id === item.id && i.signature_required)) return 'This question requires a signature and cannot be removed.'
  if (protectedItems.some(i => (i.id === item.id && i.condition) || i.condition?.item_id === item.id)) return 'Conditional follow-ups and their parent questions cannot be removed.'
  if (key === 'weekly' && item.id === 'weekly-9') return 'This communications-board photo question is used by the checklist form and cannot be removed.'
  return ''
}
export async function templateEditorAction(client, action, key, state = null, extra = {}) {
  const request = () => client.rpc('checklist_template_editor', { p_action: action, p_key: key,
    ...(state ? { p_revision: state.draft?.revision ?? 0, p_version: state.published.version } : {}), ...extra })
  const result = ['read', 'version', 'revisions'].includes(action) ? await request() : await withViewWrite(request)
  if (result.error) throw result.error
  if (!result.data) throw new Error('Incomplete editor response. Reload before making changes.')
  return result.data
}
