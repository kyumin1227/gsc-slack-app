import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { httpReceiver } from './slack-receiver';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  if (httpReceiver) {
    app.use(httpReceiver.router);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
