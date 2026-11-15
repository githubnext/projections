import {subscribe} from '@shop/bus'

export async function reserveStock(order: unknown): Promise<void> {}

subscribe('order.placed', reserveStock)
