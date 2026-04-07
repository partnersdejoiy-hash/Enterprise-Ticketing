import app from "./app.js";

const isProduction = process.env.NODE_ENV === "production";
const port = isProduction
  ? Number(process.env.PORT ?? "8080")
  : Number(process.env.API_PORT ?? "3001");

app.listen(port, () => {
  console.log(`[server] API listening on port ${port} (${isProduction ? "production" : "development"})`);
});
