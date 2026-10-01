# Changelog

All notable changes to the `tanstack-aspnet-data` monorepo (core + React +
Vue) are documented here. Versions are pre-releases (`0.1.0-next.x`) until
the first stable `0.1.0`.

## [Unreleased]

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
