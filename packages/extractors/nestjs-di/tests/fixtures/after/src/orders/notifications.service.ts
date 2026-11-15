import { Injectable } from '@nestjs/common';
import { AuditLogger } from './audit.logger';

@Injectable()
export class NotificationsService {
  constructor(private readonly audit: AuditLogger) {}
  notify(order: string): void { this.audit.log(`notified ${order}`); }
}
