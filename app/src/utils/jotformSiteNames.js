// JotForm's "Site" dropdown uses the full number-city-street naming convention
// (e.g. "1520-Cleveland-N Davis"), while our locations table stores the shorter
// "1520-Cleveland". Map by the site number (the part before the first hyphen)
// so downtime submissions land on the correct JotForm dropdown option.

export const JOTFORM_SITE_NAMES = {
  '1504': '1504-Brooklyn-Atlantic',
  '1505': '1505-Hempstead-Henry',
  '1506': '1506-Queens-Rockaway',
  '1507': '1507-Miller Place-NY-25A',
  '1508': '1508-Mesquite-Town E',
  '1509': '1509-Mesquite-N Belt Line',
  '1510': '1510-McKinney-Stacy',
  '1511': '1511-Allen-W McDermott',
  '1512': '1512-Fort Mohave-S Hwy 95',
  '1513': '1513-Memphis-Hickory Hill',
  '1514': '1514-Memphis-Getwell',
  '1515': '1515-Albuquerque-Coors',
  '1516': '1516-Plano-Ohio',
  '1517': '1517-Forney-Kroger',
  '1518': '1518-Greenwood-Hwy 82',
  '1519': '1519-Greenville-Hwy 1',
  '1520': '1520-Cleveland-N Davis',
  '1521': '1521-Port Arthur-Hwy 365',
  '1522': '1522-Groves-39th',
  '1524': '1524-Beaumont-Hwy 105',
  '1525': '1525-Breaux Bridge-Rees',
  '1526': '1526-Mansura-Hwy 1',
  '1527': '1527-Carencro-Wallace',
  '1528': '1528-Dunedin-Belcher',
  '1529': '1529-Largo-Walsingham',
  '1530': '1530-Batesville-Hwy 6 E',
  '1531': '1531-Cape Girardeau-Bloomfield',
  '1532': '1532-Jackson-E Jackson',
}

// Given our app's location name ("1520-Cleveland" or similar), return the full
// JotForm dropdown label. Falls back to the original name if the site number
// isn't in the map (e.g. a new site added before this table is updated).
export function getJotformSiteName(locationName) {
  if (!locationName) return ''
  const num = String(locationName).split('-')[0].trim()
  return JOTFORM_SITE_NAMES[num] || locationName
}
