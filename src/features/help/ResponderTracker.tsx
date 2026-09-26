import { useEffect, useState } from 'react'
import { dijkstra, loadRoadNetwork } from '../../lib/routing.ts'
import type { RouteResult, SpatialGraph } from '../../types/index.ts'

export function useResponderRoute(source?: number, destination?: number) {
  const [graph, setGraph] = useState<SpatialGraph | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    let active = true
    loadRoadNetwork().then((value) => active && setGraph(value)).catch((reason) => active && setError(reason as Error))
    return () => { active = false }
  }, [])
  useEffect(() => { if (graph && source !== undefined && destination !== undefined) setRoute(dijkstra(graph, source, destination)) }, [graph, source, destination])
  return { route, loading: !graph && !error, error }
}

export default function ResponderTracker({ source, destination }: { source: number; destination: number }) {
  const { route, loading, error } = useResponderRoute(source, destination)
  if (error) return <span role="alert">Route unavailable</span>
  if (loading) return <span>Calculating route…</span>
  return <span>{route ? `${route.distanceKm.toFixed(1)} km away` : 'No road route found'}</span>
}
