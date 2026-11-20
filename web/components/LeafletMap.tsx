'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'bus' | 'stop' | 'stop-done' | 'school' | 'pin';
  text?: string;
}

const ICON_STYLE: Record<MapPoint['kind'], string> = {
  bus: 'background:#f2a900;color:#3d2b00;border:2px solid #3d2b00;width:30px;height:30px;font-size:16px',
  stop: 'background:#12181f;color:#fff;border:2px solid #fff;width:24px;height:24px;font-size:11px',
  'stop-done': 'background:#1a7f37;color:#fff;border:2px solid #fff;width:24px;height:24px;font-size:11px',
  school: 'background:#1f6feb;color:#fff;border:2px solid #fff;width:28px;height:28px;font-size:14px',
  pin: 'background:#c62828;color:#fff;border:2px solid #fff;width:22px;height:22px;font-size:11px',
};

function icon(p: MapPoint) {
  const size = p.kind === 'bus' ? 30 : p.kind === 'school' ? 28 : 24;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="${ICON_STYLE[p.kind]};border-radius:50%;display:grid;place-items:center;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.35)">${
      p.kind === 'bus' ? '🚌' : p.kind === 'school' ? '🏫' : p.text ?? ''
    }</div>`,
  });
}

function FitTo({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    // Refit only when the set of things on the map changes, not on every bus move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

export default function LeafletMap({
  points, line, onPick, tall, fitKey,
}: { points: MapPoint[]; line?: [number, number][]; onPick?: (lat: number, lng: number) => void; tall?: boolean; fitKey?: string }) {
  const all: [number, number][] = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...(line ?? [])];
  const center: [number, number] = all[0] ?? [20.5937, 78.9629];
  return (
    <div className={`map${tall ? ' tall' : ''}`}>
      <MapContainer center={center} zoom={all.length ? 13 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {line && line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#1f6feb', weight: 4, opacity: 0.6 }} />}
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={icon(p)}>
            <Popup>{p.label}</Popup>
          </Marker>
        ))}
        <FitTo points={all} fitKey={fitKey ?? points.filter((p) => p.kind !== 'bus').map((p) => p.id).join(',')} />
        {onPick && <ClickToPick onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
