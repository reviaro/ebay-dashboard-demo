import { assertLiveIntegrationAllowed } from './demo/server';
import { parse } from 'node-html-parser';

export interface YardResult {
  yard: string;
  year: string;
  make: string;
  model: string;
  color: string;
  rowOrStock: string;
  dateAdded?: string;
}

export async function searchPickAPart(make: string, model: string): Promise<YardResult[]> {
  assertLiveIntegrationAllowed();
  try {
    // search-inventory.php iframe GET form: columns Year[0] Make[1] Model[2] Color[3] Stock#[4] Row[5] Location[6]
    const params = new URLSearchParams({ make: make.toUpperCase(), model });
    const url = `https://pickapartva.com/search-inventory.php?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });

    if (!response.ok) throw new Error(`Pick-A-Part request failed: ${response.statusText}`);

    const html = await response.text();
    const root = parse(html);

    // Results table has headers: Year Make Model Color Stock# Row Location Image
    const rows = root.querySelectorAll('table tr');
    const results: YardResult[] = [];

    rows.forEach(row => {
      const cols = row.querySelectorAll('td');
      if (cols.length >= 6) {
        const year = cols[0].text.trim();
        if (!year || isNaN(parseInt(year))) return; // skip header/non-data rows
        const location = cols[6]?.text.trim() || '';
        results.push({
          yard: `Pick-A-Part${location ? ` (${location})` : ''}`,
          year,
          make: cols[1].text.trim(),
          model: cols[2].text.trim(),
          color: cols[3].text.trim(),
          rowOrStock: `Stock: ${cols[4].text.trim()} / Row: ${cols[5].text.trim()}`,
        });
      }
    });

    return results;
  } catch (error) {
    console.error('Error searching Pick-A-Part:', error);
    return [];
  }
}

export async function searchRuperts(make: string, model: string): Promise<YardResult[]> {
  assertLiveIntegrationAllowed();
  try {
    const params = new URLSearchParams({
      make: make,
      model: model,
      year_start: '1900',
      year_end: '2025'
    });

    const url = `https://rupertsupullit.com/search-our-inventory/?${params.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) throw new Error(`Rupert's request failed: ${response.statusText}`);
    
    const html = await response.text();
    const root = parse(html);
    
    // Columns: thumbnail[0] Make[1] Model[2] Year[3] BodyStyle[4] Engine[5] YardRow[6] DateSet[7]
    const resultsTable = root.querySelector('.yardconnect-vehicles-table');
    if (!resultsTable) return [];

    const rows = resultsTable.querySelectorAll('tbody tr');
    const results: YardResult[] = [];

    rows.forEach(row => {
      const cols = row.querySelectorAll('td');
      if (cols.length >= 7) {
        results.push({
          yard: "Rupert's",
          year: cols[3].text.trim(),
          make: cols[1].text.trim(),
          model: cols[2].text.trim(),
          color: cols[4].text.trim(), // body style (no color field on this site)
          rowOrStock: cols[6].text.trim(),
          dateAdded: cols[7]?.text.trim(),
        });
      }
    });

    return results;
  } catch (error) {
    console.error("Error searching Rupert's:", error);
    return [];
  }
}

export async function searchAllYards(make: string, model: string): Promise<YardResult[]> {
  assertLiveIntegrationAllowed();
  const [pickAPartResults, rupertsResults] = await Promise.all([
    searchPickAPart(make, model),
    searchRuperts(make, model)
  ]);

  return [...pickAPartResults, ...rupertsResults].sort((a, b) => {
    // Sort by year descending
    return parseInt(b.year) - parseInt(a.year);
  });
}
