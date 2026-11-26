'use client';

import { useState } from 'react';
import { useDemoMode } from '@/components/DemoProvider';

interface BrandingProps {
  partName: string;
  brand?: string;
  mpn: string;
  supersededMpns?: string[];
  fitment: Array<{ year: string; model: string; engine?: string; trim?: string }>;
  condition: string;
  isInternationalReady: boolean;
  countryOfOrigin?: string;
  weight?: string;
  dimensions?: string;
}

export default function BrandingTemplate({ 
  partName,
  brand,
  mpn, 
  supersededMpns, 
  fitment, 
  condition,
  isInternationalReady,
  countryOfOrigin,
  weight,
  dimensions
}: BrandingProps) {
  const demo = useDemoMode();
  const [copied, setCopied] = useState(false);

  const generateListingTemplate = () => {
    return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; border: 1px solid #ddd; padding: 20px;">
  <!-- Specialist Badge -->
  <div style="background-color: #003057; color: white; padding: 15px; text-align: center; border-radius: 4px; margin-bottom: 20px;">
    <h2 style="margin: 0;">${demo ? `${brand || 'Auto Parts'} Fictional Preview` : 'Tested OEM Volvo Specialist'}</h2>
    <p style="margin: 5px 0 0 0;">${demo ? 'Synthetic catalog example. Not a real listing.' : 'Specializing in 2003-2016 Models'}</p>
  </div>

  <h1 style="color: #333;">${partName}</h1>
  <p style="font-size: 1.1em;"><strong>Condition:</strong> ${condition}</p>

  <div style="margin-top: 20px;">
    <h3 style="border-bottom: 2px solid #003057; padding-bottom: 5px;">Product Specifications</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px; border: 1px solid #eee; background-color: #f9f9f9; width: 30%;"><strong>Part Number (MPN)</strong></td>
        <td style="padding: 8px; border: 1px solid #eee;">${mpn}</td>
      </tr>
      ${supersededMpns && supersededMpns.length > 0 ? `
      <tr>
        <td style="padding: 8px; border: 1px solid #eee; background-color: #f9f9f9;"><strong>Superseded Part #s</strong></td>
        <td style="padding: 8px; border: 1px solid #eee;">${supersededMpns.join(', ')}</td>
      </tr>` : ''}
      ${isInternationalReady ? `
      <tr>
        <td style="padding: 8px; border: 1px solid #eee; background-color: #f9f9f9;"><strong>Country of Origin</strong></td>
        <td style="padding: 8px; border: 1px solid #eee;">${countryOfOrigin || 'Sweden/OEM'}</td>
      </tr>` : ''}
    </table>
  </div>

  <div style="margin-top: 20px;">
    <h3 style="border-bottom: 2px solid #003057; padding-bottom: 5px;">${demo ? 'Fictional Vehicle Example' : 'Fitment Information'}</h3>
    <table style="width: 100%; border-collapse: collapse; text-align: left;">
      <thead>
        <tr style="background-color: #f2f2f2;">
          <th style="padding: 8px; border: 1px solid #eee;">Year</th>
          <th style="padding: 8px; border: 1px solid #eee;">Model</th>
          <th style="padding: 8px; border: 1px solid #eee;">Engine/Trim</th>
        </tr>
      </thead>
      <tbody>
        ${fitment.map(f => `
        <tr>
          <td style="padding: 8px; border: 1px solid #eee;">${f.year}</td>
          <td style="padding: 8px; border: 1px solid #eee;">${f.model}</td>
          <td style="padding: 8px; border: 1px solid #eee;">${[f.engine, f.trim].filter(Boolean).join(' ')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p style="font-size: 0.9em; color: #666; margin-top: 10px;">${demo ? '* Compatibility and part numbers are fictional placeholders, not verified fitment information.' : '* Please verify fitment with your VIN before purchase.'}</p>
  </div>

  <div style="margin-top: 20px; padding: 15px; background-color: #f8f8f8; border-left: 4px solid #003057;">
    <h4 style="margin-top: 0;">${demo ? 'Fictional Preview Notes' : 'Why Buy From Us?'}</h4>
    <ul style="margin-bottom: 0;">
      <li><strong>${demo ? 'Sample Data:' : 'Tested & Verified:'}</strong> ${demo ? 'All details are fictional examples; no testing or condition guarantee is made.' : 'All electronic and mechanical components are bench tested.'}</li>
      <li><strong>${demo ? 'Compatibility:' : 'Expert Support:'}</strong> ${demo ? 'Vehicle details demonstrate the layout only and do not confirm fitment.' : 'We are Volvo specialists and can help with technical questions.'}</li>
      <li><strong>Global Shipping:</strong> ${demo ? 'Sample metadata only; no shipping service or eligibility is offered.' : isInternationalReady ? 'Fully eligible for eBay International Shipping with accurate weight/dims.' : 'Fast domestic shipping within 1 business day.'}</li>
    </ul>
  </div>
</div>
    `.trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateListingTemplate());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="bg-blue-900 text-white p-1 rounded text-xs uppercase font-bold">{demo ? 'Sample' : 'Specialist'}</span>
          Description Generator
        </h3>
        <button
          onClick={handleCopy}
          title={demo ? "Copy this fictional preview locally; nothing is published" : undefined}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${
            copied ? 'bg-green-600 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          {copied ? 'Copied HTML!' : 'Copy HTML Template'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="p-4 border border-blue-100 bg-blue-50 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>{demo ? 'Fictional preview:' : 'Preview:'}</strong> {demo ? 'Synthetic catalog details demonstrate the original listing layout. Copying does not publish a listing.' : 'This generator creates a high-conversion eBay description with specialist branding.'}
            </p>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Branding Metadata</h4>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Grade: {condition}
              </span>
              {isInternationalReady && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {demo ? 'Sample metadata' : 'eIS Ready'}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {weight && `Weight: ${weight} | `} {dimensions && `Dims: ${dimensions}`}
            </div>
          </div>
        </div>

        <div className="border border-gray-100 rounded-md p-4 bg-gray-50 max-h-[200px] overflow-auto text-[10px] font-mono whitespace-pre-wrap">
          {generateListingTemplate()}
        </div>
      </div>
    </div>
  );
}
