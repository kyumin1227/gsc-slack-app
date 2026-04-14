import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { httpReceiver } from './slack-receiver';
import { ScheduleCronService } from './schedule/schedule-cron.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  if (httpReceiver) {
    app.use(httpReceiver.router);
  }

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
