import {subscribe} from '@shop/bus'

export async function chargeCard(order: unknown): Promise<void> {
  // Charges the card.
}

export async function emailReceipt(order: unknown): Promise<void> {
  // Emails the receipt.
}

subscribe('order.placed', chargeCard)
subscribe('order.placed', emailReceipt)
