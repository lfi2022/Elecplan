import { readFile, writeFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
const [keyFile, payloadFile, output] = process.argv.slice(2);
if (!keyFile || !payloadFile || !output)
  throw new Error(
    "Usage : npm run license:sign -- private.pem payload.json licence.json",
  );
const payload = await readFile(payloadFile),
  key = createPrivateKey(await readFile(keyFile));
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("Clé Ed25519 requise.");
await writeFile(
  output,
  JSON.stringify(
    {
      payload: payload.toString("base64"),
      signature: sign(null, payload, key).toString("base64"),
    },
    null,
    2,
  ),
);
