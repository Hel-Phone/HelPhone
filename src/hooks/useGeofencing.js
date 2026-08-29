import { useEffect, useRef, useCallback, useState } from 'react';
import { distance } from '../pages/Help';

const GEOFENCE_RADIUS_METERS = 500;

/**
 * Hook that monitors nearby active requests and triggers alerts
 * when the user enters a 500m geofence boundary.
 *
 * @param {Array<{id: number, lat: number, lng: number, status: string}>} activeRequests
 * @param {[number, number]|null} userLocation
 * @param {boolean} enabled
 * @returns {{ triggered: Array, dismissAlert: (id: number) => void }}
 */
export function useGeofencing(activeRequests, userLocation, enabled = true) {
  const [triggered, setTriggered] = useState([]);
  const notifiedRef = useRef(new Set());
  const watchIdRef = useRef(null);

  const dismissAlert = useCallback((id) => {
    setTriggered((prev) => prev.filter((t) => t.id !== id));
    notifiedRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!enabled || !userLocation || !Number.isFinite(userLocation[0]) || !Number.isFinite(userLocation[1])) {
      return;
    }

    if (!activeRequests || activeRequests.length === 0) {
      setTriggered([]);
      notifiedRef.current.clear();
      return;
    }

    const checkGeofences = (lat, lng) => {
      const currentLocation = [lat, lng];

      for (const req of activeRequests) {
        if (!req || !Number.isFinite(req.lat) || !Number.isFinite(req.lng)) continue;
        if (req.status !== 'Pending' && req.status !== 'Enroute') continue;
        if (notifiedRef.current.has(req.id)) continue;

        const dist = distance(currentLocation, [req.lat, req.lng]);
        if (dist !== null && dist <= GEOFENCE_RADIUS_METERS / 1000) {
          notifiedRef.current.add(req.id);
          setTriggered((prev) => {
            if (prev.some((t) => t.id === req.id)) return prev;
            return [
              ...prev,
              {
                id: req.id,
                lat: req.lat,
                lng: req.lng,
                distance: Math.round(dist * 1000),
                emergency_type: req.emergency_type,
                triggeredAt: Date.now(),
              },
            ];
          });

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('HelPhone - Nearby Emergency', {
                body: `Active request ${Math.round(dist * 1000)}m away. Tap to view.`,
                icon: '/assets/chars/looking-ahead.png',
                tag: `geofence-${req.id}`,
                renotify: false,
              });
            } catch (_) {}
          }
        }
      }

      notifiedRef.current.forEach((id) => {
        const req = activeRequests.find((r) => r.id === id);
        if (!req) return;
        const dist = distance(currentLocation, [req.lat, req.lng]);
        if (dist === null || dist > GEOFENCE_RADIUS_METERS / 1000 + 0.1) {
          notifiedRef.current.delete(id);
        }
      });
    };

    checkGeofences(userLocation[0], userLocation[1]);

    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => checkGeofences(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    }

    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [activeRequests, userLocation, enabled]);

  return { triggered, dismissAlert };
}
