import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

const bucket = config.SUPABASE_STORAGE_BUCKET;

// build the client on first use, not at import: createClient pulls in the
// realtime websocket and bails on node < 22, which would crash anything that
// only imports this module to reach the routes (e.g. tests).
let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!client) client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  return client;
}

export async function uploadFile(
  resourceId: string,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const storagePath = `${resourceId}/${filename}`;

  const { error } = await supabase().storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  return storagePath;
}

export async function downloadFile(
  storagePath: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const { data, error } = await supabase().storage
    .from(bucket)
    .download(storagePath);

  if (error) throw new Error(`Download failed: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const mimeType = data.type || "application/octet-stream";

  return { buffer, mimeType };
}

export async function deleteFile(storagePath: string): Promise<void> {
  const { error } = await supabase().storage
    .from(bucket)
    .remove([storagePath]);

  if (error) throw new Error(`Delete failed: ${error.message}`);
}
