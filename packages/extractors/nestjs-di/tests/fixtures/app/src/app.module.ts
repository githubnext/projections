import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { OrdersModule } from './orders/orders.module';

@Module({ imports: [ConfigModule, OrdersModule] })
export class AppModule {}
