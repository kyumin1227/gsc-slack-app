import { Injectable } from '@nestjs/common';
import * as os from 'os';
import { readFileSync } from 'fs';
import { join } from 'path';

const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

const SERVER_START_TIME = new Date();

@Injectable()
export class AppService {
  getHealthInfo() {
    return {
      status: 'ok',
      version,
      startedAt: SERVER_START_TIME.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
      }),
    };
  }

  getDetailedHealthInfo() {
    const networkInterfaces = os.networkInterfaces();
    const ip =
      Object.values(networkInterfaces)
        .flat()
        .find((iface) => iface?.family === 'IPv4' && !iface.internal)
        ?.address ?? 'unknown';

    return {
      ...this.getHealthInfo(),
      hostname: os.hostname(),
      ip,
    };
  }
}
