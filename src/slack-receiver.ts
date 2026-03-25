import { ExpressReceiver } from '@slack/bolt';

const isSocketMode = process.env.SLACK_SOCKET_MODE !== 'false';

export const httpReceiver = !isSocketMode
  ? new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    })
  : undefined;
