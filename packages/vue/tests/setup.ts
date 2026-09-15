import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/vue'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export interface ProductRow {
  id: number
  name: string
  manufacturer: string
}

export const products: ProductRow[] = [
  { id: 1, name: 'Pacemaker X', manufacturer: 'Medtronic' },
  { id: 2, name: 'Stent Pro', manufacturer: 'Boston Scientific' },
  { id: 3, name: 'Insulin Pump', manufacturer: 'Medtronic' },
]

export const requests: URL[] = []

export const server = setupServer(
  http.get('http://test.local/api/products', ({ request }) => {
    requests.push(new URL(request.url))
    return HttpResponse.json({ data: products, totalCount: 123 })
  }),
)

beforeAll(() => server.listen())
afterEach(() => {
  cleanup()
  server.resetHandlers()
  requests.length = 0
})
afterAll(() => server.close())
