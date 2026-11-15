import { Global, Module } from '@nestjs/common';

export const APP_CONFIG = 'APP_CONFIG';
export interface AppConfig { currency: string }

/** Global: every module can inject APP_CONFIG without importing this one. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: { currency: 'EUR' } satisfies AppConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
