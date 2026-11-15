import {publish} from '@shop/bus'

export async function placeOrder(order: {id: string}): Promise<void> {
  await publish('order.placed', order)
}
