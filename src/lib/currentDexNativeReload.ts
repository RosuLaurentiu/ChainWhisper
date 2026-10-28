// Public financial reservations only. Authentication and signing stay in the wallet consumer.
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
import type { CurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';
export const CURRENT_DEX_NATIVE_RELOAD_KEY = 'chainwhisper:dex:native-reload:v1';
export type CurrentDexNativeReloadRecord = Readonly<{ budget: CurrentNativeSwapCheckpoint; authentication: string }>;
export const readCurrentDexNativeReload = (storage: PendingStorage | null): CurrentDexNativeReloadRecord | null => {
  if(!storage)throw new Error('Native reload storage is unavailable.');
  let raw:string|null;
  try{raw=storage.getItem(CURRENT_DEX_NATIVE_RELOAD_KEY);}catch{throw new Error('Native reload storage is unavailable.');}
  if(raw===null)return null;
  try{const v=JSON.parse(raw);if(v&&Object.keys(v).sort().join(',')==='authentication,budget'&&/^0x[0-9a-f]{64}$/.test(v.authentication))return v;}catch{/* Keep unverified reservations. */}
  throw new Error('Native reload reservation is invalid; keep the pending action.');
};
export const writeCurrentDexNativeReload = (storage: PendingStorage | null, record: CurrentDexNativeReloadRecord) => {
  if(!storage)throw new Error('Native reload storage is unavailable.');const raw=JSON.stringify(record);
  try{storage.setItem(CURRENT_DEX_NATIVE_RELOAD_KEY,raw);}catch{throw new Error('Native reload reservation could not be saved.');}
  if(JSON.stringify(readCurrentDexNativeReload(storage))!==raw)throw new Error('Native reload reservation did not persist.');
};
