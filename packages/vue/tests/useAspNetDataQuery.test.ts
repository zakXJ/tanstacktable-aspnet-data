import { defineComponent, h } from 'vue'
import { render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { describe, expect, it } from 'vitest'
import type { ColumnDef } from '@tanstack/vue-table'
import { useAspNetDataQuery } from '../src/query'
import { requests } from './setup'
import type { ProductRow } from './setup'

const endpoint = 'http://test.local/api/products'
const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'name' },
  { accessorKey: 'manufacturer' },
]

function mountQuery(client: QueryClient, headers?: Record<string, string>) {
  let result!: ReturnType<typeof useAspNetDataQuery<ProductRow>>
  const Host = defineComponent({
    setup() {
      result = useAspNetDataQuery<ProductRow>({ endpoint, columns, headers, cache: true })
      return () => h('div')
    },
  })
  render(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return () => result
}

describe('useAspNetDataQuery (vue)', () => {
  it('forces the network on refetch even with the adapter cache enabled', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const getResult = mountQuery(client)
    await waitFor(() => expect(getResult().rows.value.length).toBeGreaterThan(0))
    const before = requests.length
    await getResult().refetch()
    await waitFor(() => expect(requests.length).toBe(before + 1))
  })

  it('isolates queries with different header fingerprints', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = mountQuery(client, { 'X-Tenant': 'a' })
    await waitFor(() => expect(first().rows.value.length).toBeGreaterThan(0))
    const second = mountQuery(client, { 'X-Tenant': 'b' })
    await waitFor(() => expect(second().rows.value.length).toBeGreaterThan(0))
    expect(requests.length).toBe(2)
  })
})
