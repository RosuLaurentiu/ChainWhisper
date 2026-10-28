import {
  applyNextTestnetTokenAdmission,
  assertTestnetTokenAdmissionWallet,
  createTestnetTokenAdmissionReadProvider,
  getNextTestnetTokenAdmission,
  inspectTestnetTokenAdmissions,
  switchTestnetTokenAdmissionWalletNetwork,
  TESTNET_TOKEN_ADMISSION_OPERATION_COUNT,
  TESTNET_TOKEN_ADMISSION_OWNER,
  type TestnetTokenAdmissionSnapshot
} from './lib/testnetTokenAdmission';
import {
  filterAllowedBrowserWalletOptions,
  orderInjectedWalletOptions
} from './lib/walletOptions';
import { COTI_TESTNET_NETWORK } from './lib/chainWhisperNetworks';
import {
  CIPHERTRADE_WALLETCONNECT_WALLET_ID,
  CIPHERTRADE_WALLETCONNECT_WALLET_LABEL,
  connectCipherTradeWalletConnectForNetwork,
  isCipherTradeWalletConnectConfigured
} from './lib/walletConnectMobile';
import {
  getInjectedWalletOptions,
  getProviderErrorMessage,
  rememberInjectedWalletProvider,
  shortenAddress,
  type Eip1193Provider,
  type InjectedWalletOption
} from './lib/appShared';

const readProvider = createTestnetTokenAdmissionReadProvider();
let selectedWallet: InjectedWalletOption | null = null;
let snapshot: TestnetTokenAdmissionSnapshot | null = null;
let busy = false;
let notice = 'Connect the deployed owner wallet, then approve one operation at a time.';
let noticeTone: 'info' | 'success' | 'error' = 'info';

const root = document.querySelector<HTMLElement>('#testnet-admission-root');
if (!root) throw new Error('Testnet admission root is missing.');

