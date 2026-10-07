# Changelog

All notable changes to the `tanstack-aspnet-data` monorepo (core + React +
Vue) are documented here. `0.1.0` is the first stable release; earlier
`0.1.0-next.x` versions were pre-releases.

## [0.1.0] - 2026-10-07

First stable release. Includes everything below since `0.1.0-next.4`, plus:

### Fixed
- `useCacheInstance` tolerates `null` cache values instead of throwing.
- Request identity is fully deterministic (codepoint header sort, uppercased
  method) and the adapter cache key lowercases header names to match.
- Table state no longer aliases caller-owned `initialSorting` /
  `initialColumnFilters` arrays.
- Pre-migrations SQLite databases are stamped onto the migrations baseline
  automatically; no data loss, no manual deletion.

### Added
- Independent cancellation for deduplicated requests and explicit
  `cacheMode: 'reload'` support.
- Deterministic request identities with header fingerprints and optional
  `queryKeyScope` partitioning for React Query and Vue Query.
- `mergeTableStateSearchParams`, plus `delete`/`clear` on the memory cache.
- Configurable ASP.NET query limits, selector validation, EF migrations,
  database-backed health checks and server tests.
- ESLint, coverage thresholds, Node 18/20/22 library CI and npm entry-point
  smoke tests.

### Fixed
- `refetch()` now reaches the network even when adapter caching is enabled.
- Cached callers no longer share the first caller's abort signal.
- TanStack Query keys now distinguish method, effective query, headers and
  explicit user/tenant scope.
- URL synchronization preserves unrelated parameters and fully restores empty
  states during back/forward navigation.
- Non-finite array values, unsafe pagination and impossible ISO calendar dates
  are rejected or handled consistently.
- Vue manual fetching now shares the same state lifecycle as Vue Query and
  aborts active work when disabled.
- Invalid server selectors return a generic 400 instead of leaking execution
  details; database initialization no longer leaves an unhealthy app running.

### Migration
- The SQLite example now uses EF Core migrations. Pre-migrations databases
  are upgraded automatically at startup (`LegacyDatabaseStamper` records the
  baseline as applied); existing rows are preserved, no deletion needed.

## [0.1.0-next.4]

### Added
- `@tanstack-aspnet-data/react`: new public `useAspNetDataTableState()`
  headless state hook (Vue parity). `useAspNetDataTable()` and
  `useAspNetDataQuery()` are now thin fetch layers over it — no behavior
  change.

### Documentation
- React README: new "Headless state without fetching" section.

## [0.1.0-next.3] - 2026-09-28

### Documentation
- Corrected TanStack Query entry-point notes (hooks live under `/query`,
  the package root never requires the optional peer).
- Added Requirements matrix, non-affiliation disclaimer, per-package
  TanStack Query sections, live demo links and npm badges.

## [0.1.0-next.2] - 2026-09-26

### Fixed
- **Pre-release breaking change:** `useAspNetDataQuery` is no longer
  re-exported from the package root. Import from
  `@tanstack-aspnet-data/react/query` (or `/vue/query`). Importing the root
  no longer requires the optional `@tanstack/react-query` /
  `@tanstack/vue-query` peer (`ERR_MODULE_NOT_FOUND` fixed).

## [0.1.0-next.1] - 2026-09-26

### Added
- Core `AspNetDataError` now carries the server response body (truncated to
  2000 characters) in addition to the HTTP status.

### Fixed
- Vue: feed the server `pageCount` into `useVueTable` (Next stayed disabled
  on the last page).
- Packaging: Query peers declared optional; clean-checkout demo builds
  (library `dist` built before demos).

## [0.1.0-next.0] - 2026-09-15

Initial pre-release: framework-agnostic core (query builder, transport,
response normalization, memory cache, URL state), React + Vue hooks with
TanStack Query variants, ASP.NET Core + EF Core example API and live demos.
