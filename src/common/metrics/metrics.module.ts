import { Global, Module } from '@nestjs/common';
import { AppMetrics } from './app.metrics';

@Global()
@Module({
  providers: [AppMetrics],
  exports: [AppMetrics],
})
export class MetricsModule {}
