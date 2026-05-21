import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { httpReceiver } from './slack-receiver';
import { ScheduleCronService } from './schedule/service/schedule-cron.service';
import { AppMetrics } from './common/metrics/app.metrics';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  if (httpReceiver) {
    app.use(httpReceiver.router);
  }

  const appMetrics = app.get(AppMetrics);
  app.getHttpAdapter().get('/metrics', async (_req, res) => {
    res.set('Content-Type', appMetrics.registry.contentType);
    res.end(await appMetrics.registry.metrics());
  });

  await app.listen(process.env.PORT ?? 3000);

  // 서버가 포트를 열고 난 뒤 watch 갱신
  app
    .get(ScheduleCronService)
    .renewOnBootstrap()
    .catch((err: Error) => {
      console.error('Bootstrap watch renewal failed:', err.message);
    });
}
bootstrap();
