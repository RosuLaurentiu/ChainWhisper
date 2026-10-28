import path from 'node:path';

export type RealWalletProfile = 'alice' | 'bob' | 'alice-restored';
export type RealWalletProfileRole = 'alice' | 'bob';
export const ALICE_RESTORED_PROFILE_ACK = 'SAME_TEST_EOA_MANUAL_RESTORE_ONLY';

export type CanonicalProfileDirectoryLayout = {
  extensionDir: string;
  profiles: Readonly<
    Record<'alice' | 'bob', string> & Partial<Record<'alice-restored', string>>
  >;
  workspace: string;
};

export type ProfileLaunchReservation = Readonly<{
  canonicalDirectory: string;
  profile: RealWalletProfile;
  role: RealWalletProfileRole;
  token: symbol;
}>;

const canonicalIdentity = (value: string): string => {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const isSameOrInside = (candidate: string, parent: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const assertAbsoluteCanonicalDirectory = (value: string, label: string): void => {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`${label} must be a canonical absolute directory path.`);
  }
};

export const roleForRealWalletProfile = (
  profile: RealWalletProfile
): RealWalletProfileRole => (profile === 'bob' ? 'bob' : 'alice');

export const resolveProfileLaunchRequest = ({
  aliceRestoredProfileAck,
  profile,
  profiles
}: {
  aliceRestoredProfileAck?: string;
  profile: RealWalletProfile;
  profiles: Readonly<
    Record<'alice' | 'bob', string> & Partial<Record<'alice-restored', string>>
  >;
}): { profileDirectory: string; role: RealWalletProfileRole } => {
  const profileDirectory = profiles[profile];
  if (!profileDirectory) {
    throw new Error('The requested optional restored wallet profile directory is unavailable.');
  }
  if (
    profile === 'alice-restored' &&
    aliceRestoredProfileAck !== ALICE_RESTORED_PROFILE_ACK
  ) {
    throw new Error(
      `Restored-profile launch requires the exact public acknowledgement ${ALICE_RESTORED_PROFILE_ACK}.`
    );
  }
  return { profileDirectory, role: roleForRealWalletProfile(profile) };
};

export const assertCanonicalProfileDirectoryLayout = ({
  extensionDir,
  profiles,
  workspace
}: CanonicalProfileDirectoryLayout): void => {
  assertAbsoluteCanonicalDirectory(workspace, 'ChainWhisper workspace');
  assertAbsoluteCanonicalDirectory(extensionDir, 'MetaMask extension');

  const entries = (['alice', 'bob', 'alice-restored'] as const)
    .map((profile) => [profile, profiles[profile]] as const)
    .filter((entry): entry is readonly [RealWalletProfile, string] => entry[1] !== undefined);

  for (const [profile, directory] of entries) {
    const label = `${profile} user-data directory`;
    assertAbsoluteCanonicalDirectory(directory, label);
    if (isSameOrInside(directory, workspace) || isSameOrInside(workspace, directory)) {
      throw new Error(`${label} must not overlap the ChainWhisper workspace.`);
    }
    if (
      isSameOrInside(directory, extensionDir) ||
      isSameOrInside(extensionDir, directory)
    ) {
      throw new Error(`${label} must not overlap the MetaMask extension directory.`);
    }
  }

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const [leftProfile, leftDirectory] = entries[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [rightProfile, rightDirectory] = entries[rightIndex]!;
      if (
        isSameOrInside(leftDirectory, rightDirectory) ||
        isSameOrInside(rightDirectory, leftDirectory)
      ) {
        throw new Error(
          `${leftProfile} and ${rightProfile} require separate, non-nested user-data directories.`
        );
      }
    }
  }
};

export class ProfileLaunchRegistry {
  readonly #activeByDirectory = new Map<string, ProfileLaunchReservation>();
  readonly #activeByProfile = new Map<RealWalletProfile, ProfileLaunchReservation>();

  reserve(
    profile: RealWalletProfile,
    canonicalDirectory: string
  ): ProfileLaunchReservation {
    if (!path.isAbsolute(canonicalDirectory) || path.normalize(canonicalDirectory) !== canonicalDirectory) {
      throw new Error('A wallet profile launch requires a canonical absolute directory path.');
    }
    const directoryIdentity = canonicalIdentity(canonicalDirectory);
    if (this.#activeByDirectory.has(directoryIdentity) || this.#activeByProfile.has(profile)) {
      throw new Error('The requested wallet profile already has an active browser context.');
    }
    const role = roleForRealWalletProfile(profile);
    if (
      role === 'alice' &&
      (this.#activeByProfile.has('alice') || this.#activeByProfile.has('alice-restored'))
    ) {
      throw new Error(
        'Alice primary and restored profiles must never have simultaneous active contexts.'
      );
    }
    const reservation: ProfileLaunchReservation = Object.freeze({
      canonicalDirectory,
      profile,
      role,
      token: Symbol(profile)
    });
    this.#activeByDirectory.set(directoryIdentity, reservation);
    this.#activeByProfile.set(profile, reservation);
    return reservation;
  }

  release(reservation: ProfileLaunchReservation): void {
    const directoryIdentity = canonicalIdentity(reservation.canonicalDirectory);
    if (
      this.#activeByDirectory.get(directoryIdentity) !== reservation ||
      this.#activeByProfile.get(reservation.profile) !== reservation
    ) {
      throw new Error('Wallet profile launch reservation is stale or already released.');
    }
    this.#activeByDirectory.delete(directoryIdentity);
    this.#activeByProfile.delete(reservation.profile);
  }
}

export const createIdempotentAsyncAction = (
  action: () => Promise<void>
): (() => Promise<void>) => {
  let actionPromise: Promise<void> | null = null;
  return () => {
    actionPromise ??= Promise.resolve().then(action);
    return actionPromise;
  };
};

export const createIdempotentRetirement = ({
  clearSensitiveState,
  closeContext,
  markRetired,
  releaseReservation
}: {
  clearSensitiveState: () => Promise<void>;
  closeContext: () => Promise<void>;
  markRetired: () => void;
  releaseReservation: () => void;
}): (() => Promise<void>) => {
  let retirementPromise: Promise<void> | null = null;
  return () => {
    if (retirementPromise) return retirementPromise;
    markRetired();
    retirementPromise = (async () => {
      const failures: unknown[] = [];
      try {
        await clearSensitiveState();
      } catch (error) {
        failures.push(error);
      }

      let contextClosed = false;
      try {
        await closeContext();
        contextClosed = true;
      } catch (error) {
        failures.push(error);
      }
      if (contextClosed) {
        try {
          releaseReservation();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Wallet profile retirement failed.');
      }
    })();
    return retirementPromise;
  };
};
