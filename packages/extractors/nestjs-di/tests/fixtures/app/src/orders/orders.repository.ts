import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersRepository {
  private readonly orders: string[] = [];
  save(order: string): void { this.orders.push(order); }
}
