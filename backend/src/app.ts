import express from "express";
import helmet from "helmet";

import { prisma } from "./lib/prisma.js";
import {
  errorHandler,
  notFoundHandler
} from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { sessionMiddleware } from "./middleware/session.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { fieldRouter } from "./routes/field.routes.js";
import { managerRouter } from "./routes/manager.routes.js";

export const app = express();

app.set("trust proxy", 1);
app.use(requestIdMiddleware);
app.use(helmet());
app.use(express.json({ limit: "1mb", strict: false }));
app.use((request, response, next) => {
  response.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.set("Pragma", "no-cache");
  response.set("Expires", "0");
  next();
});
app.use(sessionMiddleware);

app.get("/api/health", async (request, response) => {
  void request;
  await prisma.$queryRaw`SELECT 1`;
  response.json({ data: { status: "ok" } });
});

app.use("/api/auth", authRouter);
app.use("/api/fields", fieldRouter);
app.use("/api/manager", managerRouter);
app.use("/api/admin", adminRouter);
app.use(notFoundHandler);
app.use(errorHandler);
