import { Module } from '@nestjs/common';
import { PaymentGateway } from './payment-gateway';
import { StripeGateway } from './stripe.gateway';

export const PAYMENTS = 'PAYMENTS';

@Module({
  providers: [
    { provide: PaymentGateway, useClass: StripeGateway },
    // An alias: the same instance under a second token.
    { provide: PAYMENTS, useExisting: PaymentGateway },
  ],
  exports: [PaymentGateway, PAYMENTS],
})
export class PaymentsModule {}
