import { Client } from "pg";

export const postgresClient = new Client({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

export async function postgresConnect() {
  await postgresClient.connect();
  console.log("connected to postgresql");
}

export async function postgresDisconnect() {
  await postgresClient.end();
  console.log("disconnected to postgresql");
}
