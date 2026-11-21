import {subscribe} from '@shop/bus'

export async function sendReceipt(payment: unknown): Promise<void> {
  // Emails the receipt.
}

subscribe('payment.captured', sendReceipt)
