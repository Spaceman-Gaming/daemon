import { Keypair } from "@solana/web3.js";
import { ContextServerPostgres } from "./ContextServerPostgres";
import { Daemon } from "./daemon";
import { sleep } from "bun";

const db = new ContextServerPostgres(
  {
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres",
  },
  {
    embeddingModel: "openai",
    embeddingDimensions: 1536,
  }
);

await db.init();
db.start();
await sleep(1000);

const Bob = new Daemon("http://localhost:8080/sse");

const bobKey = Keypair.generate();

console.log("Initializing Daemon");
await Bob.init({
  character: {
    name: "Bob",
    bio: ["Bob is a human"],
    lore: ["Bob is a human"],
    pubkey: bobKey.publicKey.toBase58(),
  },
});
