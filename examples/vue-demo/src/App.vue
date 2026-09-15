<script setup lang="ts">
import { FlexRender, createColumnHelper } from '@tanstack/vue-table'
import { ref, watch, onMounted } from 'vue'
import { useAspNetDataTable } from '@tanstack-aspnet-data/vue'

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
  createdAt: string
}

const API_URL = 'http://localhost:5055/api/products'

const CATEGORY_OPTIONS = ['Cardiology', 'Orthopedics', 'Neurology', 'Imaging', 'Surgery', 'Monitoring']
const COUNTRY_OPTIONS = ['USA', 'Germany', 'Netherlands']

const columnHelper = createColumnHelper<Product>()

const mapSelector = (id: string) => {
  const map: Record<string, string> = {
    manufacturerName: 'Manufacturer.Name',
    manufacturerRef: 'Manufacturer.Ref',
    manufacturerAddress: 'Manufacturer.Address',
    manufacturerCity: 'Manufacturer.City',
    manufacturerCountry: 'Manufacturer.Country',
    categories: 'CategoryNames',
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
  }),
  columnHelper.accessor('price', {
    header: 'Price',
    cell: (info) => `$${(info.getValue() as number).toFixed(2)}`,
  }),
  columnHelper.accessor('unitsInStock', { header: 'Stock' }),
  columnHelper.accessor('isActive', {
    header: 'Active',
    cell: (info) => ((info.getValue() as boolean) ? 'Yes' : 'No'),
  }),
  columnHelper.accessor('createdAt', {
    header: 'Created',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString(),
  }),
]

const searchInput = ref('')
const priceMin = ref('')
const priceMax = ref('')
const selectedCategories = ref<string[]>([])
const isActiveFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')

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
  resolveColumnFilter: (filter) => {
    if (filter.id === 'categories') {
      const v = filter.value
      if (Array.isArray(v)) {
        const parts = (v as unknown[]).filter((x) => x != null && x !== '').map((x) => ['CategoryNames', 'contains', x] as unknown)
        if (parts.length === 0) return undefined as unknown as any
        if (parts.length === 1) return parts[0] as unknown
        return parts.flatMap((p, i) => (i === 0 ? [p] : ['or', p])) as unknown
      }
      if (typeof v === 'string' && v) return ['CategoryNames', 'contains', v] as unknown
    }
    return undefined as unknown as any
  },
  initialPagination: { pageIndex: 0, pageSize: 10 },
  syncUrl: true,
  globalFilterDebounceMs: 300,
})

// Hydratation seule au mount : restore toolbar controls from URL-synced table state
onMounted(() => {
  const s = table.getState()
  if (s.globalFilter) searchInput.value = String(s.globalFilter)
  const priceF = s.columnFilters.find((f) => f.id === 'price')?.value as [any, any] | undefined
  if (priceF) {
    if (priceF[0] != null) priceMin.value = String(priceF[0])
    if (priceF[1] != null) priceMax.value = String(priceF[1])
  }
  const catF = s.columnFilters.find((f) => f.id === 'categories')?.value as unknown
  if (catF) {
    if (Array.isArray(catF)) selectedCategories.value = catF as string[]
    else if (typeof catF === 'string') selectedCategories.value = [catF as string]
  }
  const activeF = s.columnFilters.find((f) => f.id === 'isActive')?.value
  if (activeF !== undefined) isActiveFilter.value = String(activeF)
  const dateF = s.columnFilters.find((f) => f.id === 'createdAt')?.value as [any, any] | undefined
  if (dateF) {
    if (dateF[0]) dateFrom.value = String(dateF[0]).slice(0, 10)
    if (dateF[1]) dateTo.value = String(dateF[1]).slice(0, 10)
  }
})

// Global search debounced via hook
watch(searchInput, (value) => {
  table.setGlobalFilter(value)
})

