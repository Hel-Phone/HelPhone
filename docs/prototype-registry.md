# Prototype registry

`prototype-registry.json` records modules under `src/lib/` and `server/db/`
that have no production source import. This is an inventory, not a claim that
these modules run in the shipped app. The first baseline classifies them as
`prototype-only`, except the standalone migration CLI entrypoint.

Run `node scripts/check-prototypes.mjs` before submitting a change. The CI
gate fails when a new unreferenced module is missing from the registry, a
prototype becomes imported without being marked `wired`, or a wired module
loses its import. To add a legitimate prototype, add its path with
`{"state":"prototype-only","note":"why it is retained"}`. If an HP-101–108
integration wires it into production, change its state to `wired` and cite
the integration in `note`. Mark an intentionally retired module `deprecated`
until it can be removed. CLI entrypoints can use `"entrypoint": true` with
`wired` because they are executed directly rather than imported.

The scan follows static imports in `src/` and `server/`; dynamic imports with
computed paths require a manual registry review. It does not treat tests or
documentation references as production wiring.
