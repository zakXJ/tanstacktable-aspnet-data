import type { PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'
import { useAspNetDataQuery } from '../src/query'
import { requests } from './setup'
import type { ProductRow } from './setup'

const endpoint = 'http://test.local/api/products'
const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'name' },
  { accessorKey: 'manufacturer' },
]

function wrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useAspNetDataQuery', () => {
  it('forces the network on refetch even with the adapter cache enabled', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useAspNetDataQuery<ProductRow>({ endpoint, columns, cache: true }),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
    const before = requests.length
    await act(async () => result.current.refetch())
    await waitFor(() => expect(requests.length).toBe(before + 1))
  })

  it('refetches when header identity or query scope changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, rerender } = renderHook(
      ({ tenant, scope }) => useAspNetDataQuery<ProductRow>({
        endpoint,
        columns,
        headers: { 'X-Tenant': tenant },
        queryKeyScope: scope,
      }),
      { initialProps: { tenant: 'a', scope: 'user-1' }, wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0))
    expect(requests.length).toBe(1)
    rerender({ tenant: 'b', scope: 'user-1' })
    await waitFor(() => expect(requests.length).toBe(2))
    rerender({ tenant: 'b', scope: 'user-2' })
    await waitFor(() => expect(requests.length).toBe(3))
  })
})
