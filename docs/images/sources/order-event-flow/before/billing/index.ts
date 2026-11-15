import {subscribe} from '@shop/bus'

export async function chargeCard(order: unknown): Promise<void> {}

export async function emailReceipt(order: unknown): Promise<void> {}

subscribe('order.placed', chargeCard)
subscribe('order.placed', emailReceipt)
