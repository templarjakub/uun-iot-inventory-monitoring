import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { env } from "./common/config/env";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });

  app.enableCors({ origin: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("BIOT Automatic Inventory Monitoring – uuApp Backend (Tým 4)")
    .setDescription(
      "Enterprise NestJS + Mongoose implementace backendu podle `BIOT DL Application Model - Tým 4` (10 Commands, 5 Mongoose Schemas & DAOs, Application Profiles)."
    )
    .setVersion("1.0.0")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: {
      docExpansion: "list",
      persistAuthorization: true
    }
  });

  // Redirect root '/' to '/docs'
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/", (_req: unknown, res: any) => {
    res.redirect("/docs");
  });

  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT, env.HOST);
  console.log(`🚀 BIOT NestJS + Mongoose Backend running at http://localhost:${env.PORT}`);
  console.log(`📘 Interactive Swagger UI available at http://localhost:${env.PORT}/docs`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("Failed to start BIOT NestJS Backend:", err);
    process.exit(1);
  });
}
