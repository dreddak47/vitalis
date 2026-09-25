import type { ServerConfig } from "../config.js";
import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import type { Store } from "./types.js";

export function createStore(config: ServerConfig): Store {
  if (config.storeBackend === "supabase") {
    if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
      throw new Error(
        "STORE_BACKEND=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
      );
    }
    return new SupabaseStore(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return new MemoryStore();
}

export type { Store } from "./types.js";
export type { ExtractionJob, FactCollections, FactPatch } from "./types.js";
