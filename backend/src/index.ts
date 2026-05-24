import { loadEnv } from "./config/env.js";
import { serveApp } from "./app.js";

const env = loadEnv();
serveApp(env);
