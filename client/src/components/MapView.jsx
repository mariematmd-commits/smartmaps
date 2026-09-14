import { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 }; // geographic center of US

// Shows patients as pins. With `groups` it colors patients by planned day; with
// `route` it shows the optimized route (start marker, numbered stops, path).
// `apiKey` comes from Settings at runtime.
export default function MapView({ patients, selectedId, route, groups, apiKey, onSelect }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const overlays = useRef([]); // markers + polylines to clear on each rebuild
  const infoWindow = useRef(null);
  const [status, setStatus] = useState('loading');

  // Load the map + geometry library once a key is available. Guard on the map
  // object (not a "started" flag) so React StrictMode's double-invoke still
  // ends up creating the map on its second, non-cancelled run.
  useEffect(() => {
    if (!apiKey) {
      setStatus('no-key');
      return;
    }
    if (mapObj.current) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    let cancelled = false;
    const loader = new Loader({ apiKey, version: 'weekly' });
    Promise.all([loader.importLibrary('maps'), loader.importLibrary('geometry')])
      .then(([{ Map, InfoWindow }]) => {
        if (cancelled || !mapRef.current || mapObj.current) return;
        mapObj.current = new Map(mapRef.current, {
          center: DEFAULT_CENTER,
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
        });
        infoWindow.current = new InfoWindow();
        setStatus('ready');
        // Nudge Google Maps to re-measure its now-laid-out container so tiles
        // load immediately instead of showing a gray box until first interaction.
        setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
      })
      .catch((err) => {
        console.error('Google Maps failed to load:', err);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  function clearOverlays() {
    for (const o of overlays.current) o.setMap(null);
    overlays.current = [];
  }

  // Rebuild overlays whenever patients / route / selection change.
  useEffect(() => {
    const map = mapObj.current;
    if (!map || status !== 'ready') return;
    clearOverlays();
    const bounds = new google.maps.LatLngBounds();

    // Plan mode: color patients by their planned day.
    if (groups) {
      let any = false;
      groups.forEach((g) => {
        g.patients.forEach((p) => {
          if (p.lat == null || p.lng == null) return;
          any = true;
          const pos = { lat: p.lat, lng: p.lng };
          bounds.extend(pos);
          const marker = new google.maps.Marker({
            map,
            position: pos,
            title: `${p.name} — ${g.label}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: g.color,
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
              scale: 8,
            },
          });
          marker.addListener('click', () => {
            infoWindow.current.setContent(`<strong>${p.name}</strong><br/>${g.label}`);
            infoWindow.current.open(map, marker);
            onSelect?.(p);
          });
          overlays.current.push(marker);
        });
      });
      if (any) map.fitBounds(bounds, 60);
      return;
    }

    if (route) {
      // Start marker — optional, since a day route only has one when a home
      // base is set and could be geocoded.
      let startPos = null;
      if (route.start?.lat != null) {
        startPos = { lat: route.start.lat, lng: route.start.lng };
        bounds.extend(startPos);
        overlays.current.push(
          new google.maps.Marker({
            map,
            position: startPos,
            label: { text: 'S', color: '#fff', fontWeight: 'bold' },
            title: `Start — ${route.start.address}`,
            zIndex: 1000,
          })
        );
      }

      // Numbered stops in visit order.
      route.orderedStops.forEach((s, i) => {
        const pos = { lat: s.lat, lng: s.lng };
        bounds.extend(pos);
        const marker = new google.maps.Marker({
          map,
          position: pos,
          label: { text: String(i + 1), color: '#fff', fontWeight: 'bold' },
          title: `${i + 1}. ${s.name}`,
        });
        marker.addListener('click', () => {
          infoWindow.current.setContent(`<strong>${i + 1}. ${s.name}</strong>`);
          infoWindow.current.open(map, marker);
          onSelect?.(s);
        });
        overlays.current.push(marker);
      });

      // The route path. With real road geometry (Routes API) draw it solid;
      // otherwise connect the stops in visit order with a dashed line, which
      // shows the shape of the day without pretending to be the actual roads.
      if (route.polyline && google.maps.geometry) {
        const path = google.maps.geometry.encoding.decodePath(route.polyline);
        overlays.current.push(
          new google.maps.Polyline({
            map,
            path,
            strokeColor: '#2563eb',
            strokeOpacity: 0.85,
            strokeWeight: 5,
          })
        );
      } else if (route.orderedStops.length) {
        const path = [
          ...(startPos ? [startPos] : []),
          ...route.orderedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
          ...(startPos && route.returnToStart ? [startPos] : []),
        ];
        overlays.current.push(
          new google.maps.Polyline({
            map,
            path,
            strokeOpacity: 0, // the dashes come from the icon below
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeWeight: 3, scale: 3 },
                offset: '0',
                repeat: '14px',
              },
            ],
            strokeColor: '#2563eb',
          })
        );
      }
      map.fitBounds(bounds, 60);
      return;
    }

    // No route: plain patient pins.
    const located = patients.filter((p) => p.lat != null && p.lng != null);
    for (const p of located) {
      const pos = { lat: p.lat, lng: p.lng };
      bounds.extend(pos);
      const marker = new google.maps.Marker({ map, position: pos, title: p.name });
      marker.addListener('click', () => {
        infoWindow.current.setContent(`<strong>${p.name}</strong><br/>${p.address || ''}`);
        infoWindow.current.open(map, marker);
        onSelect?.(p);
      });
      if (p.id === selectedId) marker.setAnimation(google.maps.Animation.BOUNCE);
      overlays.current.push(marker);
    }

    if (located.length === 1) {
      map.setCenter({ lat: located[0].lat, lng: located[0].lng });
      map.setZoom(12);
    } else if (located.length > 1) {
      map.fitBounds(bounds, 60);
    }
  }, [patients, selectedId, route, groups, status, onSelect]);

  if (status === 'no-key') {
    return (
      <div className="card map-placeholder">
        <h2>Map</h2>
        <p>
          Add your Google Maps key in <strong>Settings</strong> (on the Patients tab) to see
          patients on a map and plan routes.
        </p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="card map-placeholder">
        <h2>Map</h2>
        <p className="error">
          The map failed to load. Check that your Google Maps key is valid and the Maps
          JavaScript API is enabled.
        </p>
      </div>
    );
  }

  return <div ref={mapRef} className="map" />;
}
