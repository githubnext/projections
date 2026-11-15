import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { PaymentGateway } from './payment-gateway';

@Injectable()
export class AdyenGateway extends PaymentGateway {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) { super(); }
  async charge(amount: number): Promise<string> { return `adyen:${amount}${this.config.currency}`; }
}
