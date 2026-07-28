import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AgentSetupPanel, {
  CHAINWHISPER_AGENT_SETUP_PROMPT,
  CHAINWHISPER_AGENT_TOOLS_PACKAGE,
  copyAgentSetupPrompt
} from './AgentSetupPanel';

describe('AgentSetupPanel', () => {
  it('renders one install, two MCP connections, official messaging, and optional references', () => {
    const markup = renderToStaticMarkup(createElement(AgentSetupPanel));

    expect(markup).toContain('One package. Two MCP connections. No separate skill required.');
    expect(markup).toContain(CHAINWHISPER_AGENT_TOOLS_PACKAGE);
    expect(markup).toContain('chainwhisper-mcp');
    expect(markup).toContain('chainwhisper-coti-signer');
    expect(markup).toContain('Encrypted private messaging is included');
    expect(markup).toContain('COTI messaging details');
    expect(markup).toContain(
      'https://docs.coti.io/coti-documentation/private-messaging/quickstart#mcp-server'
    );
    expect(markup).toContain('General COTI MCP');
    expect(markup).toContain('COTI skills');
    expect(markup).toContain('Carbon MCP');
    expect(markup).toContain('Configuration required');
    expect(markup).toContain('Optional ecosystem tools');
    expect(markup).toContain('Add broader COTI and market tools');
    expect(markup).toContain('Not required');
    expect(markup).toContain('Installation becomes available with the beta release');
    expect(markup).toContain('Wallet and AES secrets stay local');
    expect(markup).not.toContain('Connected');
  });

  it('keeps setup free of wallet, signature, and Trade Agent payment actions', () => {
    const markup = renderToStaticMarkup(createElement(AgentSetupPanel));

    expect(markup).toContain('No wallet connection or WISP payment');
    expect(markup).toContain('normal COTI gas and ChainWhisper contract fees');
    expect(markup).not.toContain('Pay and send');
    expect(markup).not.toContain('Connect account');
    expect(markup).not.toContain('WISP / request');
  });
});

describe('copyAgentSetupPrompt', () => {
  it('copies the exported, release-pinned setup prompt through Clipboard API', async () => {
    const writeText = vi.fn(async () => {});
    const fallbackCopy = vi.fn(() => true);

    await expect(copyAgentSetupPrompt({ writeText, fallbackCopy })).resolves.toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith(CHAINWHISPER_AGENT_SETUP_PROMPT);
    expect(CHAINWHISPER_AGENT_SETUP_PROMPT).toContain(
      `npm install --global ${CHAINWHISPER_AGENT_TOOLS_PACKAGE}`
    );
    expect(fallbackCopy).not.toHaveBeenCalled();
  });

  it('uses the selection fallback when Clipboard API is unavailable or rejected', async () => {
    const fallbackCopy = vi.fn(() => true);

    await expect(
      copyAgentSetupPrompt({
        writeText: async () => Promise.reject(new Error('Clipboard denied')),
        fallbackCopy
      })
    ).resolves.toBe('fallback');
    expect(fallbackCopy).toHaveBeenCalledWith(CHAINWHISPER_AGENT_SETUP_PROMPT);
  });

  it('reports failure when neither copy path works', async () => {
    await expect(
      copyAgentSetupPrompt({
        writeText: undefined,
        fallbackCopy: () => false
      })
    ).rejects.toThrow('could not be copied');
  });
});
