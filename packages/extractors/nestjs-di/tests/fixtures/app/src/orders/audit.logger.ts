import { Injectable, Scope } from '@nestjs/common';

/** Transient: every consumer gets its own logger. */
@Injectable({ scope: Scope.TRANSIENT })
export class AuditLogger {
  log(message: string): void { void message; }
}
