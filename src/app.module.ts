import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SlackModule } from 'nestjs-slack-bolt';
import { SlackService } from 'nestjs-slack-bolt';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { createKeyv } from '@keyv/redis';
import { SlackHomeModule } from './slack-home/slack-home.module';
import { UserModule } from './user/user.module';
import { StudentClassModule } from './student-class/student-class.module';
import { TagModule } from './tag/tag.module';
import { ScheduleModule } from './schedule/schedule.module';
import { ChannelModule } from './channel/channel.module';
import { SpaceModule } from './space/space.module';
import { httpReceiver } from './slack-receiver';
import { slackErrorMiddleware } from './common/slack-error.middleware';

@Module({
  imports: [
    ConfigModule.forRoot(),
    NestScheduleModule.forRoot(),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        stores: [
          createKeyv(
            `redis://:${process.env.REDIS_PASSWORD ?? 'redis'}@${process.env.REDIS_HOST ?? 'localhost'}:${process.env.REDIS_PORT ?? '6379'}`,
          ),
        ],
      }),
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      migrations: [__dirname + '/migrations/*.js'],
      migrationsRun: process.env.DB_SYNCHRONIZE !== 'true',
    }),
    SlackModule.forRoot(
      httpReceiver
        ? {
            token: process.env.SLACK_BOT_TOKEN,
            receiver: httpReceiver,
            socketMode: false,
          }
        : {
            token: process.env.SLACK_BOT_TOKEN,
            socketMode: true,
            appToken: process.env.SLACK_APP_TOKEN,
            signingSecret: process.env.SLACK_SIGNING_SECRET,
          },
    ),
    SlackHomeModule,
    UserModule,
    StudentClassModule,
    TagModule,
    ScheduleModule,
    ChannelModule,
    SpaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly slackService: SlackService) {}

  onModuleInit() {
    this.slackService.app.use(slackErrorMiddleware);
  }
}
