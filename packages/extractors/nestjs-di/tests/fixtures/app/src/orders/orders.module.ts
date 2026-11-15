import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AuditLogger } from './audit.logger';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { RequestContext } from './request-context';
import { CLOCK, type Clock } from './tokens';

export function systemClock(): Clock {
  return { now: () => new Date() };
}

@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrdersRepository,
    RequestContext,
    AuditLogger,
    { provide: CLOCK, useFactory: systemClock },
  ],
})
export class OrdersModule {}
