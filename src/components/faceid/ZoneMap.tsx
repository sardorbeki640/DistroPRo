import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

/**
 * Map for a work place: click or drag the pin to set the spot, the circle shows the radius. Leaflet and OpenStreetMap
 * tiles are loaded from the internet on first use (free, no key); address search uses OpenStreetMap's Nominatim.
 */
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist';
let loading: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = `${LEAFLET}/leaflet.css`;
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = `${LEAFLET}/leaflet.js`;
      js.onload = () => resolve((window as any).L);
      js.onerror = () => { loading = null; reject(new Error('Xarita yuklanmadi (internetni tekshiring).')); };
      document.head.appendChild(js);
    });
  }
  return loading;
}

const TASHKENT = { lat: 41.3111, lng: 69.2797 };

export const ZoneMap: React.FC<{
  lat: number; lng: number; radius: number; editable: boolean;
  onChange: (p: { lat: number; lng: number; address?: string }) => void;
}> = ({ lat, lng, radius, editable, onChange }) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pin = useRef<any>(null);
  const circle = useRef<any>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const has = !!(lat || lng);

  useEffect(() => {
    let dead = false;
    loadLeaflet().then(L => {
      if (dead || !box.current || map.current) return;
      const start = has ? { lat, lng } : TASHKENT;
      const m = L.map(box.current, { zoomControl: true }).setView([start.lat, start.lng], has ? 16 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
      const p = L.marker([start.lat, start.lng], { draggable: editable }).addTo(m);
      const c = L.circle([start.lat, start.lng], { radius: radius || 100, color: '#059669', fillOpacity: 0.12, weight: 2 }).addTo(m);
      const set = (ll: any) => { p.setLatLng(ll); c.setLatLng(ll); change.current({ lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) }); };
      if (editable) {
        m.on('click', (e: any) => set(e.latlng));
        p.on('dragend', () => set(p.getLatLng()));
      }
      map.current = m; pin.current = p; circle.current = c;
      // The map is drawn inside a card that may still be sizing itself.
      setTimeout(() => m.invalidateSize(), 200);
    }).catch(e => setError(e.message));
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coordinates typed in the fields or picked elsewhere move the pin; the radius resizes the circle.
  useEffect(() => {
    if (!map.current || !has) return;
    const cur = pin.current.getLatLng();
    if (Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lng) > 1e-6) {
      pin.current.setLatLng([lat, lng]); circle.current.setLatLng([lat, lng]); map.current.panTo([lat, lng]);
    }
  }, [lat, lng, has]);
  useEffect(() => { circle.current?.setRadius(radius || 100); }, [radius]);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true); setError(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=uz,ru&countrycodes=uz&q=${encodeURIComponent(q.trim())}`);
      const list = (await r.json()) as any[];
      setFound(list.map(x => ({ name: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })));
      if (!list.length) setError('Manzil topilmadi — boshqacha yozing yoki xaritada bosib belgilang.');
    } catch { setError('Qidiruv ishlamadi (internet). Xaritada bosib belgilang.'); } finally { setSearching(false); }
  };
  const pick = (f: { name: string; lat: number; lng: number }) => {
    setFound([]);
    map.current?.setView([f.lat, f.lng], 17);
    pin.current?.setLatLng([f.lat, f.lng]); circle.current?.setLatLng([f.lat, f.lng]);
    onChange({ lat: Number(f.lat.toFixed(6)), lng: Number(f.lng.toFixed(6)), address: f.name.slice(0, 200) });
  };

  return (
    <div className="space-y-1.5">
      {editable && (
        <div className="relative">
          <div className="flex gap-1.5">
            <div className="relative flex-1"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-neutral-400" />
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} placeholder="Manzil bo‘yicha qidirish: Namangan, Chust bozori…" className="h-8 w-full rounded-lg border border-neutral-300 pl-7 pr-2 text-xs" />
            </div>
            <button type="button" onClick={search} disabled={searching} className="rounded-lg border border-neutral-300 px-2.5 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50">{searching ? '…' : 'Topish'}</button>
          </div>
          {!!found.length && (
            <div className="absolute z-[500] mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white text-xs shadow-lg">
              {found.map((f, i) => <button type="button" key={i} onClick={() => pick(f)} className="block w-full px-2.5 py-1.5 text-left hover:bg-emerald-50">{f.name}</button>)}
            </div>
          )}
        </div>
      )}
      {/* Leaflet needs a real height before it draws; set inline so it never depends on a stylesheet. */}
      <div ref={box} style={{ height: 256 }} className="w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100" />
      {editable && <p className="text-[10px] text-neutral-500">Xaritada bosing yoki belgini suring — yashil doira Face ID qilinadigan hudud.</p>}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
};
