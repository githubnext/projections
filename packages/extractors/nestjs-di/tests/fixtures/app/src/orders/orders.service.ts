import { Inject, Injectable, Optional } from '@nestjs/common';
import { PaymentGateway } from '../payments/payment-gateway';
import { AuditLogger } from './audit.logger';
import { OrdersRepository } from './orders.repository';
import { CLOCK, METRICS, type Clock } from './tokens';

@Injectable()
export class OrdersService {
  @Inject(AuditLogger) private readonly audit: AuditLogger;

  constructor(
    private readonly repository: OrdersRepository,
    private readonly payments: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(METRICS) private readonly metrics?: { increment(name: string): void },
  ) {}

  async place(order: string): Promise<string> {
    this.repository.save(order);
    this.metrics?.increment('orders');
    this.audit.log(`${order} at ${this.clock.now().toISOString()}`);
    return this.payments.charge(1);
  }
}
