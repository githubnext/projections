import { Controller, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RequestContext } from './request-context';

/** Injecting a request-scoped provider makes the controller request-scoped too. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly context: RequestContext) {}

  @Post()
  place(): Promise<string> { return this.orders.place(this.context.id); }
}
