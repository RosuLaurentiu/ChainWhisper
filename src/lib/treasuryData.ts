import { createPublicClient, defineChain, http } from 'viem';

type HexAddress = `0x${string}`;

type SnapshotNormalized = {
  activeGcoti: string;
  cotiInPool: string;
  maxApy: string;
  maxBoostApy: string;
  maxTotalApy: string;
};

type SnapshotScaled = {
  activeGcoti18: string;
  cotiInPool18: string;
  maxApyE8: string;
  maxBoostApyE8: string;
  maxTotalApyE8: string;
  [key: string]: string;
};

export type TreasuryOnchainReference = {
  alreadyExists?: boolean;
  blockNumber: string | null;
  contractAddress: string;
  explorerUrl: string | null;
  txHash: string | null;
};

export type TreasurySnapshot = {
  capturedAt: string;
  capturedAtUnix: number;
  day: number;
  isLive?: boolean;
  normalized: SnapshotNormalized;
  onchain: TreasuryOnchainReference | null;
  raw: Record<string, unknown>;
  scaled: SnapshotScaled;
  source: string;
};

export type TreasuryChartPoint = {
  activeGcoti: number;
  capturedAt: string;
  capturedAtUnix: number;
  cotiInPool: number;
  day: number;
  isLive: boolean;
  label: string;
  maxApy: number;
  maxBoostApy: number;
  maxTotalApy: number;
  onchain: TreasuryOnchainReference | null;
};

export type TreasurySourceKey = 'snapshotFeed' | 'onchainContract' | 'onchainTransactions' | 'liveTreasury';

export type TreasurySourceStatus = {
  count: number;
  error?: string;
  key: TreasurySourceKey;
  label: string;
  status: 'ready' | 'empty' | 'error';
};

export type DashboardData = {
  livePoint: TreasurySnapshot | null;
  sources: TreasurySourceStatus[];
  snapshots: TreasurySnapshot[];
};

type LiveTreasuryPayload = {
  totalCotiInPool: string;
  totalActiveGCoti: string;
  maxApy: string;
  maxBoostApy: string;
  maxTotalApy: string;
  [key: string]: string | number | boolean | null | undefined;
};

type ExplorerTransaction = {
  block_number?: number | string | null;
  decoded_input?: {
    parameters?: Array<{ name?: string; value?: string | null }>;
  } | null;
  hash?: string | null;
  method?: string | null;
  status?: string | null;
  timestamp?: string | null;
  to?: {
    hash?: string | null;
  } | null;
};

type OnchainContractSnapshot = {
  day: bigint;
  capturedAt: bigint;
  maxApyE8: bigint;
  maxBoostApyE8: bigint;
  maxTotalApyE8: bigint;
  cotiInPool: bigint;
  activeGcoti: bigint;
};

const DEFAULT_TREASURY_API_BASE_URL = 'https://treasury-app.coti.io';
const DEFAULT_TREASURY_TOTALS_PATH = '/get-total';
const DEFAULT_CONTRACT_ADDRESS = '0x25975eda0B0Ef3E5D86787Cb89D0A3468C17Bece' as HexAddress;
const DEFAULT_COTI_EXPLORER_URL = 'https://mainnet.cotiscan.io';
const DEFAULT_COTI_EXPLORER_API_URL = `${DEFAULT_COTI_EXPLORER_URL}/api/v2`;
const DEFAULT_COTI_RPC_URL = 'https://mainnet.coti.io/rpc';
const COTI_CHAIN_ID = 2632500;
const REQUIRED_FIELDS = ['totalCotiInPool', 'totalActiveGCoti', 'maxApy', 'maxBoostApy', 'maxTotalApy'] as const;
const DASHBOARD_DATA_CACHE_TTL_MS = 30_000;

let dashboardDataCache: { data: DashboardData; loadedAt: number } | null = null;
let dashboardDataRequest: Promise<DashboardData> | null = null;

