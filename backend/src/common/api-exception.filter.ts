// Trimmed port of uplive-prep's boilerplate-kit ApiExceptionFilter: same
// {success:false, message, code} envelope, minus branches (401/403/429...)
// that can't happen in this app since there's no auth or rate limiting.
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-response';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;

      if (exception instanceof BadRequestException && Array.isArray(body?.message)) {
        message = 'Validation failed';
        code = 'VALIDATION_ERROR';
        details = body.message;
      } else {
        message = typeof body === 'string' ? body : body?.message || exception.message;
        code =
          status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.BAD_REQUEST
              ? 'BAD_REQUEST'
              : 'HTTP_ERROR';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = 'APPLICATION_ERROR';
    }

    const body: ApiError = { success: false, message, code, details };
    // eslint-disable-next-line no-console
    console.error(`[${request.method} ${request.path}] ${code}: ${message}`);
    response.status(status).json(body);
  }
}
