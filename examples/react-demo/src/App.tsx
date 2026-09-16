import { useEffect, useState } from 'react'
import { createColumnHelper, flexRender } from '@tanstack/react-table'
import { useAspNetDataTable } from '@tanstack-aspnet-data/react'

interface Manufacturer {
  name: string
  ref: string
  address: string
  city: string
  country: string
}

interface Product {
  id: number
  name: string
  manufacturer: Manufacturer
  categories: string[]
  categoryNames: string
  price: number
  unitsInStock: number
  isActive: boolean
  createdAt: string // ISO
}

// VITE_API_URL is set on Vercel to the Railway API.
// Falls back to Railway prod so `vite build` works without env,
// and localhost remains usable via `.env.local` in dev.
const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://tanstack-aspnet-data-production.up.railway.app/api/products'

const CATEGORY_OPTIONS = ['Cardiology', 'Orthopedics', 'Neurology', 'Imaging', 'Surgery', 'Monitoring']
const COUNTRY_OPTIONS = ['USA', 'Germany', 'Netherlands']

const columnHelper = createColumnHelper<Product>()

// mapSelector demonstration: column id -> EF Core selector (dot notation for nested, collection)
const mapSelector = (id: string) => {
  const map: Record<string, string> = {
    manufacturerName: 'Manufacturer.Name',
    manufacturerRef: 'Manufacturer.Ref',
    manufacturerAddress: 'Manufacturer.Address',
    manufacturerCity: 'Manufacturer.City',
    manufacturerCountry: 'Manufacturer.Country',
    categories: 'CategoryNames', // denormalized string for collection filtering via contains
    name: 'Name',
    price: 'Price',
    unitsInStock: 'UnitsInStock',
    isActive: 'IsActive',
    createdAt: 'CreatedAt',
  }
  return map[id] ?? id
}

