import { GoogleApiLimiter } from './google-api-limiter.service';

describe('GoogleApiLimiter', () => {
  let limiter: GoogleApiLimiter;

  beforeEach(() => {
    limiter = new GoogleApiLimiter();
  });

  it('동시 요청을 순서대로 실행한다', async () => {
    const results: number[] = [];

    await Promise.all(
      [1, 2, 3].map((i) =>
        limiter.schedule({}, async () => {
          results.push(i);
        }),
      ),
    );

    expect(results).toEqual([1, 2, 3]);
  });

  it('요청 사이에 minTime(100ms) 간격을 지킨다', async () => {
    const timestamps: number[] = [];

    await Promise.all(
      [1, 2, 3].map(() =>
        limiter.schedule({}, async () => {
          timestamps.push(Date.now());
        }),
      ),
    );

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(90);
    }
  }, 10000);

  it('우선순위가 낮은 요청보다 높은 요청을 먼저 실행한다', async () => {
    const results: string[] = [];

    // 첫 번째 작업을 먼저 점유시키고, 나머지를 큐에 쌓음
    const first = limiter.schedule({ priority: 5 }, async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push('first');
    });

    // 첫 번째 실행 중에 큐에 등록
    await new Promise((r) => setTimeout(r, 10));
    const low = limiter.schedule({ priority: 9 }, async () => {
      results.push('low');
    });
    const high = limiter.schedule({ priority: 1 }, async () => {
      results.push('high');
    });

    await Promise.all([first, high, low]);

    expect(results).toEqual(['first', 'high', 'low']);
  }, 10000);

  it('한 작업이 실패해도 큐에 남은 작업이 계속 실행된다', async () => {
    const results: string[] = [];

    const failing = limiter.schedule({}, async () => {
      throw new Error('fail');
    });
    const next = limiter.schedule({}, async () => {
      results.push('next');
    });

    await expect(failing).rejects.toThrow('fail');
    await next;

    expect(results).toEqual(['next']);
  }, 10000);

  it('동시에 2개 이상 실행되지 않는다 (maxConcurrent=1)', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await Promise.all(
      [1, 2, 3].map(() =>
        limiter.schedule({}, async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 20));
          concurrent--;
        }),
      ),
    );

    expect(maxConcurrent).toBe(1);
  }, 10000);
});
