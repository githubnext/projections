import {subscribe} from '@shop/bus'

export async function sendReceipt(payment: unknown): Promise<void> {}

subscribe('payment.captured', sendReceipt)
