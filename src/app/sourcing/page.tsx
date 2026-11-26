'use client';

import { storeFetch } from '@/lib/stores/browser';

import dynamic from 'next/dynamic';
import { useState, useTransition, useMemo } from 'react';
import type { YardResult } from '@/lib/yard-parser';
import { VOLVO_CATEGORIES, CONDITION_GRADES } from '@/lib/constants';
import BrandingTemplate from '@/components/BrandingTemplate';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE } from '@/lib/demo/config';
import { demoYards, searchDemoYards } from '@/lib/demo/sourcing';

// SSR-safe dynamic import for SourcingMap
const SourcingMap = dynamic(() => import('@/components/SourcingMap'), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full bg-gray-100 dark:bg-gray-700 animate-pulse rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-500">Loading Map...</div>
});

export default function SourcingPage() {
  const demo = useDemoMode();
  const [make, setMake] = useState('VOLVO');
  const [model, setModel] = useState('');
  const [yard, setYard] = useState('all');
  const [year, setYear] = useState('');

  // Specialist Hierarchy State
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState('');
  const [selectedComponent, setSelectedComponent] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('A');
  const [isInternationalReady, setIsInternationalReady] = useState(false);

  // Selected result for Branding
  const [selectedForBranding, setSelectedForBranding] = useState<YardResult | null>(null);

  const [results, setResults] = useState<YardResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, startSearching] = useTransition();

  // Derived Category Data
  const selectedCategory = useMemo(() =>
    VOLVO_CATEGORIES.find(c => c.id === selectedCategoryId),
  [selectedCategoryId]);

  const selectedSystem = useMemo(() =>
    selectedCategory?.systems.find(s => s.id === selectedSystemId),
  [selectedCategory, selectedSystemId]);

  const filteredResults = useMemo(() =>
    year ? results.filter(r => String(r.year) === year) : results,
  [results, year]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    // Determine search model
    let searchModel = model;
    if (make.trim().toUpperCase() === 'VOLVO' && selectedCategory) {
      // Extract model prefix for yard search (e.g., "XC90" from "XC90 (2003-2014)")
      searchModel = selectedCategory.name.split(' ')[0];
    }

    if (!make || !searchModel) return;

    setError(null);
    startSearching(async () => {
      try {
        if (demo) {
          setResults(searchDemoYards(make, searchModel, yard));
          return;
        }
        const response = await storeFetch(`/api/sourcing/search?make=${encodeURIComponent(make)}&model=${encodeURIComponent(searchModel)}&yard=${yard}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to search inventory');
        }
        const data = await response.json();
        setResults(data.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setResults([]);
      }
    });
  };

  return (
    <div className="container mx-auto p-4 space-y-8 pb-20">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Sourcing Intelligence</h1>
          <p className="text-gray-600 dark:text-slate-400">{demo ? `Explore fictional yard inventory as of ${DEMO_DATE} (UTC). Searches use local sample records; no yard websites are contacted.` : 'Plan your yard trips by searching real-time inventory across regional yards.'}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 p-3 rounded-lg text-sm">
          <span className="font-bold text-blue-800 dark:text-blue-300">Specialist Mode:</span>
          <span className="ml-2 text-blue-700 dark:text-blue-400">Volvo Category Hierarchy Active</span>
        </div>
      </div>

      {/* Sourcing Map Section */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold dark:text-white">Yard Locations</h2>
        <SourcingMap />
      </section>

      {/* Search Section */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold dark:text-white">Inventory Search & Data Capture</h2>

        <form onSubmit={handleSearch} className="space-y-6 bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          {/* Main Search Row */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label htmlFor="make-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Make</label>
              <input
                id="make-input"
                list="makes-list"
                value={make}
                onChange={(e) => setMake(e.target.value.toUpperCase())}
                placeholder="e.g. VOLVO"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="makes-list">
                <option value="VOLVO" />
                <option value="BMW" />
                <option value="AUDI" />
                <option value="MERCEDES-BENZ" />
                <option value="HONDA" />
                <option value="TOYOTA" />
                <option value="FORD" />
                <option value="CHEVROLET" />
              </datalist>
            </div>

            {make.trim().toUpperCase() === 'VOLVO' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model Series</label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => {
                    setSelectedCategoryId(e.target.value);
                    setSelectedSystemId('');
                    setSelectedComponent('');
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Series...</option>
                  {VOLVO_CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. 328i"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="year-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Year</label>
              <input
                id="year-input"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 2008"
                min="1980"
                max={demo ? DEMO_DATE.slice(0, 4) : '2026'}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yard Selection</label>
              <select
                value={yard}
                onChange={(e) => setYard(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Yards</option>
                {demo ? demoYards.map(sampleYard => <option key={sampleYard.name} value={sampleYard.name}>{sampleYard.name}</option>) : <>
                  <option value="pickapart">Pick-A-Part VA</option>
                  <option value="ruperts">Rupert's U-Pull It</option>
                </>}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isSearching}
                className="w-full bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isSearching ? 'Searching...' : 'Search Inventory'}
              </button>
            </div>
          </div>

          {/* Volvo specialist hierarchy Row */}
          {make.trim().toUpperCase() === 'VOLVO' && selectedCategoryId && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">System</label>
                <select
                  value={selectedSystemId}
                  onChange={(e) => {
                    setSelectedSystemId(e.target.value);
                    setSelectedComponent('');
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select System...</option>
                  {selectedCategory?.systems.map(sys => (
                    <option key={sys.id} value={sys.id}>{sys.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Specific Component</label>
                <select
                  value={selectedComponent}
                  onChange={(e) => setSelectedComponent(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Component...</option>
                  {selectedSystem?.components.map(comp => (
                    <option key={comp} value={comp}>{comp}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Grade</label>
                <div className="flex gap-2">
                  {CONDITION_GRADES.map(grade => (
                    <button
                      key={grade.id}
                      type="button"
                      onClick={() => setSelectedGrade(grade.id)}
                      className={`flex-1 py-2 px-1 text-xs font-medium border rounded-md transition ${
                        selectedGrade === grade.id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }`}
                    >
                      {grade.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Additional Listing Flags */}
          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={isInternationalReady}
                onChange={(e) => setIsInternationalReady(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600 transition">International Shipping Ready (eIS)</span>
            </label>
          </div>
        </form>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {/* Branding Preview */}
        {selectedForBranding && (
          <div className="animate-in fade-in slide-in-from-top duration-500">
            <BrandingTemplate
              partName={`${selectedForBranding.year} ${selectedForBranding.make} ${selectedForBranding.model} ${selectedComponent || 'Part'}`}
              brand={demo ? selectedForBranding.make : undefined}
              mpn={demo ? 'DEMO-PLACEHOLDER-NOT-A-REAL-MPN' : 'OE-VOLVO-REPLACEMENT'}
              condition={CONDITION_GRADES.find(g => g.id === selectedGrade)?.name || 'Used'}
              isInternationalReady={isInternationalReady}
              fitment={[
                { year: selectedForBranding.year, model: selectedForBranding.model }
              ]}
              countryOfOrigin={demo ? 'Fictional sample; origin not specified' : 'Sweden'}
              weight={demo ? 'Sample only; not measured' : '2.5 lbs'}
              dimensions={demo ? 'Sample only; not measured' : '10x8x4 in'}
            />
            <div className="mt-2 text-right">
              <button
                onClick={() => setSelectedForBranding(null)}
                className="text-sm text-gray-500 hover:text-red-600"
              >
                Close Generator
              </button>
            </div>
          </div>
        )}

        {/* Results Table */}
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Yard</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Year</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Make/Model</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Color</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Row/Stock #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredResults.length > 0 ? (
                filteredResults.map((res, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{res.yard}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{res.year}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{res.make} {res.model}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{res.color}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{res.rowOrStock}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      <button
                        onClick={() => {
                          setSelectedForBranding(res);
                          window.scrollTo({ top: 400, behavior: 'smooth' });
                        }}
                        className="text-blue-600 hover:text-blue-400 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                      >
                        Generate Brand HTML
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                    {isSearching ? (demo ? 'Searching fictional inventory...' : 'Fetching latest inventory...') : 'No results found. Start a search above.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
