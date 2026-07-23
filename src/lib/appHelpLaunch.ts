import { getAppHelpTopic } from './appHelp';

export type AppHelpOrigin = 'home' | 'chat' | 'otc' | 'portal' | 'treasury' | 'error';

export type AppHelpReason =
  | 'wallet-needed'
  | 'wrong-network'
  | 'privacy-locked'
  | 'account-needed'
  | 'funds-needed'
  | 'generic-error';

export type AppHelpLaunchContext = {
  origin: AppHelpOrigin;
  topicId?: string;
  reason?: AppHelpReason;
};

const APP_HELP_ORIGINS = new Set<AppHelpOrigin>([
  'home',
  'chat',
  'otc',
  'portal',
  'treasury',
  'error'
]);

const APP_HELP_REASONS = new Set<AppHelpReason>([
  'wallet-needed',
  'wrong-network',
  'privacy-locked',
  'account-needed',
  'funds-needed',
  'generic-error'
]);

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const normalizeAppHelpLaunchContext = (value: unknown): AppHelpLaunchContext | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const origin = normalizeString(record.origin) as AppHelpOrigin;
  if (!APP_HELP_ORIGINS.has(origin)) {
    return null;
  }

  const topicId = normalizeString(record.topicId);
  const reason = normalizeString(record.reason) as AppHelpReason;
  return {
    origin,
    ...(topicId && getAppHelpTopic(topicId) ? { topicId } : {}),
    ...(reason && APP_HELP_REASONS.has(reason) ? { reason } : {})
  };
};

export const getAppHelpReadinessTopicId = (reason?: AppHelpReason): string => {
  switch (reason) {
    case 'wallet-needed':
      return 'getting-started';
    case 'privacy-locked':
      return 'privacy-and-recovery';
    case 'account-needed':
      return 'owner-and-chainwhisper-accounts';
    case 'funds-needed':
      return 'account-funding';
    default:
      return 'readiness-troubleshooting';
  }
};
