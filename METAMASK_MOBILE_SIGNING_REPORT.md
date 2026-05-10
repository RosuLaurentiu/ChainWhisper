# MetaMask Mobile Signing Failure Report

Status: unresolved as of 2026-05-11.

This report documents the MetaMask Mobile browser-wallet problem, the user-visible behavior, the fixes already attempted, and why those attempts did not solve the issue.

## Scope

This problem is only about browser-wallet use in MetaMask Mobile.

It is not about:

- The app wallet / burner wallet.
- Smart contract execution paths.
- Direct chat contract compatibility.
- Desktop MetaMask extension behavior.
- CipherTrade mobile browser behavior, which has been reported to work better.

The app wallet and MetaMask connection are separate wallet systems. The failing scenario is specifically MetaMask Mobile's built-in browser and how the app behaves during wallet prompt handoffs.

## Working Scenario

The user opens the normal phone browser, goes to the Chat app, chooses MetaMask, and is redirected into the MetaMask app/built-in browser.

From that Chat-first path:

- MetaMask connects.
- Chat can unlock privacy.
- Group chat message sending can complete multiple prompts/signatures.
- The page does not visibly refresh in a way that breaks the prompt chain.
- Wallet/AES state remains usable.

This proves MetaMask Mobile can complete the required signing flow when the app state path is stable.

## Broken Scenario

The user opens the normal phone browser, goes to the Trading app first, chooses MetaMask, and is redirected into the MetaMask app/built-in browser.

From that Trading-first path:

- MetaMask connects to the Trading page.
- AES onboarding/unlock can appear to succeed.
- Starting any transaction anywhere in the app can trigger the failure, including after navigating from Trading to Chat.
- The first wallet signature popup appears.
- The page refreshes or returns to the first page that opened in MetaMask Mobile.
- The app appears disconnected or loses usable wallet state.
- The user is left at a signature screen or intermediate prompt but cannot complete the remaining signatures/transactions.

This suggests the failure is app-side state/navigation churn triggered by the Trading-first connection path, not a pure MetaMask or contract inability.

## Current Hypothesis

The likely root problem is still a Trading-first browser-wallet ownership or lifecycle conflict.

Even after moving more logic toward the shared app wallet session, some Trading-first initialization or route/sync behavior appears to mark MetaMask Mobile's first opened route as the browser's return target. During later wallet prompts, MetaMask Mobile returns to that initial Trading route and the app reinitializes enough state to break the in-flight prompt chain.

The strongest clue is:

- Chat-first inside MetaMask Mobile works.
- Trading-first inside MetaMask Mobile poisons later app-wide signing behavior, including Chat.

That points to something Trading does during first connection/mount that Chat does not do.

## Attempts Already Made

### 1. Wallet Header Unification

We unified the visible wallet header behavior across Chat, Trades, and Shield:

- Shared labels and privacy status.
- Chat/Shield app-wallet-first.
- Trades browser-wallet-first.
- Connected wallet state intended to persist across pages.

Result:

- Improved visual consistency.
- Did not fix MetaMask Mobile Trading-first signing refresh.

### 2. Snap-First And Mobile AES Fallback Work

We audited COTI Snap behavior and adjusted unlock behavior:

- MetaMask desktop and Snap-capable providers attempt Snap first.
- MetaMask Mobile is treated as Snap-unsupported.
- MetaMask Mobile uses fallback COTI AES recovery/onboarding.
- Passive reads do not prompt Snap or AES recovery.
- Wrong/stale AES states were made wallet-scoped.

Result:

- Helped separate Snap desktop behavior from mobile fallback behavior.
- Did not fix the page refresh/disconnect during Trading-first MetaMask Mobile transaction prompts.

### 3. AES Session Persistence For Mobile Fallback

We added session-only fallback AES persistence:

- Store fallback AES/onboard info in `sessionStorage`.
- Key by wallet/provider/chain.
- Rehydrate before private-token signing.
- Clear on disconnect/account/chain/provider changes.

Result:

- Reduced repeated AES signing in some paths.
- Did not prevent MetaMask Mobile from refreshing/navigating mid-prompt when Trading was the first connected page.