// Price range -> between with NaN guard
watch([priceMin, priceMax], ([min, max]) => {
  const parse = (v: string) => {
    if (v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const pMin = parse(min)
  const pMax = parse(max)
  if (pMin !== null || pMax !== null) {
    table.getColumn('price')?.setFilterValue([pMin, pMax])
  } else {
    table.getColumn('price')?.setFilterValue(undefined)
  }
})

// Categories OR
watch(selectedCategories, (val) => {
  table.getColumn('categories')?.setFilterValue(val.length ? [...val] : undefined)
})

// isActive boolean
watch(isActiveFilter, (val) => {
  table.getColumn('isActive')?.setFilterValue(val === '' ? undefined : val === 'true')
})

// CreatedAt range (ISO date strings) with validation
watch([dateFrom, dateTo], ([from, to]) => {
  const valid = (s: string) => {
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : s
  }
  const vFrom = valid(from)
  const vTo = valid(to)
  if (vFrom || vTo) {
    table.getColumn('createdAt')?.setFilterValue([vFrom, vTo])
  } else {
    table.getColumn('createdAt')?.setFilterValue(undefined)
  }
})

function toggleCategory(cat: string) {
  const cur = selectedCategories.value
  selectedCategories.value = cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]
}
</script>

<template>
  <h1>Products — TanStack Table + ASP.NET Core + EF Core</h1>
  <p style="opacity: 0.7; font-size: 14px">
    Démo enrichie : <code>Manufacturer</code> imbriqué (Name, Ref, Address, City, Country) +
    <code>Categories: string[]</code> many-to-many. Tous les cas <code>buildQuery</code> exercés via
    <code>mapSelector</code>.
  </p>

  <div class="toolbar" style="flex-wrap: wrap; gap: 12px">
    <input v-model="searchInput" placeholder="Search… (Name, Manufacturer, Categories)" style="min-width: 260px" />
    <input v-model="priceMin" type="number" placeholder="Price ≥" style="width: 100px" />
    <input v-model="priceMax" type="number" placeholder="Price ≤" style="width: 100px" />
    <select
      :value="table.getState().pagination.pageSize"
      @change="table.setPageSize(Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="size in [10, 25, 50]" :key="size" :value="size">{{ size }} / page</option>
    </select>
    <span class="status">
      {{ isFetching ? 'Loading…' : `${totalCount ?? '?'} results` }}
    </span>
    <span v-if="isError" class="error">Request failed — is the API running on :5055?</span>
  </div>

  <div class="toolbar" style="flex-wrap: wrap; gap: 12px; margin-top: 8px">
    <div>
      <strong>Categories (OR):</strong>
      <label v-for="cat in CATEGORY_OPTIONS" :key="cat" style="margin-right: 8px">
        <input type="checkbox" :checked="selectedCategories.includes(cat)" @change="toggleCategory(cat)" />
        {{ cat }}
      </label>
      <button v-if="selectedCategories.length" @click="selectedCategories = []" style="margin-left: 8px">
        Clear
      </button>
    </div>
    <label>
      Active:
      <select v-model="isActiveFilter">
        <option value="">All</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
    <label>
      Created from: <input type="date" v-model="dateFrom" />
    </label>
    <label>to: <input type="date" v-model="dateTo" /></label>
  </div>

  <table>
    <thead>
      <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
        <th
          v-for="header in headerGroup.headers"
          :key="header.id"
          @click="header.column.getToggleSortingHandler()?.($event)"
        >
          <FlexRender
            v-if="!header.isPlaceholder"
            :render="header.column.columnDef.header"
            :props="header.getContext()"
          />
          {{ ({ asc: '▲', desc: '▼' } as any)[header.column.getIsSorted() as string] ?? '' }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr class="filters">
        <td>
          <input
            placeholder="Name contains"
            :value="(table.getColumn('name')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('name')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td>
          <input
            placeholder="Manufacturer contains"
            :value="(table.getColumn('manufacturerName')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('manufacturerName')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td>
          <input
            placeholder="Ref contains"
            :value="(table.getColumn('manufacturerRef')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('manufacturerRef')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td>
          <input
            placeholder="Address contains"
            :value="(table.getColumn('manufacturerAddress')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('manufacturerAddress')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td>
          <input
            placeholder="City contains"
            :value="(table.getColumn('manufacturerCity')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('manufacturerCity')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td>
          <select
            :value="(table.getColumn('manufacturerCountry')?.getFilterValue() as string) ?? ''"
            @change="
              table.getColumn('manufacturerCountry')?.setFilterValue(
                ($event.target as HTMLSelectElement).value || undefined,
              )
            "
          >
            <option value="">All countries</option>
            <option v-for="c in COUNTRY_OPTIONS" :key="c" :value="c">{{ c }}</option>
          </select>
        </td>
        <td>
          <input
            placeholder="Categories contains"
            :value="(table.getColumn('categories')?.getFilterValue() as string) ?? ''"
            @input="
              table.getColumn('categories')?.setFilterValue(
                ($event.target as HTMLInputElement).value || undefined,
              )
            "
          />
        </td>
        <td colspan="2" />
        <td />
        <td />
      </tr>
      <tr v-for="row in table.getRowModel().rows" :key="row.id">
        <td v-for="cell in row.getVisibleCells()" :key="cell.id">
          <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
        </td>
      </tr>
      <tr v-if="table.getRowModel().rows.length === 0 && !isFetching">
        <td :colspan="columns.length" style="text-align: center; padding: 16px; opacity: 0.6">
          No results — try clearing filters
        </td>
      </tr>
    </tbody>
  </table>

  <div class="pager">
    <button :disabled="!table.getCanPreviousPage()" @click="table.previousPage()">← Prev</button>
    <button :disabled="!table.getCanNextPage()" @click="table.nextPage()">Next →</button>
    <span class="status">Page {{ table.getState().pagination.pageIndex + 1 }} / {{ pageCount }}</span>
  </div>

  <details style="margin-top: 16px">
    <summary>Debug: active filters (wire format)</summary>
    <pre style="font-size: 12px; background: #f5f5f5; padding: 8px; overflow: auto">{{ JSON.stringify({ globalFilter: table.getState().globalFilter, columnFilters: table.getState().columnFilters, sorting: table.getState().sorting, pagination: table.getState().pagination }, null, 2) }}</pre>
  </details>
</template>
