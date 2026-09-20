import type { CreateGameInput, GameConfig } from "@/lib/types";

const DATABASE_NAME = "pons-game-studio-create-drafts";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "drafts";
const LOCAL_STORAGE_PREFIX = "pons-game-studio:create-draft:v2:";
const SESSION_DRAFT_ID_KEY = "pons-game-studio:create-draft-id:v2";
const LEGACY_LOCAL_STORAGE_KEY = "pons-game-studio:create-draft:v1";
const DRAFT_VERSION = 2;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const INDEXED_DB_TIMEOUT_MS = 2_000;

export type CreateDraftPayload = {
  input: CreateGameInput;
  imageDataUrl: string;
  config: GameConfig | null;
  previewToken: string;
  previewHtml: string;
  step: number;
};

type StoredCreateDraft = CreateDraftPayload & {
  version: typeof DRAFT_VERSION;
  updatedAt: number;
  expiresAt: number;
};

export type CreateDraftCommit = {
  indexedDb: boolean;
  localStorage: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreateGameInput(value: unknown): value is CreateGameInput {
  if (!isRecord(value)) return false;
  return ["name", "ticker", "description", "prompt", "visualStyle", "difficulty", "category"].every((key) => typeof value[key] === "string")
    && ["RUNNER", "FLAPPY", "SHOOTER"].includes(String(value.category))
    && ["EASY", "NORMAL", "HARD"].includes(String(value.difficulty))
    && (value.developerBuyEth === undefined || typeof value.developerBuyEth === "string")
    && (value.xUrl === undefined || typeof value.xUrl === "string")
    && (value.websiteUrl === undefined || typeof value.websiteUrl === "string");
}

function isGameConfig(value: unknown): value is GameConfig {
  if (!isRecord(value) || !isRecord(value.palette) || !isRecord(value.character) || !isRecord(value.obstacle) || !isRecord(value.collectible)) return false;
  const palette = value.palette;
  const character = value.character;
  const obstacle = value.obstacle;
  const collectible = value.collectible;
  return ["RUNNER", "FLAPPY", "SHOOTER"].includes(String(value.category))
    && ["title", "instructions", "story"].every((key) => typeof value[key] === "string")
    && ["arcade", "soft", "silent"].includes(String(value.soundStyle))
    && ["background", "primary", "accent", "danger", "text"].every((key) => typeof palette[key] === "string")
    && typeof character.shape === "string" && typeof character.label === "string"
    && typeof obstacle.shape === "string" && typeof obstacle.label === "string"
    && typeof collectible.shape === "string" && typeof collectible.label === "string"
    && ["EASY", "NORMAL", "HARD"].includes(String(value.difficulty))
    && typeof value.speed === "number" && Number.isFinite(value.speed)
    && typeof value.seed === "number" && Number.isFinite(value.seed);
}

function isStoredCreateDraft(value: unknown): value is StoredCreateDraft {
  if (!isRecord(value)) return false;
  return value.version === DRAFT_VERSION
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
    && typeof value.imageDataUrl === "string"
    && typeof value.previewToken === "string"
    && typeof value.previewHtml === "string"
    && typeof value.step === "number" && Number.isFinite(value.step)
    && isCreateGameInput(value.input)
    && (value.config === null || isGameConfig(value.config))
    && ((value.config === null && value.previewToken === "" && value.previewHtml === "")
      || (value.config !== null && value.previewToken !== "" && value.previewHtml !== ""));
}

function localStorageKey(draftId: string) {
  return `${LOCAL_STORAGE_PREFIX}${draftId}`;
}

function settleWithin<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, INDEXED_DB_TIMEOUT_MS);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) database.createObjectStore(OBJECT_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked."));
    } catch (error) {
      reject(error);
    }
  });
}

async function readIndexedDb(draftId: string): Promise<unknown | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      database.close();
      callback();
    };
    try {
      const transaction = database.transaction(OBJECT_STORE_NAME, "readonly");
      const request = transaction.objectStore(OBJECT_STORE_NAME).get(draftId);
      let result: unknown = null;
      request.onsuccess = () => { result = request.result ?? null; };
      request.onerror = () => finish(() => reject(request.error || new Error("IndexedDB draft read failed.")));
      transaction.oncomplete = () => finish(() => resolve(result));
      transaction.onerror = () => finish(() => reject(transaction.error || new Error("IndexedDB draft transaction failed.")));
      transaction.onabort = () => finish(() => reject(transaction.error || new Error("IndexedDB draft transaction was aborted.")));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function writeIndexedDb(draftId: string, draft: StoredCreateDraft): Promise<boolean> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result);
      };
      try {
        const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
        transaction.objectStore(OBJECT_STORE_NAME).put(draft, draftId);
        transaction.oncomplete = () => finish(true);
        transaction.onerror = () => finish(false);
        transaction.onabort = () => finish(false);
      } catch {
        finish(false);
      }
    });
  } catch {
    return false;
  }
}

