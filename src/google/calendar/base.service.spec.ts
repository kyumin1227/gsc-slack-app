import { GaxiosError } from 'gaxios';
import { GoogleApiLimiter } from '../google-api-limiter.service';
import { GoogleCalendarBaseService } from './base.service';

function makeGaxiosError(status: number, retryAfter?: string): GaxiosError {
  const err = Object.create(GaxiosError.prototype) as GaxiosError;
  err.message = 'error';
  err.response = {
    status,
    data: {},
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
    config: {} as never,
    request: {} as never,
  } as never;
  return err;
}

class TestService extends GoogleCalendarBaseService {
  retry<T>(fn: () => Promise<T>, op: string, maxRetries?: number) {
    return this.withRetry(fn, op, maxRetries);
  }
}

describe('GoogleCalendarBaseService.withRetry', () => {
  let service: TestService;
  let metrics: {
    googleApiRateLimitTotal: { inc: jest.Mock };
    googleApiRetryTotal: { inc: jest.Mock };
    googleApiRequestsTotal: { inc: jest.Mock };
    googleApiErrorsTotal: { inc: jest.Mock };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    metrics = {
      googleApiRateLimitTotal: { inc: jest.fn() },
      googleApiRetryTotal: { inc: jest.fn() },
      googleApiRequestsTotal: { inc: jest.fn() },
      googleApiErrorsTotal: { inc: jest.fn() },
    };
    service = new TestService(new GoogleApiLimiter(), metrics as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('성공 시 바로 결과를 반환한다', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(service.retry(fn, 'op')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('429 발생 시 재시도 후 성공한다', async () => {
    let attempt = 0;
    const fn = jest.fn(async () => {
      if (attempt++ < 2) throw makeGaxiosError(429);
      return 'ok';
    });

    const promise = service.retry(fn, 'op');
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(metrics.googleApiRateLimitTotal.inc).toHaveBeenCalledTimes(2);
    expect(metrics.googleApiRetryTotal.inc).toHaveBeenCalledTimes(2);
  });

  it('재시도 중인 태스크가 다음 태스크보다 먼저 완료된다', async () => {
    const order: string[] = [];
    let attempt = 0;
    const sharedLimiter = new GoogleApiLimiter();

    const task1 = sharedLimiter.schedule({}, () =>
      service.retry(async () => {
        if (attempt++ < 1) throw makeGaxiosError(429);
        order.push('task1');
        return 'ok';
      }, 'op'),
    );
    const task2 = sharedLimiter.schedule({}, () =>
      service.retry(async () => {
        order.push('task2');
        return 'ok';
      }, 'op'),
    );

    await jest.runAllTimersAsync();
    await Promise.all([task1, task2]);

    expect(order).toEqual(['task1', 'task2']);
  });

  it('retry-after 헤더가 있으면 해당 시간만큼 대기한다', async () => {
    let attempt = 0;
    const fn = jest.fn(async () => {
      if (attempt++ < 1) throw makeGaxiosError(429, '2');
      return 'ok';
    });

    const promise = service.retry(fn, 'op');
    await jest.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exponential backoff로 대기한다 (1s → 2s → 4s)', async () => {
    const delays: number[] = [];
    const originalSetTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn, delay, ...args) => {
        if (typeof delay === 'number' && delay > 0) delays.push(delay);
        return originalSetTimeout(fn, 0, ...args);
      });

    let attempt = 0;
    const fn = jest.fn(async () => {
      if (attempt++ < 3) throw makeGaxiosError(500);
      return 'ok';
    });

    const promise = service.retry(fn, 'op');
    await jest.runAllTimersAsync();
    await promise;

    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('maxRetries 초과 시 에러를 던진다', async () => {
    const fn = jest.fn(async () => {
      throw makeGaxiosError(429);
    });

    const promise = service.retry(fn, 'op', 2);
    const assertion = expect(promise).rejects.toThrow(GaxiosError);
    await jest.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3); // 최초 1회 + 재시도 2회
  });

  it.each([500, 503])('%i 에러도 재시도 후 성공한다', async (status) => {
    let attempt = 0;
    const fn = jest.fn(async () => {
      if (attempt++ < 1) throw makeGaxiosError(status);
      return 'ok';
    });

    const promise = service.retry(fn, 'op');
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(metrics.googleApiRetryTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('재시도 불가 에러(404)는 즉시 던진다', async () => {
    const fn = jest.fn(async () => {
      throw makeGaxiosError(404);
    });

    await expect(service.retry(fn, 'op')).rejects.toThrow(GaxiosError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(metrics.googleApiRetryTotal.inc).not.toHaveBeenCalled();
  });

  it('GaxiosError가 아닌 에러는 즉시 던진다', async () => {
    const fn = jest.fn(async () => {
      throw new Error('unexpected');
    });

    await expect(service.retry(fn, 'op')).rejects.toThrow('unexpected');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
