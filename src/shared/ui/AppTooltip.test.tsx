import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppTooltip, AppTooltipHost } from './AppTooltip';

describe('AppTooltip', () => {
  it('adds no element and no title attribute to its child', () => {
    const markup = renderToStaticMarkup(
      <AppTooltip text="Connect your wallet first.">
        <button type="button" className="trade-compose-send" disabled>Create offer</button>
      </AppTooltip>
    );

    expect(markup.match(/</g)).toHaveLength(2);
    expect(markup.startsWith('<button')).toBe(true);
    expect(markup).toContain('class="trade-compose-send"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('>Create offer</button>');
    expect(markup).not.toContain('title=');
    expect(markup).toContain('aria-description="Connect your wallet first."');
  });

  it('keeps the hint on the element as its description', () => {
    const markup = renderToStaticMarkup(<AppTooltip text="Copy address"><a href="/x">0x12…ab</a></AppTooltip>);

    expect(markup).toBe('<a href="/x" aria-description="Copy address">0x12…ab</a>');
  });

  it('does not repeat a hint that is the name of the element', () => {
    const markup = renderToStaticMarkup(
      <AppTooltip text="Open App Help"><button type="button" aria-label="Open App Help">?</button></AppTooltip>
    );

    expect(markup).toBe('<button type="button" aria-label="Open App Help">?</button>');
  });

  it('keeps the same element when the hint is not set', () => {
    const markup = renderToStaticMarkup(<AppTooltip text={undefined}><a href="/x">0x12…ab</a></AppTooltip>);

    expect(markup).toBe('<a href="/x">0x12…ab</a>');
  });
});

describe('AppTooltipHost', () => {
  it('renders one hidden tooltip element with the App class', () => {
    const markup = renderToStaticMarkup(<AppTooltipHost />);

    expect(markup.match(/role="tooltip"/g)).toHaveLength(1);
    expect(markup).toContain('class="app-tooltip"');
    expect(markup).toContain('hidden=""');
  });
});
