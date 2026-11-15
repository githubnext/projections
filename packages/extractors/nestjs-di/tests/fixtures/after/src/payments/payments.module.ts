import { Module } from '@nestjs/common';
import { PaymentGateway } from './payment-gateway';
import { AdyenGateway } from './adyen.gateway';

export const PAYMENTS = 'PAYMENTS';

@Module({
  providers: [
    { provide: PaymentGateway, useClass: AdyenGateway },
    // An alias: the same instance under a second token.
    { provide: PAYMENTS, useExisting: PaymentGateway },
  ],
  exports: [PaymentGateway, PAYMENTS],
})
export class PaymentsModule {}
