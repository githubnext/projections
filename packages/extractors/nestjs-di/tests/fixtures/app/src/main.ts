import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Projections never runs the bootstrap: it composes AppModule in preview mode.
async function bootstrap() {
  writeFileSync('started.txt', 'bootstrapped');
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
void bootstrap();
