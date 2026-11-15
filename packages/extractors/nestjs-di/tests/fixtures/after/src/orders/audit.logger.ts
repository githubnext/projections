import { Injectable } from '@nestjs/common';

/** Now shared: one logger for the application. */
@Injectable()
export class AuditLogger {
  log(message: string): void { void message; }
}
