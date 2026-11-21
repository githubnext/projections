import {subscribe} from '@shop/bus'

export async function reserveStock(_order: unknown): Promise<void> {}

subscribe('order.placed', reserveStock)
