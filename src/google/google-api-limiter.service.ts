import { Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';

@Injectable()
export class GoogleApiLimiter {
  private readonly limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 100,
  });

  schedule<T>(
    options: { priority?: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.limiter.schedule(options, fn);
  }
}