window.addEventListener('eip6963:announceProvider', (event) => {
  const detail = (event as CustomEvent<{
    info?: { name?: string; rdns?: string; uuid?: string };
    provider?: Eip1193Provider;
  }>).detail;
  if (!detail?.provider) return;
  rememberInjectedWalletProvider(detail.provider, detail.info);
  window.setTimeout(() => render(), 0);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

const wallets = (): InjectedWalletOption[] => orderInjectedWalletOptions(
  filterAllowedBrowserWalletOptions(getInjectedWalletOptions()),
  selectedWallet?.id ?? '',
  'selected'
);

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const render = () => {
  const availableWallets = wallets();
  const walletConnectConfigured = isCipherTradeWalletConnectConfigured();
  const next = snapshot ? getNextTestnetTokenAdmission(snapshot) : null;
  const appliedCount = snapshot?.appliedCount ?? 0;
  const rows = snapshot?.states.map(({ operation, applied }) => `
    <li class="operation ${applied ? 'done' : operation.id === next?.id ? 'next' : ''}">
      <span class="operation-index">${operation.index + 1}</span>
      <span><strong>${escapeHtml(operation.targetName.replace('ChainWhisper', ''))}</strong><small>${escapeHtml(operation.tokenLabel)} · ${escapeHtml(operation.kind)}</small></span>
      <b>${applied ? 'Complete' : operation.id === next?.id ? 'Next' : 'Waiting'}</b>
    </li>
  `).join('') ?? '';

  root.innerHTML = `
    <header>
      <div><span class="eyebrow">CHAINWHISPER · COTI TESTNET</span><h1>Token policy setup</h1></div>
      <a href="/chat">Back to Chat</a>
    </header>
    <section class="warning">
      <strong>Owner-only deployment setup</strong>
      <p>This tool never asks for a private key and never batches transactions. Contract and token reads use the public COTI RPC so MetaMask or CipherTrade only handles connection, network selection, and the one approval you choose.</p>
    </section>
    <section class="card connection-card">
      <div><span>Required owner</span><strong>${shortenAddress(TESTNET_TOKEN_ADMISSION_OWNER)}</strong></div>
      <div><span>Selected wallet</span><strong>${selectedWallet ? escapeHtml(selectedWallet.label) : 'Not connected'}</strong></div>
      <div class="wallet-actions">
        ${availableWallets.length > 0 ? availableWallets.map((wallet) => `
          <button data-wallet="${escapeHtml(wallet.id)}" ${busy ? 'disabled' : ''}>${selectedWallet?.id === wallet.id ? `${escapeHtml(wallet.label)} connected` : `Connect ${escapeHtml(wallet.label)}`}</button>
        `).join('') : '<span class="muted">No supported desktop extension was detected.</span>'}
        <button data-action="walletconnect" ${busy || !walletConnectConfigured ? 'disabled' : ''}>${selectedWallet?.id === CIPHERTRADE_WALLETCONNECT_WALLET_ID ? `${CIPHERTRADE_WALLETCONNECT_WALLET_LABEL} connected` : `Connect ${CIPHERTRADE_WALLETCONNECT_WALLET_LABEL}`}</button>
        ${walletConnectConfigured ? '' : '<span class="muted">CipherTrade Mobile QR requires VITE_WALLETCONNECT_PROJECT_ID.</span>'}
        ${selectedWallet ? `<button data-action="switch" class="secondary" ${busy ? 'disabled' : ''}>Switch to COTI Testnet</button>` : ''}
      </div>
    </section>
    <section class="card progress-card">
      <div class="progress-heading"><div><span>Canonical progress</span><strong>${appliedCount}/${TESTNET_TOKEN_ADMISSION_OPERATION_COUNT}</strong></div><button data-action="refresh" class="secondary" ${busy ? 'disabled' : ''}>Refresh attestation</button></div>
      <div class="progress-track"><i style="width:${(appliedCount / TESTNET_TOKEN_ADMISSION_OPERATION_COUNT) * 100}%"></i></div>
      <p class="notice ${noticeTone}">${escapeHtml(notice)}</p>
      ${snapshot?.complete ? '<div class="complete-banner">All policies are configured. The unified testnet manifest can now be generated.</div>' : next ? `
        <div class="next-card">
          <span>Next transaction</span>
          <strong>${escapeHtml(next.targetName)}</strong>
          <p>Approve ${escapeHtml(next.tokenLabel)} as an allowed ${next.kind === 'private-approval' ? 'private' : 'public'} test token.</p>
          <code>${escapeHtml(next.target)} · ${escapeHtml(next.selector)}</code>
          <button data-action="approve" class="primary" ${busy || !selectedWallet ? 'disabled' : ''}>${busy ? 'Waiting…' : `Approve operation ${next.index + 1}`}</button>
        </div>
      ` : '<p class="muted">Run the read-only attestation to load current progress.</p>'}
    </section>
    <section class="card list-card"><h2>Exact 16-operation plan</h2><ol>${rows || '<li class="muted">Progress has not been loaded yet.</li>'}</ol></section>
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-wallet]').forEach((button) => {
    button.addEventListener('click', () => void connectWallet(button.dataset.wallet ?? ''));
  });
  root.querySelector<HTMLButtonElement>('[data-action="walletconnect"]')?.addEventListener('click', () => void connectWalletConnect());
  root.querySelector<HTMLButtonElement>('[data-action="switch"]')?.addEventListener('click', () => void switchNetwork());
  root.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => void refresh());
  root.querySelector<HTMLButtonElement>('[data-action="approve"]')?.addEventListener('click', () => void approveNext());
};

const run = async (action: () => Promise<void>) => {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } catch (error) {
    notice = getProviderErrorMessage(error, 'The testnet setup action could not be completed.');
    noticeTone = 'error';
  } finally {
    busy = false;
    render();
  }
};

const connectWallet = async (walletId: string) => run(async () => {
  const wallet = wallets().find((candidate) => candidate.id === walletId);
  if (!wallet) throw new Error('The selected wallet provider is no longer available.');
  await assertTestnetTokenAdmissionWallet(wallet.provider, true);
  selectedWallet = wallet;
  notice = `${wallet.label} is connected to the reviewed owner.`;
  noticeTone = 'success';
  snapshot = await inspectTestnetTokenAdmissions(readProvider);
});

const connectWalletConnect = async () => run(async () => {
  const session = await connectCipherTradeWalletConnectForNetwork(COTI_TESTNET_NETWORK);
  const wallet: InjectedWalletOption = {
    id: CIPHERTRADE_WALLETCONNECT_WALLET_ID,
    label: CIPHERTRADE_WALLETCONNECT_WALLET_LABEL,
    provider: session.provider
  };
  await assertTestnetTokenAdmissionWallet(wallet.provider, false);
  selectedWallet = wallet;
  notice = `${wallet.label} is connected to the reviewed owner on COTI Testnet.`;
  noticeTone = 'success';
  snapshot = await inspectTestnetTokenAdmissions(readProvider);
});

const switchNetwork = async () => run(async () => {
  if (!selectedWallet) throw new Error('Connect MetaMask or CipherTrade first.');
  await switchTestnetTokenAdmissionWalletNetwork(selectedWallet.provider);
  await assertTestnetTokenAdmissionWallet(selectedWallet.provider, false);
  notice = 'The selected wallet is on COTI Testnet.';
  noticeTone = 'success';
});

const refresh = async () => run(async () => {
  snapshot = await inspectTestnetTokenAdmissions(readProvider);
  notice = snapshot.complete
    ? 'All 16 admissions are canonical and complete.'
    : `Attestation complete at block ${snapshot.blockNumber}.`;
  noticeTone = snapshot.complete ? 'success' : 'info';
});

const approveNext = async () => run(async () => {
  if (!selectedWallet) throw new Error('Connect MetaMask or CipherTrade first.');
  if (!snapshot) throw new Error('Refresh the canonical admission state first.');
  const operation = getNextTestnetTokenAdmission(snapshot);
  if (!operation) throw new Error('All 16 testnet token admissions are already complete.');
  notice = `Confirm only operation ${operation.index + 1} in ${selectedWallet.label}.`;
  noticeTone = 'info';
  render();
  const result = await applyNextTestnetTokenAdmission({
    walletProvider: selectedWallet.provider as Eip1193Provider,
    readProvider,
    snapshot
  });
  snapshot = result.snapshot;
  notice = `Operation ${operation.index + 1} confirmed in block ${result.receipt.blockNumber}.`;
  noticeTone = 'success';
});

render();
void refresh();
