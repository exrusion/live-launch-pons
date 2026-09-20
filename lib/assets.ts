import type pg from "pg";
import { sha256 } from "@/lib/security";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function detectImage(buffer: Buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { mime: "image/png", width, height };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", width: null, height: null };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", width: null, height: null };
  throw new Error("UNSUPPORTED_IMAGE_TYPE");
}

export function decodeImageDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("INVALID_IMAGE_DATA");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length < 32 || buffer.length > MAX_IMAGE_BYTES) throw new Error("INVALID_IMAGE_SIZE");
  const detected = detectImage(buffer);
  if (detected.mime !== match[1]) throw new Error("IMAGE_MIME_MISMATCH");
  if (detected.width && detected.height && (detected.width > 4096 || detected.height > 4096 || detected.width * detected.height > 12_000_000)) throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
  return { buffer, sha256: sha256(buffer), ...detected };
}

export async function saveTokenImage(client: pg.PoolClient, input: { userId: string; gameId: string; dataUrl: string }) {
  const image = decodeImageDataUrl(input.dataUrl);
  const storageKey = `images/${input.gameId}/${image.sha256}`;
  const result = await client.query<{ id: string }>(
    `INSERT INTO assets(owner_user_id,game_id,kind,storage_key,sha256,mime_type,byte_size,width,height,data,immutable)
     VALUES($1,$2,'TOKEN_IMAGE',$3,$4,$5,$6,$7,$8,$9,true)
     RETURNING id`,
    [input.userId, input.gameId, storageKey, image.sha256, image.mime, image.buffer.length, image.width, image.height, image.buffer],
  );
  return result.rows[0].id;
}
