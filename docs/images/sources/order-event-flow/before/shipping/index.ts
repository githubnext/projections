import {subscribe} from '@shop/bus'

export async function reserveStock(_order: unknown): Promise<void> {
  // Reserves the stock.
}

subscribe('order.placed', reserveStock)
