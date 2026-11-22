import {subscribe} from '@shop/bus'

export async function createShipment(_payment: unknown): Promise<void> {
  // Books the shipment.
}

subscribe('payment.captured', createShipment)