async function deleteIndexedDb(draftId: string): Promise<boolean> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result);
      };
      try {
        const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
        transaction.objectStore(OBJECT_STORE_NAME).delete(draftId);
        transaction.oncomplete = () => finish(true);
        transaction.onerror = () => finish(false);
        transaction.onabort = () => finish(false);
      } catch {
        finish(false);
      }
    });
  } catch {
    return false;
  }
}

async function purgeStaleIndexedDb(now: number): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      database.close();
      callback();
    };
    try {
      const transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
      const request = transaction.objectStore(OBJECT_STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!isStoredCreateDraft(cursor.value) || cursor.value.expiresAt <= now) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => finish(() => reject(request.error || new Error("IndexedDB cleanup failed.")));
      transaction.oncomplete = () => finish(resolve);
      transaction.onerror = () => finish(() => reject(transaction.error || new Error("IndexedDB cleanup transaction failed.")));
      transaction.onabort = () => finish(() => reject(transaction.error || new Error("IndexedDB cleanup transaction was aborted.")));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function readLocalStorage(draftId: string): unknown | null {
  try {
    const serialized = window.localStorage.getItem(localStorageKey(draftId));
    return serialized ? JSON.parse(serialized) : null;
  } catch {
    deleteLocalStorage(draftId);
    return null;
  }
}

function writeLocalStorage(draftId: string, draft: StoredCreateDraft): boolean {
  try {
    window.localStorage.setItem(localStorageKey(draftId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function deleteLocalStorage(draftId: string): boolean {
  try {
    window.localStorage.removeItem(localStorageKey(draftId));
    return true;
  } catch {
    return false;
  }
}

function purgeStaleLocalStorage(now: number) {
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LOCAL_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      try {
        const serialized = window.localStorage.getItem(key);
        const value: unknown = serialized ? JSON.parse(serialized) : null;
        if (!isStoredCreateDraft(value) || value.expiresAt <= now) window.localStorage.removeItem(key);
      } catch {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage is an optional fallback; IndexedDB remains the primary store.
  }
}

export function getOrCreateTabDraftId(): string | null {
  try {
    const existingDraftId = window.sessionStorage.getItem(SESSION_DRAFT_ID_KEY);
    if (existingDraftId) return existingDraftId;
    const draftId = window.crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_DRAFT_ID_KEY, draftId);
    return window.sessionStorage.getItem(SESSION_DRAFT_ID_KEY) === draftId ? draftId : null;
  } catch {
    return null;
  }
}

export function forgetTabDraftId(draftId: string) {
  try {
    if (window.sessionStorage.getItem(SESSION_DRAFT_ID_KEY) === draftId) window.sessionStorage.removeItem(SESSION_DRAFT_ID_KEY);
  } catch {
    // A blocked session store already prevents OAuth draft recovery.
  }
}

export async function persistCreateDraft(draftId: string, payload: CreateDraftPayload): Promise<CreateDraftCommit> {
  const now = Date.now();
  const draft: StoredCreateDraft = {
    ...payload,
    version: DRAFT_VERSION,
    updatedAt: now,
    expiresAt: now + DRAFT_TTL_MS,
  };
  const localStorage = writeLocalStorage(draftId, draft);
  const indexedDb = await settleWithin(writeIndexedDb(draftId, draft), false);
  return { indexedDb, localStorage };
}

export async function restoreCreateDraft(draftId: string): Promise<CreateDraftPayload | null> {
  const now = Date.now();
  purgeStaleLocalStorage(now);
  void purgeStaleIndexedDb(now).catch(() => undefined);
  const localValue = readLocalStorage(draftId);
  const localDraft = isStoredCreateDraft(localValue) && localValue.expiresAt > now ? localValue : null;
  if (localValue !== null && !localDraft) deleteLocalStorage(draftId);

  // OAuth recovery must not wait on an IndexedDB open that a browser can leave
  // pending indefinitely. Every sign-in checkpoint is synchronously mirrored to
  // localStorage, so use it immediately and keep IndexedDB as the larger fallback.
  const indexedValue = localDraft ? null : await settleWithin(readIndexedDb(draftId), null);
  const indexedDraft = isStoredCreateDraft(indexedValue) && indexedValue.expiresAt > now ? indexedValue : null;
  if (indexedValue !== null && !indexedDraft) void deleteIndexedDb(draftId);

  const restored = localDraft || indexedDraft;
  if (!restored) return null;
  return {
    input: restored.input,
    imageDataUrl: restored.imageDataUrl,
    config: restored.config,
    previewToken: restored.previewToken,
    previewHtml: restored.previewHtml,
    step: restored.step,
  };
}

export async function clearCreateDraft(draftId: string): Promise<CreateDraftCommit> {
  const localStorage = deleteLocalStorage(draftId);
  const indexedDb = await settleWithin(deleteIndexedDb(draftId), false);
  return { indexedDb, localStorage };
}
