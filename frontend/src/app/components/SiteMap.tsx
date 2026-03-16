import { useEffect, useRef, useState, useCallback } from 'react';
import React from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { SiteLocation } from '../contexts/OrganizationContext';

interface SiteMapProps {
  sites: SiteLocation[];
  onSiteClick?: (site: SiteLocation) => void;
  onSiteSelect?: (siteId: string) => void;
  onViewInSites?: (site: SiteLocation) => void;
  selectedSiteId?: string | null;
  flyToRef?: React.MutableRefObject<((lng: number, lat: number) => void) | undefined>;
}

export function SiteMap({ sites, onSiteClick, onSiteSelect, onViewInSites, selectedSiteId, flyToRef }: SiteMapProps) {
  const onViewInSitesRef = useRef(onViewInSites);
  onViewInSitesRef.current = onViewInSites;
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const initialFitDone = useRef(false);
  const onSiteClickRef = useRef(onSiteClick);
  onSiteClickRef.current = onSiteClick;
  const onSiteSelectRef = useRef(onSiteSelect);
  onSiteSelectRef.current = onSiteSelect;

  useEffect(() => {
    if (!mapContainer.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [
          {
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [101.6869, 3.1390],
      zoom: 9,
      attributionControl: true,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    m.on('load', () => {
      setMapLoaded(true);
    });

    map.current = m;

    // Expose flyTo for parent components
    if (flyToRef) {
      flyToRef.current = (lng: number, lat: number) => {
        m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 14), duration: 800 });
      };
    }

    return () => {
      if (flyToRef) flyToRef.current = undefined;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      m.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable serialized key for sites to avoid unnecessary re-renders
  const sitesKey = sites.map(s => `${s.id}:${s.lat}:${s.lng}`).join(',');
  const selectedKey = selectedSiteId ?? '';

  // Add/update markers when sites or selection change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    if (sites.length === 0) return;

    sites.forEach((site) => {
      const isSelected = selectedSiteId === site.id;
      const el = document.createElement('div');
      el.className = 'site-marker';

      // Determine color based on health
      const onlinePercent = site.cameras > 0 ? (site.camerasOnline / site.cameras) * 100 : 0;
      let color = '#10b981'; // green
      let pulseColor = 'rgba(16, 185, 129, 0.4)';
      if (onlinePercent === 0) {
        color = '#ef4444'; // red
        pulseColor = 'rgba(239, 68, 68, 0.4)';
      } else if (onlinePercent < 80) {
        color = '#f59e0b'; // amber
        pulseColor = 'rgba(245, 158, 11, 0.4)';
      }

      const ringStyle = isSelected
        ? `position:absolute;top:50%;left:50%;width:26px;height:26px;border-radius:50%;border:2px solid ${color};transform:translate(-50%,-50%);z-index:2;box-sizing:border-box;`
        : '';
      const dotSize = isSelected ? '18px' : '14px';

      el.innerHTML = `
        <div style="position:relative;cursor:pointer;width:${dotSize};height:${dotSize};">
          <div style="position:absolute;top:50%;left:50%;width:32px;height:32px;border-radius:50%;background:${pulseColor};transform:translate(-50%,-50%) scale(1);opacity:0.6;animation:site-pulse 3s cubic-bezier(0.4,0,0.6,1) infinite;"></div>
          ${isSelected ? `<div style="${ringStyle}"></div>` : ''}
          <div style="position:relative;width:${dotSize};height:${dotSize};border-radius:50%;background:${color};border:2px solid #0f1115;box-shadow:0 0 8px ${pulseColor};z-index:1;"></div>
        </div>
      `;

      // Popup content
      const occupancyColor = site.occupancyPercent > 85 ? '#ef4444' : site.occupancyPercent > 60 ? '#f59e0b' : '#10b981';
      const popupHTML = `
        <div style="background:#161a1f;border:1px solid #2a2f36;border-radius:8px;padding:12px;min-width:210px;color:#e6edf3;font-family:system-ui;">
          <div style="font-size:13px;font-weight:500;margin-bottom:2px;">${site.name}</div>
          ${site.city ? `<div style="font-size:11px;color:#34d399;margin-bottom:4px;">${site.city}</div>` : ''}
          <div style="font-size:11px;color:#9da7b3;margin-bottom:8px;">${site.address}</div>
          <div style="display:flex;gap:12px;font-size:11px;margin-bottom:6px;">
            <div><span style="color:#9da7b3;">Cameras:</span><span style="color:#e6edf3;margin-left:4px;">${site.camerasOnline}/${site.cameras}</span></div>
            <div><span style="color:#9da7b3;">Occupancy:</span><span style="color:${occupancyColor};margin-left:4px;">${site.occupancyPercent}%</span></div>
          </div>
          <div style="background:#1e2228;border-radius:4px;height:4px;overflow:hidden;margin-bottom:10px;">
            <div style="height:100%;width:${site.occupancyPercent}%;background:${occupancyColor};border-radius:4px;"></div>
          </div>
          <button data-view-site="${site.id}" style="width:100%;padding:5px 8px;background:#1c2128;border:1px solid #2a2f36;border-radius:6px;color:#e6edf3;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9da7b3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View in Sites
          </button>
        </div>
      `;

      const popup = new maplibregl.Popup({
        offset: 12,
        closeButton: false,
        closeOnClick: true,
        className: 'site-popup',
      }).setHTML(popupHTML);

      popup.on('open', () => {
        const btn = document.querySelector(`[data-view-site="${site.id}"]`);
        btn?.addEventListener('click', (e) => {
          e.stopPropagation();
          onViewInSitesRef.current?.(site);
          popup.remove();
        });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([site.lng, site.lat])
        .setPopup(popup)
        .addTo(map.current!);

      el.addEventListener('click', () => {
        onSiteClickRef.current?.(site);
        onSiteSelectRef.current?.(site.id);
      });

      markersRef.current.push(marker);
    });

    // Only fit bounds on first load — don't reset user's pan/zoom
    if (!initialFitDone.current) {
      initialFitDone.current = true;
      if (sites.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        sites.forEach(site => bounds.extend([site.lng, site.lat]));
        map.current.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      } else if (sites.length === 1) {
        map.current.setCenter([sites[0].lng, sites[0].lat]);
        map.current.setZoom(13);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesKey, selectedKey, mapLoaded]);

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />
      {/* Legend overlay */}
      <div className="absolute top-3 left-3 bg-[#161a1f]/90 backdrop-blur-sm border border-[#2a2f36] rounded-lg px-3 py-2">
        <div className="text-[11px] text-white mb-1.5">Site Locations</div>
        <div className="text-[10px] text-gray-500">{sites.length} sites on map</div>
      </div>
      <style>{`
        @keyframes site-pulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
          50% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
        .maplibregl-popup-content {
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
          border-radius: 8px !important;
        }
        .maplibregl-popup-tip {
          border-top-color: #2a2f36 !important;
        }
        .maplibregl-ctrl-attrib {
          background: rgba(15, 17, 21, 0.8) !important;
          color: #9da7b3 !important;
          font-size: 10px !important;
        }
        .maplibregl-ctrl-attrib a {
          color: #58a6ff !important;
        }
        .maplibregl-ctrl-group {
          background: #161a1f !important;
          border: 1px solid #2a2f36 !important;
          border-radius: 6px !important;
        }
        .maplibregl-ctrl-group button {
          border-color: #2a2f36 !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid #2a2f36 !important;
        }
        .maplibregl-ctrl-group button span {
          filter: invert(1) !important;
        }
      `}</style>
    </div>
  );
}
