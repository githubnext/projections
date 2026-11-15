import express from "express"; const app = express(); app.get("/real-commonjs", () => {}); const router = express.Router(); router.get("/router", () => {});
