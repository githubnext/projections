import {publish, subscribe} from '@shop/bus'

export async function capturePayment(order: unknown): Promise<void> {
  await publish('payment.captured', order)
}

subscribe('order.placed', capturePayment)
