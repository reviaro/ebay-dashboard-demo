/** These yards are fictional. Coordinates are approximate, not real businesses. */
export const demoYards = [
  { name: 'Demo Yard North', lat: 38.88, lng: -77.45 },
  { name: 'Demo Yard River', lat: 38.70, lng: -77.60 },
  { name: 'Demo Yard West', lat: 38.83, lng: -77.78 },
];
const vehicles = [
  ['HONDA', 'Civic'], ['HONDA', 'Accord'], ['TOYOTA', 'Camry'], ['FORD', 'F-150'],
  ['CHEVROLET', 'Silverado'], ['BMW', '328i'], ['BMW', '3 Series'], ['VOLKSWAGEN', 'Jetta'], ['VOLKSWAGEN', 'Golf'],
  ['VOLVO', 'XC90'], ['SUBARU', 'Outback'], ['NISSAN', 'Altima'], ['MERCEDES-BENZ', 'C-Class'], ['AUDI', 'A4'],
];
export const demoYardInventory = demoYards.flatMap((yard, i) => vehicles.map(([make, model], j) => ({
  yard: yard.name, year: String(2008 + (i + j) % 9), make, model,
  color: ['Silver', 'Blue', 'White'][(i + j) % 3],
  rowOrStock: `SAMPLE-${i + 1}-${String(j + 1).padStart(3, '0')}`,
  dateAdded: '2026-09-25',
})));
export function searchDemoYards(make: string, model: string, yard = 'all') {
  const qMake = make.trim().toLowerCase();
  const qModel = model.trim().toLowerCase();
  return demoYardInventory.filter(row => row.make.toLowerCase().includes(qMake)
    && row.model.toLowerCase().includes(qModel)
    && (yard === 'all' || row.yard === yard));
}
