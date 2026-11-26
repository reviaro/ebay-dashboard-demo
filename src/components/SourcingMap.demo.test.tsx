import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourcingMap from './SourcingMap';
import { demoYards } from '@/lib/demo/sourcing';
import { YARD_LOCATIONS } from '@/lib/constants';

const controls = vi.hoisted(() => ({ demo: true, maps: [] as Record<string, unknown>[], markers: [] as Record<string, unknown>[], tiles: [] as Record<string, unknown>[] }));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => controls.demo }));
vi.mock('leaflet', () => ({ default: {
  icon: (options: unknown) => ({ kind: 'image-icon', options }),
  divIcon: (options: unknown) => ({ kind: 'inline-icon', options }),
  CRS: { Simple: 'simple-schematic-crs' },
} }));
vi.mock('react-leaflet', () => ({
  MapContainer: (props: Record<string, unknown> & { children?: ReactNode }) => { controls.maps.push(props); return <div data-map-container="true">{props.children}</div>; },
  TileLayer: (props: Record<string, unknown>) => { controls.tiles.push(props); return <div data-tile-url={String(props.url)} />; },
  Marker: (props: Record<string, unknown> & { children?: ReactNode }) => { controls.markers.push(props); return <div data-marker="true">{props.children}</div>; },
  Popup: ({ children }: { children?: ReactNode }) => <div data-popup="true">{children}</div>,
  SVGOverlay: ({ attributes, children }: { attributes: Record<string, string>; children?: ReactNode }) => <svg {...attributes}>{children}</svg>,
}));
beforeEach(() => { controls.demo = true; controls.maps = []; controls.markers = []; controls.tiles = []; });

describe('SourcingMap offline adapter (component contract, not live Leaflet/browser QA)', () => {
  it('retains the 400px map pane, local interactive markers and schematic background in demo', () => {
    const html = renderToStaticMarkup(<SourcingMap />), dom = parse(html);
    expect(dom.querySelector('.h-\\[400px\\]')).not.toBeNull();
    expect(dom.querySelector('[data-map-container]')).not.toBeNull();
    expect(dom.querySelectorAll('[data-marker]')).toHaveLength(3);
    expect(dom.querySelector('svg')?.getAttribute('aria-label')).toContain('Offline schematic');
    expect(dom.textContent).toContain('no live tiles, real locations, or routing');
    for (const yard of demoYards) expect(dom.textContent).toContain(yard.name);
    expect(controls.maps[0]).toMatchObject({ crs: 'simple-schematic-crs', scrollWheelZoom: false, attributionControl: false, minZoom: -2, maxZoom: 3, bounds: [[0, 0], [370, 660]] });
    // MapContainer prioritizes center+zoom over bounds. Leave them undefined
    // in demo so its fitBounds path keeps every marker in the narrow pane.
    expect(controls.maps[0].center).toBeUndefined(); expect(controls.maps[0].zoom).toBeUndefined();
    // Zoom controls remain Leaflet's default, and each marker retains a Popup.
    expect(controls.maps[0].zoomControl).not.toBe(false);
    expect(dom.querySelectorAll('[data-popup]')).toHaveLength(3);
  });
  it('never mounts a tile provider, external image icon, real-yard URL, or geographic coordinate in demo', () => {
    const html = renderToStaticMarkup(<SourcingMap />), dom = parse(html);
    expect(controls.tiles).toHaveLength(0);
    expect(dom.querySelectorAll('a, img, image, iframe')).toHaveLength(0);
    expect(html).not.toMatch(/https?:\/\//);
    for (const marker of controls.markers) {
      expect(marker.icon).toMatchObject({ kind: 'inline-icon' });
      expect(JSON.stringify(marker.icon)).not.toMatch(/https?:|url\(|<img/);
      expect(demoYards.some(yard => JSON.stringify([yard.lat, yard.lng]) === JSON.stringify(marker.position))).toBe(false);
    }
    for (const yard of YARD_LOCATIONS) expect(html).not.toContain(yard.name);
  });
  it('retains original tile source, marker artwork, provider names and inventory links in normal mode', () => {
    controls.demo = false;
    const html = renderToStaticMarkup(<SourcingMap />), dom = parse(html);
    expect(controls.tiles).toHaveLength(1);
    expect(controls.tiles[0].url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(controls.maps[0]).toMatchObject({ zoom: 10, scrollWheelZoom: false });
    expect(controls.maps[0].crs).toBeUndefined();
    expect(dom.querySelectorAll('a')).toHaveLength(YARD_LOCATIONS.length);
    for (const [index, yard] of YARD_LOCATIONS.entries()) {
      expect(dom.textContent).toContain(yard.name); expect(html).toContain(yard.url);
      expect(controls.markers[index].position).toEqual(yard.coords);
      expect(controls.markers[index].icon).toMatchObject({ kind: 'image-icon' });
    }
    expect(html).not.toContain('Offline schematic');
  });
});