### 4. Terminal Route Return Marker

We added a passive pending Terminal route marker:

- Store active Trading Terminal route in `sessionStorage`.
- Restore it after MetaMask Mobile returns to `/trades`.
- Avoid route mutation before prompts.

Result:

- Helped keep the user on the Trading Terminal after some mobile handoffs.
- Did not solve transaction completion. In some cases it only restored the route after the prompt chain was already broken.

### 5. Staged Trade Action Resume

We tried a session-backed staged pipeline:

- `aes-ready`.
- `token-visibility-ready`.
- `allowance-ready`.
- `submit-trade`.
- `confirm-refresh`.

The idea was to survive mobile reloads between wallet prompts and resume the next stage.

Result:

- Did not solve the live problem.
- It was considered the wrong direction because private-token trades still require follow-up wallet prompts that cannot be recovered just by restoring typed state.
- The user explicitly preferred restoring the original uninterrupted signing behavior.

### 6. Trading Wallet Prompt Critical Section

We added guards around Trading write flows:

- Suppress focus/visibility sync during signing.
- Ignore temporary empty `accountsChanged` events while signing.
- Avoid route/history mutation before wallet prompts.
- Queue refreshes until after transaction flow completion.

Result:

- Helped conceptually and in desktop/browser tests.
- Did not fix MetaMask Mobile Trading-first behavior.

### 7. Shared Wallet Transaction Guard

We expanded the guard across wallet writes:

- Chat sends.
- Trading writes.
- AES recovery/onboarding.
- Private-token setup/approval.
- Self-backup writes.
- Group/admin writes.

Result:

- Made more app writes use one guard.
- Chat-first remained good.
- Trading-first MetaMask Mobile still broke, meaning the issue is likely not only "unguarded writes."

### 8. Smooth Trading Sync Refactor

We tried to make Trading sync less disruptive:

- Central sync coordinator.
- Silent refresh.
- Preserve existing cards/balances during background refresh.
- Suppress automatic sync while wallet transaction flow is active.
- Keep private balances from downgrading during silent refresh.

Result:

- Some sync behavior regressed temporarily, including first-load trade loading.
- Later narrowed so first-load reads are not blocked by stored mobile handoff markers.
- Did not fix the MetaMask Mobile signing break.

### 9. App-Owned Browser Wallet State

We tried to stop Trading from acting as a second browser-wallet owner:

- Trading browser connect/disconnect actions call shared App wallet actions.
- Trading derives browser wallet state from `SharedWalletSession`.
- Trading no longer actively adopts shared browser wallet state into local browser state in normal app-shell mode.
- App-wallet sessions were explicitly kept separate from browser-wallet derivation.

Result:

- Correct architectural direction.
- Did not fix the reported Trading-first MetaMask Mobile refresh/disconnect.

### 10. Broader Browser Wallet Handoff Suppression

We made account/chain event handling more defensive:

- During any active wallet flow, ignore transient browser-wallet account events.
- During any active wallet flow, ignore chain changes.
- Trading auto-sync pauses during any active wallet flow, not only exact local Trading wallet flow matches.

Result:

- Tests pass.
- The user reported the real mobile problem still persists.

## Why The Attempts Did Not Work

The fixes mostly protected React state after a wallet transaction flow was already recognized as active.

The remaining failure may happen earlier or outside those guards:

- When MetaMask Mobile first opens the dapp from the Trading deeplink.
- When the Trading page initializes route/sync/wallet state before any transaction guard exists.
- When MetaMask Mobile records the first opened Trading URL as its return target.
- When a later signature prompt returns to that first URL and remounts/reinitializes the app.
- When Trading route initialization or top-level route canonicalization runs before the guard can suppress it.

In other words, the issue may not be the transaction write code itself. It may be the initial MetaMask Mobile entrypoint and Trading route lifecycle.

## Important Observations

