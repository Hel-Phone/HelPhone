import type { Express } from 'express';
import { createDispatchRouter } from './dispatch.ts';
import { createEventsRouter } from './events.ts';
import { createSyncRouter } from './sync.ts';
import { createDocsRouter } from './docs.ts';
import { installGraphQLRoutes } from '../graphql/server.ts';
import type { DomainStore } from '../lib/domainStore.ts';
import {
  apiVersionMiddleware,
  graphqlCompatibilityMiddleware,
} from '../middleware/apiVersion.ts';

export interface DomainRoutesOptions {
  store?: DomainStore;
  graphqlPath?: string;
}

const installed = new WeakSet<object>();

/**
 * Mount the canonical domain surface exactly once per app.
 *
 * REST and GraphQL are installed from the same store instance; that is what
 * guarantees a write on either surface is visible to the other immediately.
 *
 * Versioned `/api/v1/*` and legacy unversioned `/api/*` (`v0`) run side-by-side
 * during the deprecation window (#947), while `/graphql` remains backward
 * compatible across versions.
 */
export function installDomainRoutes(app: Express, options: DomainRoutesOptions = {}): boolean {
  if (installed.has(app)) return false;
  installed.add(app);

  const dispatchRouter = createDispatchRouter({ store: options.store });
  const eventsRouter = createEventsRouter({ store: options.store });
  const syncRouter = createSyncRouter({ store: options.store });

  // Versioned v1 surface
  app.use('/api/v1/dispatch', apiVersionMiddleware('v1'), dispatchRouter);
  app.use('/api/v1/events', apiVersionMiddleware('v1'), eventsRouter);
  app.use('/api/v1/sync', apiVersionMiddleware('v1'), syncRouter);

  // Legacy unversioned (v0) surface with Deprecation + Sunset headers
  app.use('/api/dispatch', apiVersionMiddleware('v0'), dispatchRouter);
  app.use('/api/events', apiVersionMiddleware('v0'), eventsRouter);
  app.use('/api/sync', apiVersionMiddleware('v0'), syncRouter);

  app.use('/docs', createDocsRouter());

  const graphqlPath = options.graphqlPath ?? '/graphql';
  app.use(graphqlPath, graphqlCompatibilityMiddleware());
  installGraphQLRoutes(app, { store: options.store, path: graphqlPath });
  return true;
}
