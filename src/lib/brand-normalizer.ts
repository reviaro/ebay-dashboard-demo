// Canonical vehicle make names. Lookups are case-insensitive so stored
// variants like "VOLVO" or "MERCEDES-BENZ" collapse to one spelling.
export const CANONICAL_MAKES = [
  'Ford', 'Chevrolet', 'Dodge', 'GMC', 'Toyota', 'Honda', 'BMW',
  'Mercedes-Benz', 'Volvo', 'Jeep', 'Chrysler', 'Lincoln', 'Cadillac', 'Buick',
  'Pontiac', 'Saturn', 'Oldsmobile', 'Subaru', 'Nissan', 'Mazda', 'Audi',
  'Volkswagen', 'Porsche', 'Lexus', 'Acura', 'Infiniti', 'Mitsubishi',
  'Hyundai', 'Kia', 'Land Rover', 'Jaguar', 'Saab', 'Isuzu', 'Mercury',
  'Ram', 'Hummer', 'Scion', 'Tesla', 'Alfa Romeo', 'Fiat', 'Maserati',
  'Ferrari', 'Lamborghini', 'Bentley', 'Rolls-Royce', 'Mini', 'Smart',
  'Suzuki', 'Geo',
];

const CANONICAL_BY_KEY = new Map(CANONICAL_MAKES.map(m => [m.toLowerCase(), m]));

// Maps use Maps (not plain objects) so prototype property names like
// "constructor" can never produce a bogus hit.
const BRAND_ALIASES = new Map<string, string>([
  ['vw', 'Volkswagen'],
  ['mercedes', 'Mercedes-Benz'],
  ['benz', 'Mercedes-Benz'],
  ['chevy', 'Chevrolet'],
  // Single-word fragments left over when a title parser splits "Land Rover"
  ['land', 'Land Rover'],
  ['rover', 'Land Rover'],
  ['landrover', 'Land Rover'],
  ['rolls', 'Rolls-Royce'],
  ['alfa', 'Alfa Romeo'],
]);

export function normalizeBrand(brand?: string | null): string {
  const cleaned = (brand || '').trim();
  if (!cleaned) return 'Unknown';

  const key = cleaned.toLowerCase().replace(/\s+/g, ' ');
  return BRAND_ALIASES.get(key) ?? CANONICAL_BY_KEY.get(key) ?? cleaned;
}

// Single-word lookup for extracting a make from a listing title.
// Returns the canonical make, or null if the word is not a known make/alias.
export function matchBrandWord(word: string): string | null {
  const key = word.toLowerCase();
  return BRAND_ALIASES.get(key) ?? CANONICAL_BY_KEY.get(key) ?? null;
}
