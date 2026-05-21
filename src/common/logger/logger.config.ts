import * as winston from 'winston';
import LokiTransport from 'winston-loki';

const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [
  new winston.transports.Console({
    // 운영: JSON / 개발: 컬러 텍스트
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(
            ({ level, message, timestamp, context }) =>
              `${timestamp} [${context ?? 'App'}] ${level}: ${message}`,
          ),
        ),
  }),
];

// LOKI_URL 설정 시 Loki로 로그 전송, 미설정 시 콘솔만 출력
if (process.env.LOKI_URL) {
  transports.push(
    new LokiTransport({
      host: process.env.LOKI_URL,
      labels: { app: 'gsc-slack-app' },
      json: true,
      format: winston.format.json(),
      replaceTimestamp: true,
      onConnectionError: (err) => console.error('Loki connection error:', err),
    }),
  );
}

export const winstonConfig: winston.LoggerOptions = {
  level: isProduction ? 'info' : 'debug', // 운영: info 이상 / 개발: debug 이상
  transports,
};