- The issue follows "where the user first connects inside MetaMask Mobile."
- If the first successful MetaMask Mobile entrypoint is Chat, Chat signing works.
- If the first successful MetaMask Mobile entrypoint is Trading, later signing can break anywhere.
- This means the first route opened in MetaMask Mobile likely matters.
- Desktop and Playwright tests cannot reproduce this reliably because they do not emulate MetaMask Mobile's app handoff/browser behavior.

## Files Most Likely Involved

High-priority areas for the next audit:

- `src/hooks/useChatWalletHeaderControl.tsx`
  - Chat mobile MetaMask entry path.
- `src/hooks/useP2PWalletHeaderControl.tsx`
  - Trading mobile MetaMask entry path.
- `src/lib/walletOptions.ts`
  - `buildMetaMaskMobileDeepLink`.
- `src/App.tsx`
  - Top-level route canonicalization and active page sync.
  - Shared wallet transaction guard.
  - Shared wallet session.
- `src/hooks/useWalletOnboarding.ts`
  - Browser wallet connect, account/chain listeners, AES onboarding.
- `src/hooks/useP2PTradeRoute.ts`
  - Trading deep route sync and pending terminal restoration.
- `src/components/P2PTradingPage.tsx`
  - Trading mount, auto-sync, wallet derivation, transaction writes.

## Recommended Next Investigation

The next pass should stop changing broad wallet code until the exact divergence is found.

Suggested steps:

1. Add mobile-only diagnostic logging around first MetaMask Mobile entry:
   - Current URL.
   - Referrer if available.
   - Route/page selected by `resolveAppRouteFromLocation`.
   - Whether a `p` redirect param exists.
   - Whether route canonicalization calls `replaceState` or `pushState`.
   - Whether Trading route restoration runs.
   - Whether account/chain events fire immediately after wallet prompt open.

2. Compare Chat-first vs Trading-first logs on the same phone:
   - First URL opened in MetaMask Mobile.
   - First route mutation after load.
   - First wallet state mutation.
   - First sync/refresh after connection.
   - Whether any route canonicalization happens right before or after the first signature popup.

3. Temporarily disable Trading-only route/sync effects on mobile and test:
   - `useP2PTradeRoute` focus/visibility route sync.
   - Pending terminal route restoration.
   - Trading realtime/focus/interval sync.
   - Trading first-load broad refresh.

4. Test using a forced Chat entrypoint deep link for mobile MetaMask:
   - Open MetaMask Mobile to `/chat`.
   - After provider injection and connection, navigate client-side to `/trades`.
   - This would test whether Trading-first deeplink entry itself is the poison.

5. If that works, consider changing mobile browser-wallet connect behavior:
   - Always open MetaMask Mobile at a stable wallet bootstrap route, likely `/chat` or a new `/wallet-connect` route.
   - After connection, navigate client-side back to the intended app route.
   - Avoid opening MetaMask Mobile directly into deep Trading routes until the wallet is connected.

## Possible Permanent Fix Direction

The most promising fix may be a dedicated mobile browser-wallet bootstrap route.

Instead of sending MetaMask Mobile directly to `/trades` or a Trading deep route, the app could:

1. Save intended return route in `sessionStorage`.
2. Open MetaMask Mobile to `/chat` or `/wallet-connect`.
3. Connect/onboard MetaMask there using the same stable flow that currently works.
4. Navigate client-side to the saved Trading route after connection.

This matches the observed working behavior: Chat-first MetaMask Mobile signing is stable.

This should be tested before implementing broadly.

## What Not To Do Next

- Do not keep adding app-wallet changes. The app wallet is not the failing wallet.
- Do not assume smart contracts are the cause. The same contracts can be reached from working browser paths.
- Do not add another staged transaction resume system without proving route entry is not the root cause.
- Do not rely only on desktop, Playwright, or extension MetaMask tests for this bug.
- Do not keep broadening sync guards unless logs show sync is actually firing at the breaking moment.

## Current State

The codebase has several improvements from prior attempts, but the user-reported MetaMask Mobile Trading-first signing failure remains unresolved.

The next effective step is evidence gathering on a real MetaMask Mobile device, with diagnostics specifically comparing Chat-first and Trading-first entry paths.
