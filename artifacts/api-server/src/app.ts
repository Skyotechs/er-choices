import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { seedSpecialtyDefinitions } from "./routes/specialties";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const corsOriginsEnv = process.env.CORS_ORIGINS;
app.use(
  cors(
    corsOriginsEnv
      ? {
          origin: corsOriginsEnv.split(",").map((o) => o.trim()).filter(Boolean),
          credentials: true,
        }
      : undefined,
  ),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: "text/*", limit: "20mb" }));

app.use("/api", router);

seedSpecialtyDefinitions().catch((err) => {
  logger.error({ err }, "Failed to seed specialty definitions");
});

export default app;
