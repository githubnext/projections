import {subscribe} from '@shop/bus'

export async function createShipment(payment: unknown): Promise<void> {}

subscribe('payment.captured', createShipment)
