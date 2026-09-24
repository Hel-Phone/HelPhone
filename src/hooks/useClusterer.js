import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Supercluster from 'supercluster';

/**
 * Hook that clusters map points using Supercluster.
 *
 * @param {Array<{id: number|string, lat: number, lng: number, [key: string]: any}>} points - Points to cluster
 * @param {number} zoom - Current map zoom level
 * @param {Array<number>} bounds - Map bounds as [west, south, east, north]
 * @param {object} options - Supercluster options
 * @returns {{ clusters: Array, supercluster: Supercluster|null }}
 */
export function useClusterer(points, zoom, bounds, options = {}) {
  const superclusterRef = useRef(null);
  const [clusters, setClusters] = useState([]);

  const defaultOptions = useMemo(
    () => ({
      radius: 60,
      maxZoom: 17,
      ...options,
    }),
    [JSON.stringify(options)],
  );

  useEffect(() => {
    if (!points || points.length === 0) {
      setClusters([]);
      return;
    }

    const features = points
      .filter(
        (p) =>
          p &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng),
      )
      .map((p) => ({
        type: 'Feature',
        properties: { ...p, pointId: p.id },
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat],
        },
      }));

    if (features.length === 0) {
      setClusters([]);
      return;
    }

    const sc = new Supercluster(defaultOptions);
    sc.load(features);
    superclusterRef.current = sc;

    const bbox = bounds && bounds.length === 4 ? bounds : undefined;
    const zoomInt = Math.floor(zoom);
    const result = sc.getClusters(bbox || [-180, -85, 180, 85], zoomInt);

    setClusters(result);
  }, [points, zoom, bounds, defaultOptions]);

  const getClusterExpansionZoom = useCallback(
    (clusterId) => {
      if (!superclusterRef.current) return 18;
      return superclusterRef.current.getClusterExpansionZoom(clusterId);
    },
    [],
  );

  return { clusters, supercluster: superclusterRef.current, getClusterExpansionZoom };
}
