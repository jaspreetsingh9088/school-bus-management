'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { LayerGroup, LayersControl, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'bus' | 'stop' | 'stop-done' | 'school' | 'pin';
  text?: string;
}

const ICON_STYLE: Record<MapPoint['kind'], string> = {
  bus: 'background:#f2a900;color:#3d2b00;border:3px solid #fff;width:36px;height:36px;font-size:19px',
  stop: 'background:#12181f;color:#fff;border:2px solid #fff;width:26px;height:26px;font-size:12px',
  'stop-done': 'background:#1a7f37;color:#fff;border:2px solid #fff;width:26px;height:26px;font-size:12px',
  school: 'background:#1f6feb;color:#fff;border:3px solid #fff;width:32px;height:32px;font-size:16px',
  pin: 'background:#c62828;color:#fff;border:2px solid #fff;width:24px;height:24px;font-size:11px',
};

function icon(p: MapPoint) {
  const size = p.kind === 'bus' ? 36 : p.kind === 'school' ? 32 : p.kind === 'pin' ? 24 : 26;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="${p.kind === 'bus' ? 'bus-marker' : ''}" style="${ICON_STYLE[p.kind]};border-radius:50%;display:grid;place-items:center;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.45)">${
      p.kind === 'bus' ? '🚌' : p.kind === 'school' ? '🏫' : p.text ?? ''
    }</div>`,
  });
}

function FitTo({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36] });
    // Refit only when what is on the map changes, not on every bus move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

/**
 * Map with Satellite (default) and Street views. `path` is the road the bus follows;
 * when it's missing, `line` draws straight lines between stops.
 */
export default function LeafletMap({
  points, line, path, trail, onPick, tall, fitKey,
}: {
  points: MapPoint[];
  line?: [number, number][];
  path?: [number, number][] | null;
  trail?: [number, number][];
  onPick?: (lat: number, lng: number) => void;
  tall?: boolean;
  fitKey?: string;
}) {
  const road = path && path.length > 1 ? path : null;
  const all: [number, number][] = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...(road ?? line ?? [])];
  const center: [number, number] = all[0] ?? [30.901, 75.857];
  return (
    <div className={`map${tall ? ' tall' : ''}`}>
      <MapContainer center={center} zoom={all.length ? 14 : 12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <LayerGroup>
              <TileLayer
                attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}" maxZoom={19} opacity={0.7} />
            </LayerGroup>
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {road && (
          <>
            <Polyline positions={road} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
            <Polyline positions={road} pathOptions={{ color: '#1f6feb', weight: 5, opacity: 1 }} />
          </>
        )}
        {!road && line && line.length > 1 && (
          <Polyline positions={line} pathOptions={{ color: '#1f6feb', weight: 4, opacity: 0.8, dashArray: '8 8' }} />
        )}
        {trail && trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#f2a900', weight: 5, opacity: 0.95 }} />}
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={icon(p)} zIndexOffset={p.kind === 'bus' ? 1000 : 0}>
            <Popup>{p.label}</Popup>
          </Marker>
        ))}
        <FitTo points={all} fitKey={fitKey ?? points.filter((p) => p.kind !== 'bus').map((p) => p.id).join(',') + (road ? ':road' : '')} />
        {onPick && <ClickToPick onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
