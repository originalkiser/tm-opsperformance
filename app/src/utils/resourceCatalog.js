export const catalogCategories = catalog => catalog.filter(c => !c.brand_key).sort(folderOrder)
export const catalogManufacturers = (catalog, category) => catalog.filter(c => c.category_key === category && c.brand_key).sort(folderOrder)
const folderOrder = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
export const categoryFolder = (catalog, key) => catalog.find(c => c.category_key === key && !c.brand_key)
export function resourceLabels(row, catalog) {
  return { category: categoryFolder(catalog, row.category)?.name || row.category,
    brand: catalog.find(c => c.category_key === row.category && c.brand_key === row.brand)?.name || row.brand }
}
export const catalogExpectation = catalog => catalog.map(({ id, revision }) => ({ id, revision })).sort((a, b) => a.id.localeCompare(b.id))
export async function catalogAction(client, action, catalog, folder, data = {}) {
  const result = await client.rpc('manage_resource_catalog', { p_action: action, p_expected: catalogExpectation(catalog), p_id: folder?.id || null, p_data: data })
  if (result.error) throw new Error(result.error.message)
  return result.data
}
