import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './main';

/** Builds the API once per serverless instance and returns an Express handler. */
export async function createServer() {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  return server;
}
