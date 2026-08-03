import { Module, OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { ResourceModule } from './resource/resource.module';
import { httpReceiver } from './slack-receiver';
import { createSlackErrorMiddleware } from './common/slack-error.middleware';
import { createSlackMetricsMiddleware } from './common/slack-metrics.middleware';
import { CleaningModule } from './cleaning/cleaning.module';
import { SlackAiModule } from './slack-ai/slack-ai.module';
import { McpModule } from './mcp/mcp.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { AppMetrics } from './common/metrics/app.metrics';

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
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false,
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
    ResourceModule,
    CleaningModule,
    SlackAiModule,
    McpModule,
    AnnouncementModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly slackService: SlackService,
    private readonly appMetrics: AppMetrics,
  ) {}

  onModuleInit() {
    this.slackService.app.use(createSlackMetricsMiddleware(this.appMetrics));
    this.slackService.app.use(createSlackErrorMiddleware(this.appMetrics));
  }
}
