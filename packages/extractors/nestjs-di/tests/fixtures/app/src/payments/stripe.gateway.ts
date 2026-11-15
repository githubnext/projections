import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { PaymentGateway } from './payment-gateway';

@Injectable()
export class StripeGateway extends PaymentGateway {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) { super(); }
  async charge(amount: number): Promise<string> { return `stripe:${amount}${this.config.currency}`; }
}