const columns = [
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor((row) => row.manufacturer.name, {
    id: 'manufacturerName',
    header: 'Manufacturer',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor((row) => row.manufacturer.ref, {
    id: 'manufacturerRef',
    header: 'Ref',
  }),
  columnHelper.accessor((row) => row.manufacturer.address, {
    id: 'manufacturerAddress',
    header: 'Address',
  }),
  columnHelper.accessor((row) => row.manufacturer.city, {
    id: 'manufacturerCity',
    header: 'City',
  }),
  columnHelper.accessor((row) => row.manufacturer.country, {
    id: 'manufacturerCountry',
    header: 'Country',
  }),
  columnHelper.accessor((row) => row.categories.join(', '), {
    id: 'categories',
    header: 'Categories',
    cell: (info) => info.row.original.categories.join(', '),
  }),
  columnHelper.accessor('price', {
    header: 'Price',
    cell: (info) => `$${info.getValue().toFixed(2)}`,
  }),
  columnHelper.accessor('unitsInStock', { header: 'Stock' }),
  columnHelper.accessor('isActive', {
    header: 'Active',
    cell: (info) => (info.getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor('createdAt', {
    header: 'Created',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
  }),
]

export default function App() {
  const [searchInput, setSearchInput] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [isActiveFilter, setIsActiveFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { table, totalCount, pageCount, isFetching, isError } = useAspNetDataTable<Product>({
    endpoint: API_URL,
    columns,
    mapSelector,
    globalFilterFields: [
      'Name',
      'Manufacturer.Name',
      'Manufacturer.Ref',
      'Manufacturer.Address',
      'Manufacturer.City',
      'Manufacturer.Country',
      'CategoryNames',
    ],
    // Categories is a many-to-many collection stored as comma-joined `CategoryNames`.
    // For multi-select we need OR of `contains`, not `=` (default inCondition).
    resolveColumnFilter: (filter) => {
      if (filter.id === 'categories') {
        const v = filter.value
        if (Array.isArray(v)) {
          // ["Cardiology","Imaging"] => [["CategoryNames","contains","Cardiology"],"or",["CategoryNames","contains","Imaging"]]
          const parts = v.filter((x) => x != null && x !== '').map((x) => ['CategoryNames', 'contains', x] as unknown)
          if (parts.length === 0) return undefined
          if (parts.length === 1) return parts[0]
          return parts.flatMap((p, i) => (i === 0 ? [p] : ['or', p]))
        }
        if (typeof v === 'string' && v) return ['CategoryNames', 'contains', v]
      }
      return undefined as unknown as any // fallback to default conventions
    },
    initialPagination: { pageIndex: 0, pageSize: 10 },
    syncUrl: true,
    globalFilterDebounceMs: 300,
  })

  // Hydratation seule au mount : restore toolbar controls from URL-synced table state
  useEffect(() => {
    const s = table.getState()
    if (s.globalFilter) setSearchInput(String(s.globalFilter))
    const priceF = s.columnFilters.find((f) => f.id === 'price')?.value as [any, any] | undefined
    if (priceF) {
      if (priceF[0] != null) setPriceMin(String(priceF[0]))
      if (priceF[1] != null) setPriceMax(String(priceF[1]))
    }
    const catF = s.columnFilters.find((f) => f.id === 'categories')?.value as unknown
    if (catF) {
      if (Array.isArray(catF)) setSelectedCategories(catF as string[])
      else if (typeof catF === 'string') setSelectedCategories([catF as string])
    }
    const activeF = s.columnFilters.find((f) => f.id === 'isActive')?.value
    if (activeF !== undefined) setIsActiveFilter(String(activeF))
    const dateF = s.columnFilters.find((f) => f.id === 'createdAt')?.value as [any, any] | undefined
    if (dateF) {
      if (dateF[0]) setDateFrom(String(dateF[0]).slice(0, 10))
      if (dateF[1]) setDateTo(String(dateF[1]).slice(0, 10))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global search debounced via hook
  useEffect(() => {
    table.setGlobalFilter(searchInput)
  }, [searchInput, table])

  // Price range -> two-element array becomes server-side between condition (half-open supported)
  // NaN guard: ignore non-finite numbers to avoid 500
  useEffect(() => {
    const parsePrice = (v: string) => {
      if (v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const min = parsePrice(priceMin)
    const max = parsePrice(priceMax)
    if (min !== null || max !== null) {
      table.getColumn('price')?.setFilterValue([min, max])
    } else {
      table.getColumn('price')?.setFilterValue(undefined)
    }
  }, [priceMin, priceMax, table])

  // Categories multi-select -> array becomes OR-group of equalities (inCondition)
  // e.g. ["Cardiology","Imaging"] => [["Categories","=", "Cardiology"],"or",["Categories","=","Imaging"]]
  // For List<string> this is translated by DevExtreme/EF Core to any-match.
  useEffect(() => {
    table.getColumn('categories')?.setFilterValue(selectedCategories.length ? selectedCategories : undefined)
  }, [selectedCategories, table])

  // isActive boolean -> "=" regardless of textFilterOperator
  useEffect(() => {
    table
      .getColumn('isActive')
      ?.setFilterValue(isActiveFilter === '' ? undefined : isActiveFilter === 'true')
  }, [isActiveFilter, table])

  // CreatedAt range -> between with ISO date strings (half-open), validate dates
  useEffect(() => {
    const validDate = (s: string) => {
      if (!s) return null
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? null : s
    }
    const from = validDate(dateFrom)
    const to = validDate(dateTo)
    if (from || to) {
      table.getColumn('createdAt')?.setFilterValue([from, to])
    } else {
      table.getColumn('createdAt')?.setFilterValue(undefined)
    }
  }, [dateFrom, dateTo, table])

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  return (
    <>
      <h1>Products — TanStack Table + ASP.NET Core + EF Core</h1>
      <p style={{ opacity: 0.7, fontSize: 14 }}>
        Demo enrichie : <code>Manufacturer</code> imbriqué (Name, Ref, Address, City, Country) +{' '}
        <code>Categories: string[]</code> many-to-many. Tous les cas de <code>buildQuery</code>{' '}
        sont exercés via <code>mapSelector</code> et conventions de filtre.
      </p>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <input
          placeholder="Search… (Name, Manufacturer, Categories)"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          style={{ minWidth: 260 }}
        />
        <input
          type="number"
          placeholder="Price ≥"
          style={{ width: 100 }}
          value={priceMin}
          onChange={(event) => setPriceMin(event.target.value)}
        />
        <input
          type="number"
          placeholder="Price ≤"
          style={{ width: 100 }}
          value={priceMax}
          onChange={(event) => setPriceMax(event.target.value)}
        />
        <select
          value={table.getState().pagination.pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
        >
          {[10, 25, 50].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
        <span className="status">{isFetching ? 'Loading…' : `${totalCount ?? '?'} results`}</span>
        {isError && <span className="error">Request failed — is the API running on :5055?</span>}
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        <div>
          <strong>Categories (OR):</strong>{' '}
          {CATEGORY_OPTIONS.map((cat) => (
            <label key={cat} style={{ marginRight: 8 }}>
              <input
                type="checkbox"
                checked={selectedCategories.includes(cat)}
                onChange={() => toggleCategory(cat)}
              />{' '}
              {cat}
            </label>
          ))}
          {selectedCategories.length > 0 && (
            <button onClick={() => setSelectedCategories([])} style={{ marginLeft: 8 }}>
              Clear
            </button>
          )}
        </div>
        <label>
          Active:{' '}
          <select value={isActiveFilter} onChange={(e) => setIsActiveFilter(e.target.value)}>
            <option value="">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          Created from: <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          to: <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          <tr className="filters">
            <td>
              <input
                placeholder="Name contains"
                defaultValue={(table.getColumn('name')?.getFilterValue() as string) ?? ''}
                onChange={(event) => table.getColumn('name')?.setFilterValue(event.target.value || undefined)}
              />
            </td>
            <td>
              <input
                placeholder="Manufacturer contains"
                defaultValue={(table.getColumn('manufacturerName')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('manufacturerName')?.setFilterValue(event.target.value || undefined)
                }
              />
            </td>
            <td>
              <input
                placeholder="Ref contains"
                defaultValue={(table.getColumn('manufacturerRef')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('manufacturerRef')?.setFilterValue(event.target.value || undefined)
                }
              />
            </td>
            <td>
              <input
                placeholder="Address contains"
                defaultValue={(table.getColumn('manufacturerAddress')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('manufacturerAddress')?.setFilterValue(event.target.value || undefined)
                }
              />
            </td>
            <td>
              <input
                placeholder="City contains"
                defaultValue={(table.getColumn('manufacturerCity')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('manufacturerCity')?.setFilterValue(event.target.value || undefined)
                }
              />
            </td>
            <td>
              <select
                defaultValue={(table.getColumn('manufacturerCountry')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('manufacturerCountry')?.setFilterValue(event.target.value || undefined)
                }
              >
                <option value="">All countries</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <input
                placeholder="Categories contains"
                defaultValue={(table.getColumn('categories')?.getFilterValue() as string) ?? ''}
                onChange={(event) =>
                  table.getColumn('categories')?.setFilterValue(event.target.value || undefined)
                }
              />
            </td>
            <td colSpan={2} />
            <td />
            <td />
          </tr>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
          {table.getRowModel().rows.length === 0 && !isFetching && (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>
                No results — try clearing filters
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pager">
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          ← Prev
        </button>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          Next →
        </button>
        <span className="status">
          Page {table.getState().pagination.pageIndex + 1} / {pageCount}
        </span>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary>Debug: active filters (wire format)</summary>
        <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, overflow: 'auto' }}>
          {JSON.stringify(
            {
              globalFilter: table.getState().globalFilter,
              columnFilters: table.getState().columnFilters,
              sorting: table.getState().sorting,
              pagination: table.getState().pagination,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </>
  )
}
