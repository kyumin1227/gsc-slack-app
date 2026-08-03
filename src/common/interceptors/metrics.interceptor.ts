import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { AppMetrics } from '../metrics/app.metrics';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly appMetrics: AppMetrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method;
    const path = req.route?.path ?? req.path;
    const end = this.appMetrics.httpRequestDurationSeconds.startTimer({
      method,
      path,
    });

    return next.handle().pipe(
      tap(() => {
        const status = String(res.statusCode);
        end({ status });
        this.appMetrics.httpRequestsTotal.inc({ method, path, status });
      }),
    );
  }
}
