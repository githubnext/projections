import express, { Router as makeRouter } from "express"; import fastify from "fastify";
function handler() {} const app = express(); const router = makeRouter(); const server = fastify();
app.get("/users", handler); router.route("/orders").get(handler).post(handler);
server.route({ method: ["GET", "PUT"], url: "/items", handler }); server.get("/health", handler);
app.use("/api", router); const unrelated = { get(path: string, fn: Function) {} }; unrelated.get("/decoy", handler);
