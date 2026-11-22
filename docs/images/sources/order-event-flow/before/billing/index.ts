import {subscribe} from '@shop/bus'

export async function chargeCard(_order: unknown): Promise<void> {}

export async function emailReceipt(_order: unknown): Promise<void> {}

subscribe('order.placed', chargeCard)
subscribe('order.placed', emailReceipt)
