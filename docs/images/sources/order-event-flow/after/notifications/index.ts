import {subscribe} from '@shop/bus'

export async function sendReceipt(_payment: unknown): Promise<void> {}

subscribe('payment.captured', sendReceipt)
