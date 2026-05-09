import { USER_ERROR_MESSAGES } from './user.errors';
import { GOOGLE_ERROR_MESSAGES } from './google.errors';
import { SCHEDULE_ERROR_MESSAGES } from './schedule.errors';
import { RESOURCE_ERROR_MESSAGES } from './resource.errors';

const ALL_ERROR_MESSAGES: Record<string, string> = {
  ...USER_ERROR_MESSAGES,
  ...GOOGLE_ERROR_MESSAGES,
  ...SCHEDULE_ERROR_MESSAGES,
  ...RESOURCE_ERROR_MESSAGES,
};

export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? ALL_ERROR_MESSAGES[code]);
    this.name = 'BusinessError';
  }
}

// 각 파일에서 에러 codes와 messages를 생성하는 팩토리 함수
export function createErrorDomain<T extends Record<string, string>>(
  prefix: string,
  definitions: T,
): {
  codes: { [K in keyof T]: string };
  messages: Record<string, string>;
} {
  const codes = Object.fromEntries(
    Object.keys(definitions).map((k) => [k, `${prefix}:${k}`]),
  ) as { [K in keyof T]: string };

  const messages: Record<string, string> = Object.fromEntries(
    Object.entries(definitions).map(([k, v]) => [`${prefix}:${k}`, v]),
  );

  return { codes, messages };
}
