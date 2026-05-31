import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class AppMetrics implements OnModuleInit {
  readonly registry = new Registry();

  readonly aiMessagesTotal = new Counter({
    name: 'ai_messages_total',
    help: 'AI 메시지 처리 횟수',
    registers: [this.registry],
  });

  readonly aiMessageDurationSeconds = new Histogram({
    name: 'ai_message_duration_seconds',
    help: 'AI 메시지 처리 시간 (초)',
    buckets: [3, 5, 8, 10, 15, 20, 30],
    registers: [this.registry],
  });

  readonly aiMessageRounds = new Histogram({
    name: 'ai_message_rounds',
    help: 'AI 메시지당 tool_use 라운드 수',
    buckets: [1, 2, 3, 4, 5, 7, 10],
    registers: [this.registry],
  });

  readonly aiSlackUpdatesPerMessage = new Histogram({
    name: 'ai_slack_updates_per_message',
    help: 'AI 메시지 처리 중 Slack chat.update 호출 횟수',
    buckets: [5, 8, 10, 15, 20, 30, 50, 100],
    registers: [this.registry],
  });

  readonly aiProcessingCurrent = new Gauge({
    name: 'ai_processing_current',
    help: '현재 AI 메시지 처리 중인 수',
    registers: [this.registry],
  });

  readonly slackActionsTotal = new Counter({
    name: 'slack_actions_total',
    help: 'Slack 액션/뷰 제출 횟수',
    labelNames: ['action_id'] as const,
    registers: [this.registry],
  });

  readonly toolExecutionsTotal = new Counter({
    name: 'tool_executions_total',
    help: '툴 실행 횟수',
    labelNames: ['tool_name', 'success'] as const,
    registers: [this.registry],
  });

  readonly businessErrorsTotal = new Counter({
    name: 'business_errors_total',
    help: '비즈니스 에러 발생 횟수',
    labelNames: ['error_code'] as const,
    registers: [this.registry],
  });

  readonly unexpectedErrorsTotal = new Counter({
    name: 'unexpected_errors_total',
    help: '예상치 못한 에러 발생 횟수',
    registers: [this.registry],
  });

  readonly aiTokensTotal = new Counter({
    name: 'ai_tokens_total',
    help: 'Anthropic API 토큰 사용량',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });

  readonly googleApiRequestsTotal = new Counter({
    name: 'google_api_requests_total',
    help: 'Google Calendar API 요청 횟수',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  readonly googleApiErrorsTotal = new Counter({
    name: 'google_api_errors_total',
    help: 'Google Calendar API 에러 횟수',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  readonly googleApiRateLimitTotal = new Counter({
    name: 'google_api_rate_limit_total',
    help: 'Google Calendar API Rate Limit(429) 발생 횟수',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  readonly googleApiRetryTotal = new Counter({
    name: 'google_api_retry_total',
    help: 'Google Calendar API 재시도 횟수',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  readonly cronJobDurationSeconds = new Histogram({
    name: 'cron_job_duration_seconds',
    help: 'Cron 작업 실행 시간 (초)',
    labelNames: ['job_name'] as const,
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'HTTP 요청 횟수',
    labelNames: ['method', 'path', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP 요청 처리 시간 (초)',
    labelNames: ['method', 'path', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }
}
