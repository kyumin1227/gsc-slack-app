export * from './base.error';
export * from './user.errors';
export * from './google.errors';
export * from './schedule.errors';
export * from './resource.errors';

import { USER_ERROR_MESSAGES } from './user.errors';
import { GOOGLE_ERROR_MESSAGES } from './google.errors';
import { SCHEDULE_ERROR_MESSAGES } from './schedule.errors';
import { RESOURCE_ERROR_MESSAGES } from './resource.errors';

export const ERROR_MESSAGES = {
  ...USER_ERROR_MESSAGES,
  ...GOOGLE_ERROR_MESSAGES,
  ...SCHEDULE_ERROR_MESSAGES,
  ...RESOURCE_ERROR_MESSAGES,
};
