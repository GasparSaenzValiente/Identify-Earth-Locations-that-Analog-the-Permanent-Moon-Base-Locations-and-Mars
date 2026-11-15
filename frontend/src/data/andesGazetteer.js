/**
 * Glaciated sectors of the Argentine Andes used to group the inventory for ranking.
 *
 * Centres sit on the glacier clusters of the dataset and carry the name of the range, massif,
 * basin or lake that the sector is known by. Every glacier is assigned to the nearest centre
 * (great-circle distance), so the list partitions the inventory without gaps.
 *
 * Macro-regions follow the five glaciological regions of the Argentine National Glacier Inventory
 * (ING · IANIGLA), here bounded by latitude.
 */
export const MACRO_REGIONS = [
  { key: 'desert', name: 'Desert Andes', from: -21, to: -31 },
  { key: 'central', name: 'Central Andes', from: -31, to: -36 },
  { key: 'npat', name: 'Northern Patagonian Andes', from: -36, to: -46 },
  { key: 'spat', name: 'Southern Patagonian Andes', from: -46, to: -52.5 },
  { key: 'fuego', name: 'Tierra del Fuego & South Atlantic', from: -52.5, to: -90 },
]

export function macroRegionFor(lat, lon) {
  if (lon > -50) return MACRO_REGIONS[4] // South Georgia
  return MACRO_REGIONS.find((m) => lat <= m.from && lat > m.to) ?? MACRO_REGIONS[4]
}

export const ANDES_SECTORS = [
  // Desert Andes
  { name: 'Sierra de Santa Victoria', province: 'Salta · Jujuy', lat: -22.55, lon: -65.21 },
  { name: 'Puna de Jujuy', province: 'Jujuy', lat: -22.75, lon: -66.55 },
  { name: 'Sierra de Zenta', province: 'Jujuy · Salta', lat: -23.3, lon: -65.15 },
  { name: 'Sierra de Aguilar', province: 'Jujuy', lat: -23.22, lon: -65.7 },
  { name: 'Nevado de Chañi', province: 'Jujuy · Salta', lat: -24.15, lon: -65.68 },
  { name: 'Nevado de Acay', province: 'Salta', lat: -24.43, lon: -66.15 },
  { name: 'Puna de Salta', province: 'Salta', lat: -24.35, lon: -66.9 },
  { name: 'Nevado de Cachi', province: 'Salta', lat: -24.85, lon: -66.3 },
  { name: 'Volcán Socompa', province: 'Salta', lat: -24.41, lon: -68.25 },
  { name: 'Antofalla', province: 'Catamarca', lat: -25.65, lon: -68.1 },
  { name: 'Cerro Galán', province: 'Catamarca', lat: -26.1, lon: -66.85 },
  { name: 'Sierra del Cajón', province: 'Catamarca · Tucumán', lat: -26.23, lon: -66.26 },
  { name: 'Nevados del Aconquija', province: 'Catamarca · Tucumán', lat: -27.12, lon: -66.03 },
  { name: 'Ojos del Salado – Pissis', province: 'Catamarca', lat: -27.3, lon: -68.4 },
  { name: 'Laguna Brava', province: 'La Rioja', lat: -28.35, lon: -69.3 },
  { name: 'Sierra de Famatina', province: 'La Rioja', lat: -28.98, lon: -67.8 },
  { name: 'Valle del Cura', province: 'San Juan', lat: -29.15, lon: -69.75 },
  { name: 'Agua Negra', province: 'San Juan', lat: -30.1, lon: -69.75 },
  { name: 'Iglesia high cordillera', province: 'San Juan', lat: -30.65, lon: -70.1 },
  // Central Andes
  { name: 'Upper San Juan basin', province: 'San Juan', lat: -31.2, lon: -70.15 },
  { name: 'Cordillera de la Ramada', province: 'San Juan', lat: -31.82, lon: -70.15 },
  { name: 'Cordillera del Tigre', province: 'Mendoza', lat: -32.3, lon: -69.85 },
  { name: 'Aconcagua', province: 'Mendoza', lat: -32.7, lon: -70.0 },
  { name: 'Cordón del Plata', province: 'Mendoza', lat: -33.0, lon: -69.45 },
  { name: 'Tupungato', province: 'Mendoza', lat: -33.25, lon: -69.75 },
  { name: 'Upper Tunuyán basin', province: 'Mendoza', lat: -33.75, lon: -69.65 },
  { name: 'Volcán Maipo', province: 'Mendoza', lat: -34.25, lon: -69.78 },
  { name: 'Atuel basin', province: 'Mendoza', lat: -34.8, lon: -70.05 },
  { name: 'Río Grande basin', province: 'Mendoza', lat: -35.3, lon: -70.15 },
  // Northern Patagonian Andes
  { name: 'Domuyo', province: 'Neuquén', lat: -36.5, lon: -70.45 },
  { name: 'Volcán Lanín', province: 'Neuquén', lat: -39.65, lon: -71.5 },
  { name: 'Nahuel Huapi', province: 'Río Negro', lat: -41.45, lon: -71.3 },
  { name: 'Northern Chubut Andes', province: 'Chubut', lat: -42.5, lon: -71.23 },
  { name: 'Southern Chubut Andes', province: 'Chubut', lat: -44.8, lon: -71.37 },
  // Southern Patagonian Andes
  { name: 'Lago Buenos Aires', province: 'Santa Cruz', lat: -46.2, lon: -71.87 },
  { name: 'Lago Pueyrredón', province: 'Santa Cruz', lat: -47.0, lon: -71.85 },
  { name: 'Monte San Lorenzo', province: 'Santa Cruz', lat: -47.62, lon: -72.2 },
  { name: 'Lago San Martín', province: 'Santa Cruz', lat: -48.5, lon: -72.4 },
  { name: 'Fitz Roy', province: 'Santa Cruz', lat: -49.25, lon: -72.85 },
  { name: 'Lago Argentino', province: 'Santa Cruz', lat: -50.6, lon: -72.3 },
  // Tierra del Fuego & South Atlantic
  { name: 'Montes Martial', province: 'Tierra del Fuego', lat: -54.65, lon: -68.35 },
  { name: 'Eastern Fuegian Andes', province: 'Tierra del Fuego', lat: -54.77, lon: -67.3 },
  { name: 'South Georgia', province: 'South Atlantic', lat: -54.5, lon: -36.4 },
].map((s, index) => ({ ...s, index, macro: macroRegionFor(s.lat, s.lon) }))
