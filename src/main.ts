import {
  ClassSerializerInterceptor,
  HttpStatus,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import compression from 'compression';
import { middleware as expressCtx } from 'express-ctx';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/bad-request.filter';
import { QueryFailedFilter } from './filters/query-failed.filter';
import { TranslationInterceptor } from './interceptors/translation-interceptor.service';
import { setupSwagger } from './setup-swagger';
import { ApiConfigService } from './shared/services/api-config.service';
import { TranslationService } from './shared/services/translation.service';
import { SharedModule } from './shared/shared.module';
import {LanguageInterceptor} from "./interceptors/language-interceptor.service";

export async function bootstrap(): Promise<NestExpressApplication> {
  initializeTransactionalContext();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
    { cors: true },
  );

  app.enable('trust proxy'); // only if you're behind a reverse proxy (Heroku, Bluemix, AWS ELB, Nginx, etc)

  app.use(helmet()); // helmet includes 14 small middleware to help process and filter malicious HTTP headers (to exploit XSS or clickjacking vulnerabilities, ...)

  // app.setGlobalPrefix('/api'); use api as global prefix if you don't have subdomain

  // attach (DOS, DDOS)
  if (process.env.NODE_ENV === 'production') {
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: "Too many accounts created from this IP, please try again after an hour"
      }),
    );
  }

  app.use(compression()); // compress response between client and server, increase performance of load website (content-encoding: gzip, br) in headers of request and response
  app.use(morgan('combined')); // write log request with morgan
  app.enableVersioning();

  const reflector = app.get(Reflector);

  // Request - Response lifecycle:
  // Middleware => Guard => Interceptor (Process before handle route) => Pipe => Router (Controller) => Interceptor (Process after handle route) => Exception Filter

  // Middleware
  app.use(expressCtx);

  // Interceptors
  app.useGlobalInterceptors(
    new LanguageInterceptor(),
    new ClassSerializerInterceptor(reflector),
    new TranslationInterceptor(
      app.select(SharedModule).get(TranslationService),
    ),
  );

  // Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      transform: true,
      dismissDefaultMessages: true,
      exceptionFactory: (errors) => new UnprocessableEntityException(errors),
    }),
  );

  // Exception Filter
  app.useGlobalFilters(
    new HttpExceptionFilter(reflector),
    new QueryFailedFilter(reflector),
  );

  const configService = app.select(SharedModule).get(ApiConfigService);

  // only start nats if it is enabled
  if (configService.natsEnabled) {
    const natsConfig = configService.natsConfig;
    app.connectMicroservice({
      transport: Transport.NATS,
      options: {
        url: `nats://${natsConfig.host}:${natsConfig.port}`,
        queue: 'main_service',
      },
    });

    await app.startAllMicroservices();
  }

  if (configService.documentationEnabled) {
    setupSwagger(app);
  }

  // Starts listening for shutdown hooks
  if (!configService.isDevelopment) {
    app.enableShutdownHooks();
  }

  const port = configService.appConfig.port;
  await app.listen(port);

  console.info(`server running on ${await app.getUrl()}`);

  return app;
}

void bootstrap();
