import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  HOST: process.env.HOST ?? "0.0.0.0",
  AWID: process.env.AWID ?? "0123456789abcdef0123456789abcdef",
  MONGODB_URI: process.env.MONGODB_URI?.trim() || "",
  STALE_THRESHOLD_MINUTES: Number(process.env.STALE_THRESHOLD_MINUTES ?? 60)
};
