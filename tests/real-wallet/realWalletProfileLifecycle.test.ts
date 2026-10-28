import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ALICE_RESTORED_PROFILE_ACK,
  assertCanonicalProfileDirectoryLayout,
  createIdempotentAsyncAction,
  createIdempotentRetirement,
  ProfileLaunchRegistry,
  resolveProfileLaunchRequest
} from './realWalletProfileLifecycle';

const absoluteFixturePath = (...segments: string[]): string =>
  path.join(path.parse(process.cwd()).root, 'chainwhisper-fixture-tests', ...segments);

const validLayout = () => ({
  extensionDir: absoluteFixturePath('extension'),
  profiles: {
    alice: absoluteFixturePath('profiles', 'alice'),
    bob: absoluteFixturePath('profiles', 'bob'),
    'alice-restored': absoluteFixturePath('profiles', 'alice-restored')
  },
  workspace: absoluteFixturePath('workspace')
});

describe('real-wallet profile directory validation', () => {
  it('accepts canonical, pairwise separate profile directories outside protected trees', () => {
    expect(() => assertCanonicalProfileDirectoryLayout(validLayout())).not.toThrow();
  });

  it('rejects relative and non-canonical profile paths', () => {
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...validLayout(),
        profiles: { ...validLayout().profiles, alice: 'relative/alice' }
      })
    ).toThrow(/canonical absolute/i);

    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...validLayout(),
        profiles: {
          ...validLayout().profiles,
          alice: `${absoluteFixturePath('profiles')}${path.sep}nested${path.sep}..${path.sep}alice`
        }
      })
    ).toThrow(/canonical absolute/i);
  });

  it('rejects every profile overlap with the workspace or extension directory', () => {
    const layout = validLayout();
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...layout,
        profiles: { ...layout.profiles, alice: path.join(layout.workspace, 'alice') }
      })
    ).toThrow(/workspace/i);
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...layout,
        profiles: { ...layout.profiles, bob: path.join(layout.extensionDir, 'profile') }
      })
    ).toThrow(/extension/i);
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...layout,
        extensionDir: path.join(layout.profiles['alice-restored'], 'extension')
      })
    ).toThrow(/extension/i);
  });

  it('rejects equal or nested profile directories including the restored identity', () => {
    const layout = validLayout();
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...layout,
        profiles: { ...layout.profiles, 'alice-restored': layout.profiles.alice }
      })
    ).toThrow(/separate, non-nested/i);
    expect(() =>
      assertCanonicalProfileDirectoryLayout({
        ...layout,
        profiles: {
          ...layout.profiles,
          'alice-restored': path.join(layout.profiles.alice, 'restored')
        }
      })
    ).toThrow(/separate, non-nested/i);
  });
});

describe('real-wallet active profile registry', () => {
  it('requires the restored-profile path and exact acknowledgement only for that identity', () => {
    const profiles = validLayout().profiles;
    expect(
      resolveProfileLaunchRequest({ profile: 'alice', profiles: { alice: profiles.alice, bob: profiles.bob } })
    ).toEqual({ profileDirectory: profiles.alice, role: 'alice' });
    expect(() =>
      resolveProfileLaunchRequest({
        profile: 'alice-restored',
        profiles: { alice: profiles.alice, bob: profiles.bob }
      })
    ).toThrow(/restored wallet profile directory is unavailable/i);
    expect(() =>
      resolveProfileLaunchRequest({ profile: 'alice-restored', profiles })
    ).toThrow(/exact public acknowledgement/i);
    expect(
      resolveProfileLaunchRequest({
        aliceRestoredProfileAck: ALICE_RESTORED_PROFILE_ACK,
        profile: 'alice-restored',
        profiles
      })
    ).toEqual({ profileDirectory: profiles['alice-restored'], role: 'alice' });
  });

  it('rejects duplicate active paths and profiles until the reservation is released', () => {
    const registry = new ProfileLaunchRegistry();
    const alicePath = absoluteFixturePath('profiles', 'alice');
    const reservation = registry.reserve('alice', alicePath);
    expect(() => registry.reserve('alice', alicePath)).toThrow(/already has an active/i);
    expect(() => registry.reserve('bob', alicePath)).toThrow(/already has an active/i);
    registry.release(reservation);
    expect(() => registry.reserve('alice', alicePath)).not.toThrow();
  });

  it('allows Alice to be restored only after the primary Alice context retires', () => {
    const registry = new ProfileLaunchRegistry();
    const primary = registry.reserve('alice', absoluteFixturePath('profiles', 'alice'));
    expect(() =>
      registry.reserve('alice-restored', absoluteFixturePath('profiles', 'alice-restored'))
    ).toThrow(/never have simultaneous/i);
    expect(() => registry.reserve('bob', absoluteFixturePath('profiles', 'bob'))).not.toThrow();
    registry.release(primary);
    expect(() =>
      registry.reserve('alice-restored', absoluteFixturePath('profiles', 'alice-restored'))
    ).not.toThrow();
  });

  it('rejects stale or duplicate reservation releases', () => {
    const registry = new ProfileLaunchRegistry();
    const reservation = registry.reserve('bob', absoluteFixturePath('profiles', 'bob'));
    registry.release(reservation);
    expect(() => registry.release(reservation)).toThrow(/stale or already released/i);
  });
});

describe('real-wallet retirement lifecycle', () => {
  it('runs a standalone sensitive-state cleanup exactly once', async () => {
    const action = vi.fn(async () => undefined);
    const cleanup = createIdempotentAsyncAction(action);
    const first = cleanup();
    expect(cleanup()).toBe(first);
    await first;
    await cleanup();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('marks retirement immediately and clears before closing exactly once', async () => {
    const events: string[] = [];
    const retire = createIdempotentRetirement({
      clearSensitiveState: async () => {
        events.push('clear');
      },
      closeContext: async () => {
        events.push('close');
      },
      markRetired: () => {
        events.push('mark');
      },
      releaseReservation: () => {
        events.push('release');
      }
    });
    const first = retire();
    expect(events).toEqual(['mark', 'clear']);
    expect(retire()).toBe(first);
    await first;
    await retire();
    expect(events).toEqual(['mark', 'clear', 'close', 'release']);
  });

  it('closes and releases the context even when sensitive-state cleanup fails', async () => {
    const clearError = new Error('clear failed');
    const close = vi.fn(async () => undefined);
    const release = vi.fn();
    const retire = createIdempotentRetirement({
      clearSensitiveState: async () => {
        throw clearError;
      },
      closeContext: close,
      markRetired: vi.fn(),
      releaseReservation: release
    });
    const first = retire();
    await expect(first).rejects.toMatchObject({ errors: [clearError] });
    await expect(retire()).rejects.toBeInstanceOf(AggregateError);
    expect(close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not release the profile when its browser context fails to close', async () => {
    const closeError = new Error('close failed');
    const release = vi.fn();
    const retire = createIdempotentRetirement({
      clearSensitiveState: async () => undefined,
      closeContext: async () => {
        throw closeError;
      },
      markRetired: vi.fn(),
      releaseReservation: release
    });
    await expect(retire()).rejects.toMatchObject({ errors: [closeError] });
    expect(release).not.toHaveBeenCalled();
  });
});
