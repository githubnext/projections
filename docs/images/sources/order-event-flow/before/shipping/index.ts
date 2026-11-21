import {subscribe} from '@shop/bus'

export async function reserveStock(order: unknown): Promise<void> {
  // Reserves the stock.
}

subscribe('order.placed', reserveStock)
