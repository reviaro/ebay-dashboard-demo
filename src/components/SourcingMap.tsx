'use client';

import { MapContainer, TileLayer, Marker, Popup, SVGOverlay } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { YARD_LOCATIONS, MAP_CENTER } from '@/lib/constants';
import { demoYards } from '@/lib/demo/sourcing';
import { useDemoMode } from '@/components/DemoProvider';
import L from 'leaflet';

// Production assets are used only by production markers. Never change Leaflet's
// global default icon: a demo marker must not fall back to a remote image.
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
const SampleIcon = L.divIcon({
  className: 'demo-sourcing-marker',
  html: '<span style="display:block;width:22px;height:22px;border-radius:50%;background:#38bdf8;border:3px solid #0f172a;box-shadow:0 0 0 8px #38bdf833"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -15],
});
const sampleBounds: [[number, number], [number, number]] = [[0, 0], [370, 660]];
// Schematic positions deliberately do not use geographic coordinates.
const samplePoints: [number, number][] = [[258, 170], [131, 336], [268, 500]];

export default function SourcingMap() {
  const demo = useDemoMode();
  return (
    <div>
      {demo && <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">Offline schematic of fictional yards. This demo retains the map controls with an illustrated background; no live tiles, real locations, or routing are available.</p>}
      <div className="h-[400px] w-full rounded-lg overflow-hidden border border-gray-200">
        <MapContainer
          key={demo ? 'sample-map' : 'live-map'}
          center={demo ? undefined : MAP_CENTER}
          zoom={demo ? undefined : 10}
          {...(demo ? { crs: L.CRS.Simple, bounds: sampleBounds, maxBounds: sampleBounds, minZoom: -2, maxZoom: 3, attributionControl: false } : {})}
          scrollWheelZoom={false}
          className="h-full w-full"
          style={demo ? { background: '#0b1525' } : undefined}
        >
          {demo ? <>
            <SVGOverlay bounds={sampleBounds} attributes={{ viewBox: '0 0 660 370', role: 'img', 'aria-label': 'Offline schematic of fictional salvage yards' }}>
              <defs><pattern id="sourcing-map-grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0H0V35" fill="none" stroke="#203047" strokeWidth="0.7" /></pattern></defs>
              <rect width="660" height="370" fill="#0b1525" />
              <rect width="660" height="370" fill="url(#sourcing-map-grid)" />
              <path d="M-20 300C120 240 210 360 290 240S440 180 490 90S590 140 700 30" stroke="#143948" strokeWidth="37" fill="none" />
              <path d="M-10 115L180 115L305 240L570 240L680 350M210 -20V130L430 350M70 390L210 230L600 55" fill="none" stroke="#3b4c63" strokeWidth="6" />
              <path d="M-10 115L180 115L305 240L570 240L680 350M210 -20V130L430 350M70 390L210 230L600 55" fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="4 6" />
              <text x="18" y="345" fill="#94a3b8" fontSize="12">FICTIONAL REGION · OFFLINE · NOT TO SCALE</text>
            </SVGOverlay>
            {demoYards.map((yard, index) => <Marker key={yard.name} position={samplePoints[index]} icon={SampleIcon}>
              <Popup><div className="text-sm"><p className="font-bold">{yard.name}</p><p>Fictional sample supplier. No live inventory or directions.</p></div></Popup>
            </Marker>)}
          </> : <>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {YARD_LOCATIONS.map((yard) => (
              <Marker key={yard.name} position={yard.coords} icon={DefaultIcon}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold">{yard.name}</p>
                    <a href={yard.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Visit Inventory Page</a>
                  </div>
                </Popup>
              </Marker>
            ))}
          </>}
        </MapContainer>
      </div>
    </div>
  );
}