const TREASURY_SNAPSHOT_STORE_ABI = [
  {
    inputs: [],
    name: 'getAllDays',
    outputs: [{ internalType: 'uint64[]', name: '', type: 'uint64[]' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'start', type: 'uint256' },
      { internalType: 'uint256', name: 'count', type: 'uint256' }
    ],
    name: 'getSnapshots',
    outputs: [
      {
        components: [
          { internalType: 'uint64', name: 'day', type: 'uint64' },
          { internalType: 'uint64', name: 'capturedAt', type: 'uint64' },
          { internalType: 'uint64', name: 'maxApyE8', type: 'uint64' },
          { internalType: 'uint64', name: 'maxBoostApyE8', type: 'uint64' },
          { internalType: 'uint64', name: 'maxTotalApyE8', type: 'uint64' },
          { internalType: 'uint96', name: 'cotiInPool', type: 'uint96' },
          { internalType: 'uint96', name: 'activeGcoti', type: 'uint96' }
        ],
        internalType: 'struct TreasurySnapshotStore.Snapshot[]',
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

const cotiChain = defineChain({
  id: COTI_CHAIN_ID,
  name: 'COTI',
  nativeCurrency: {
    name: 'COTI',
    symbol: 'COTI',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [DEFAULT_COTI_RPC_URL]
    }
  },
  blockExplorers: {
    default: {
      name: 'COTI Scan',
      url: DEFAULT_COTI_EXPLORER_URL
    }
  }
});

export async function loadDashboardData({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<DashboardData> {
  const now = Date.now();
  if (!forceRefresh && dashboardDataCache && now - dashboardDataCache.loadedAt < DASHBOARD_DATA_CACHE_TTL_MS) {
    return dashboardDataCache.data;
  }

  if (!forceRefresh && dashboardDataRequest) {
    return dashboardDataRequest;
  }

  dashboardDataRequest = fetchDashboardData()
    .then((data) => {
      dashboardDataCache = { data, loadedAt: Date.now() };
      return data;
    })
    .finally(() => {
      dashboardDataRequest = null;
    });

  return dashboardDataRequest;
}

export function preloadDashboardData(): Promise<DashboardData> {
  return loadDashboardData().catch((error) => {
    console.warn('[dashboard] preload failed', error);
    throw error;
  });
}

async function fetchDashboardData(): Promise<DashboardData> {
  const snapshotUrl = resolveSnapshotUrl();
  const treasuryUrl = resolveTreasuryUrl();
  const onchainConfig = resolveOnchainConfig();

  const sources = [
    {
      key: 'snapshotFeed',
      label: 'snapshot feed',
      promise: loadSnapshotFeed(snapshotUrl)
    },
    {
      key: 'onchainContract',
      label: 'onchain contract history',
      promise: loadOnchainSnapshots(onchainConfig)
    },
    {
      key: 'onchainTransactions',
      label: 'onchain transaction history',
      promise: loadOnchainTransactionSnapshots(onchainConfig)
    },
    {
      key: 'liveTreasury',
      label: 'live treasury',
      promise: loadLiveTreasuryPoint(treasuryUrl)
    }
  ] as const;

  const results = await Promise.allSettled(sources.map((source) => source.promise));
  let feedSnapshots: TreasurySnapshot[] = [];
  let onchainSnapshots: TreasurySnapshot[] = [];
  let onchainTransactionSnapshots: TreasurySnapshot[] = [];
  let livePoint: TreasurySnapshot | null = null;
  const sourceStatuses: TreasurySourceStatus[] = [];

  results.forEach((result, index) => {
    const source = sources[index];

    if (result.status === 'fulfilled') {
      const resolvedValue = result.value;
      let count = 0;
      if (source.label === 'snapshot feed') {
        feedSnapshots = resolvedValue as TreasurySnapshot[];
        count = feedSnapshots.length;
      } else if (source.label === 'onchain contract history') {
        onchainSnapshots = resolvedValue as TreasurySnapshot[];
        count = onchainSnapshots.length;
      } else if (source.label === 'onchain transaction history') {
        onchainTransactionSnapshots = resolvedValue as TreasurySnapshot[];
        count = onchainTransactionSnapshots.length;
      } else {
        livePoint = resolvedValue as TreasurySnapshot;
        count = livePoint ? 1 : 0;
      }
      sourceStatuses.push({
        key: source.key,
        label: source.label,
        status: count > 0 ? 'ready' : 'empty',
        count
      });
      return;
    }

    console.warn(`[snapshot-history] ${source.label} load failed`, result.reason);
    sourceStatuses.push({
      key: source.key,
      label: source.label,
      status: 'error',
      count: 0,
      error: toErrorMessage(result.reason)
    });
  });

  const snapshots = mergeSnapshots(feedSnapshots, onchainSnapshots, onchainTransactionSnapshots);

  return { livePoint, snapshots, sources: sourceStatuses };
}

export function toChartPoint(snapshot: TreasurySnapshot, label: string): TreasuryChartPoint {
  return {
    activeGcoti: Number(snapshot.normalized.activeGcoti),
    capturedAt: snapshot.capturedAt,
    capturedAtUnix: snapshot.capturedAtUnix,
    cotiInPool: Number(snapshot.normalized.cotiInPool),
    day: snapshot.day,
    isLive: snapshot.isLive === true,
    label,
    maxApy: Number(snapshot.normalized.maxApy),
    maxBoostApy: Number(snapshot.normalized.maxBoostApy),
    maxTotalApy: Number(snapshot.normalized.maxTotalApy),
    onchain: snapshot.onchain
  };
}

export function getOnchainContractAddress(): string {
  return resolveOnchainConfig().contractAddress;
}

export function getOnchainContractExplorerUrl(): string | null {
  const { contractAddress, cotiExplorerUrl } = resolveOnchainConfig();
  if (!contractAddress || !cotiExplorerUrl) {
    return null;
  }

  return `${cotiExplorerUrl.replace(/\/$/, '')}/address/${contractAddress}`;
}

function resolveSnapshotUrl(): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, '');

  if (apiBase) {
    return `${apiBase}/api/snapshots`;
  }

  return import.meta.env.VITE_SNAPSHOT_URL?.trim() || '/snapshots.json';
}

function resolveTreasuryUrl(): string {
  const baseUrl = import.meta.env.VITE_TREASURY_API_BASE_URL?.trim() || DEFAULT_TREASURY_API_BASE_URL;
  const path = import.meta.env.VITE_TREASURY_TOTALS_PATH?.trim() || DEFAULT_TREASURY_TOTALS_PATH;
  return new URL(path, baseUrl).toString();
}

function resolveOnchainConfig() {
  const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS?.trim();

  return {
    contractAddress: isHexAddress(contractAddress) ? contractAddress : DEFAULT_CONTRACT_ADDRESS,
    cotiExplorerApiUrl: import.meta.env.VITE_COTI_EXPLORER_API_URL?.trim() || DEFAULT_COTI_EXPLORER_API_URL,
    cotiExplorerUrl: import.meta.env.VITE_COTI_EXPLORER_URL?.trim() || DEFAULT_COTI_EXPLORER_URL,
    cotiRpcUrl: import.meta.env.VITE_COTI_RPC_URL?.trim() || DEFAULT_COTI_RPC_URL
  };
}

async function loadSnapshotFeed(snapshotUrl: string): Promise<TreasurySnapshot[]> {
  const response = await fetch(snapshotUrl, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((snapshot) => normalizeFeedSnapshot(snapshot as TreasurySnapshot))
    .filter((snapshot): snapshot is TreasurySnapshot => Boolean(snapshot))
    .sort(sortSnapshots);
}

async function loadOnchainSnapshots({
  contractAddress,
  cotiExplorerUrl,
  cotiRpcUrl
}: ReturnType<typeof resolveOnchainConfig>): Promise<TreasurySnapshot[]> {
  if (!contractAddress || !cotiRpcUrl) {
    return [];
  }

  const publicClient = createPublicClient({
    chain: cotiChain,
    transport: http(cotiRpcUrl)
  });

  const dayIndex = (await publicClient.readContract({
    address: contractAddress,
    abi: TREASURY_SNAPSHOT_STORE_ABI,
    functionName: 'getAllDays'
  })) as bigint[];

  if (!Array.isArray(dayIndex) || dayIndex.length === 0) {
    return [];
  }

  const snapshots = (await publicClient.readContract({
    address: contractAddress,
    abi: TREASURY_SNAPSHOT_STORE_ABI,
    functionName: 'getSnapshots',
    args: [0n, BigInt(dayIndex.length)]
  })) as OnchainContractSnapshot[];

  return (snapshots || [])
    .map((snapshot) => mapOnchainSnapshot(snapshot, { contractAddress, cotiExplorerUrl }))
    .filter((snapshot): snapshot is TreasurySnapshot => Boolean(snapshot))
    .sort(sortSnapshots);
}

async function loadOnchainTransactionSnapshots({
  contractAddress,
  cotiExplorerApiUrl,
  cotiExplorerUrl
}: ReturnType<typeof resolveOnchainConfig>): Promise<TreasurySnapshot[]> {
  if (!contractAddress || !cotiExplorerApiUrl) {
    return [];
  }

  const contractAddressLower = contractAddress.toLowerCase();
  const explorerApiBaseUrl = cotiExplorerApiUrl.replace(/\/$/, '');
  const transactions: ExplorerTransaction[] = [];
  let nextPageParams: Record<string, string | number> | null = null;

  do {
    const requestUrl = new URL(`${explorerApiBaseUrl}/addresses/${contractAddress}/transactions`);

    if (nextPageParams) {
      Object.entries(nextPageParams).forEach(([key, value]) => {
        requestUrl.searchParams.set(key, String(value));
      });
    }

    const response = await fetch(requestUrl.toString(), {
      headers: {
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      items?: ExplorerTransaction[];
      next_page_params?: Record<string, string | number> | null;
    };
    transactions.push(...(Array.isArray(payload?.items) ? payload.items : []));
    nextPageParams = payload?.next_page_params ?? null;
  } while (nextPageParams);

  return transactions
    .filter((transaction) => isSnapshotTransaction(transaction, contractAddressLower))
    .map((transaction) => mapSnapshotTransaction(transaction, { contractAddress, cotiExplorerUrl }))
    .filter((snapshot): snapshot is TreasurySnapshot => Boolean(snapshot))
    .sort(sortSnapshots);
}

function mapOnchainSnapshot(
  snapshot: OnchainContractSnapshot,
  { contractAddress, cotiExplorerUrl }: { contractAddress: string; cotiExplorerUrl: string }
): TreasurySnapshot | null {
  const day = Number(snapshot?.day);
  const capturedAtUnix = Number(snapshot?.capturedAt);
  const cotiInPool18 = toBigInt(snapshot?.cotiInPool);
  const activeGcoti18 = toBigInt(snapshot?.activeGcoti);
  const maxApyE8 = toBigInt(snapshot?.maxApyE8);
  const maxBoostApyE8 = toBigInt(snapshot?.maxBoostApyE8);
  const maxTotalApyE8 = toBigInt(snapshot?.maxTotalApyE8);

  if (
    !Number.isFinite(day) ||
    !Number.isFinite(capturedAtUnix) ||
    cotiInPool18 === null ||
    activeGcoti18 === null ||
    maxApyE8 === null ||
    maxBoostApyE8 === null ||
    maxTotalApyE8 === null
  ) {
    return null;
  }

  const explorerBaseUrl = cotiExplorerUrl.replace(/\/$/, '');

  return {
    capturedAt: new Date(capturedAtUnix * 1000).toISOString(),
    capturedAtUnix,
    day,
    normalized: {
      activeGcoti: formatScaled(activeGcoti18, 18),
      cotiInPool: formatScaled(cotiInPool18, 18),
      maxApy: formatScaled(maxApyE8, 8),
      maxBoostApy: formatScaled(maxBoostApyE8, 8),
      maxTotalApy: formatScaled(maxTotalApyE8, 8)
    },
    onchain: {
      alreadyExists: true,
      blockNumber: null,
      contractAddress,
      explorerUrl: `${explorerBaseUrl}/address/${contractAddress}`,
      txHash: null
    },
    raw: {
      totalActiveGCoti: formatScaled(activeGcoti18, 18),
      totalCotiInPool: formatScaled(cotiInPool18, 18),
      maxApy: formatScaled(maxApyE8, 8),
      maxBoostApy: formatScaled(maxBoostApyE8, 8),
      maxTotalApy: formatScaled(maxTotalApyE8, 8)
    },
    scaled: {
      activeGcoti18: activeGcoti18.toString(),
      cotiInPool18: cotiInPool18.toString(),
      maxApyE8: maxApyE8.toString(),
      maxBoostApyE8: maxBoostApyE8.toString(),
      maxTotalApyE8: maxTotalApyE8.toString()
    },
    source: 'onchain-rpc'
  };
}

async function loadLiveTreasuryPoint(treasuryUrl: string): Promise<TreasurySnapshot> {
  const response = await fetch(treasuryUrl, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  const payload = (await response.json()) as LiveTreasuryPayload;
  for (const requiredField of REQUIRED_FIELDS) {
    if (!(requiredField in payload)) {
      throw new Error(`Treasury API response is missing ${requiredField}`);
    }
  }

  return buildLivePoint(payload, new Date(), treasuryUrl);
}

function normalizeFeedSnapshot(snapshot: TreasurySnapshot): TreasurySnapshot | null {
  const day = Number(snapshot?.day);
  if (!Number.isFinite(day)) {
    return null;
  }

  return {
    ...snapshot,
    day,
    source: snapshot.source || 'snapshot-feed'
  };
}

function buildLivePoint(payload: LiveTreasuryPayload, timestamp: Date, source: string): TreasurySnapshot {
  return {
    capturedAt: timestamp.toISOString(),
    capturedAtUnix: toUnixSeconds(timestamp),
    day: toDayKey(timestamp),
    isLive: true,
    normalized: {
      activeGcoti: String(payload.totalActiveGCoti),
      cotiInPool: String(payload.totalCotiInPool),
      maxApy: String(payload.maxApy),
      maxBoostApy: String(payload.maxBoostApy),
      maxTotalApy: String(payload.maxTotalApy)
    },
    onchain: null,
    raw: payload,
    scaled: {
      activeGcoti18: parseDecimalToBigInt(payload.totalActiveGCoti, 18).toString(),
      cotiInPool18: parseDecimalToBigInt(payload.totalCotiInPool, 18).toString(),
      maxApyE8: parseDecimalToBigInt(payload.maxApy, 8).toString(),
      maxBoostApyE8: parseDecimalToBigInt(payload.maxBoostApy, 8).toString(),
      maxTotalApyE8: parseDecimalToBigInt(payload.maxTotalApy, 8).toString()
    },
    source
  };
}

function isSnapshotTransaction(transaction: ExplorerTransaction, contractAddressLower: string): boolean {
  return (
    transaction?.status === 'ok' &&
    transaction?.method === 'saveSnapshot' &&
    transaction?.to?.hash?.toLowerCase?.() === contractAddressLower &&
    Array.isArray(transaction?.decoded_input?.parameters)
  );
}

function mapSnapshotTransaction(
  transaction: ExplorerTransaction,
  { contractAddress, cotiExplorerUrl }: { contractAddress: string; cotiExplorerUrl: string }
): TreasurySnapshot | null {
  const parameters = toParameterMap(transaction?.decoded_input?.parameters);
  const day = toFiniteNumber(parameters.day);
  const capturedAtUnix = toFiniteNumber(parameters.capturedAt) ?? parseTimestampToUnix(transaction?.timestamp);
  const cotiInPool18 = toBigInt(parameters.cotiInPool);
  const activeGcoti18 = toBigInt(parameters.activeGcoti);
  const maxApyE8 = toBigInt(parameters.maxApyE8);
  const maxBoostApyE8 = toBigInt(parameters.maxBoostApyE8);
  const maxTotalApyE8 = toBigInt(parameters.maxTotalApyE8);

  if (
    !Number.isFinite(day) ||
    !Number.isFinite(capturedAtUnix) ||
    cotiInPool18 === null ||
    activeGcoti18 === null ||
    maxApyE8 === null ||
    maxBoostApyE8 === null ||
    maxTotalApyE8 === null
  ) {
    return null;
  }

  const txHash = transaction?.hash || null;
  const explorerBaseUrl = cotiExplorerUrl.replace(/\/$/, '');
  const resolvedCapturedAtUnix = capturedAtUnix as number;
  const resolvedDay = day as number;

  return {
    capturedAt: new Date(resolvedCapturedAtUnix * 1000).toISOString(),
    capturedAtUnix: resolvedCapturedAtUnix,
    day: resolvedDay,
    normalized: {
      activeGcoti: formatScaled(activeGcoti18, 18),
      cotiInPool: formatScaled(cotiInPool18, 18),
      maxApy: formatScaled(maxApyE8, 8),
      maxBoostApy: formatScaled(maxBoostApyE8, 8),
      maxTotalApy: formatScaled(maxTotalApyE8, 8)
    },
    onchain: {
      alreadyExists: true,
      blockNumber: transaction?.block_number != null ? String(transaction.block_number) : null,
      contractAddress,
      explorerUrl: txHash ? `${explorerBaseUrl}/tx/${txHash}` : null,
      txHash
    },
    raw: {
      totalActiveGCoti: formatScaled(activeGcoti18, 18),
      totalCotiInPool: formatScaled(cotiInPool18, 18),
      maxApy: formatScaled(maxApyE8, 8),
      maxBoostApy: formatScaled(maxBoostApyE8, 8),
      maxTotalApy: formatScaled(maxTotalApyE8, 8)
    },
    scaled: {
      activeGcoti18: activeGcoti18.toString(),
      cotiInPool18: cotiInPool18.toString(),
      maxApyE8: maxApyE8.toString(),
      maxBoostApyE8: maxBoostApyE8.toString(),
      maxTotalApyE8: maxTotalApyE8.toString()
    },
    source: 'onchain'
  };
}

function mergeSnapshots(...snapshotLists: TreasurySnapshot[][]): TreasurySnapshot[] {
  const mergedByDay = new Map<number, TreasurySnapshot>();

  snapshotLists
    .flat()
    .filter(Boolean)
    .sort(sortSnapshots)
    .forEach((snapshot) => {
      const existing = mergedByDay.get(snapshot.day);
      if (!existing) {
        mergedByDay.set(snapshot.day, snapshot);
        return;
      }

      const mergedOnchain =
        snapshot.onchain || existing.onchain
          ? {
              alreadyExists: snapshot.onchain?.alreadyExists ?? existing.onchain?.alreadyExists,
              blockNumber: snapshot.onchain?.blockNumber ?? existing.onchain?.blockNumber ?? null,
              contractAddress: snapshot.onchain?.contractAddress ?? existing.onchain?.contractAddress ?? '',
              explorerUrl: snapshot.onchain?.explorerUrl ?? existing.onchain?.explorerUrl ?? null,
              txHash: snapshot.onchain?.txHash ?? existing.onchain?.txHash ?? null
            }
          : null;

      mergedByDay.set(snapshot.day, {
        ...existing,
        ...snapshot,
        normalized: {
          ...existing.normalized,
          ...snapshot.normalized
        },
        onchain: mergedOnchain,
        raw: {
          ...(existing.raw || {}),
          ...(snapshot.raw || {})
        },
        scaled: {
          ...(existing.scaled || {}),
          ...(snapshot.scaled || {})
        }
      });
    });

  return [...mergedByDay.values()].sort(sortSnapshots);
}

function toParameterMap(parameters?: Array<{ name?: string; value?: string | null }>): Record<string, string | null> {
  return (parameters || []).reduce<Record<string, string | null>>((result, parameter) => {
    if (parameter?.name) {
      result[parameter.name] = parameter.value ?? null;
    }

    return result;
  }, {});
}

function parseTimestampToUnix(value?: string | null): number | null {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBigInt(value: string | number | bigint | null | undefined): bigint | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toDayKey(timestamp: Date): number {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getUTCDate()).padStart(2, '0');
  return Number(`${year}${month}${day}`);
}

function toUnixSeconds(timestamp: Date): number {
  return Math.floor(timestamp.getTime() / 1000);
}

function parseDecimalToBigInt(value: string | number, decimals: number): bigint {
  const stringValue = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(stringValue)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const [wholePart, fractionalPart = ''] = stringValue.split('.');
  const normalizedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(`${wholePart}${normalizedFractional}`);
}

function formatScaled(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function sortSnapshots(left: TreasurySnapshot, right: TreasurySnapshot): number {
  return Number(left.day) - Number(right.day);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHexAddress(value: string | undefined): value is HexAddress {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}
