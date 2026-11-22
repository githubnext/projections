import {subscribe} from '@shop/bus'

export async function createShipment(_payment: unknown): Promise<void> {}

subscribe('payment.captured', createShipment)
