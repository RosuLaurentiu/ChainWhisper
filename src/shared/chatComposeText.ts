const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const BLOCK_TEXT_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL'
]);

const isBlockTextElement = (node: ChildNode): node is HTMLElement =>
  node.nodeType === ELEMENT_NODE && BLOCK_TEXT_TAGS.has((node as HTMLElement).tagName);

export const readChatComposerText = (element: HTMLElement): string => {
  let text = '';

  const visitNode = (node: ChildNode) => {
    if (node.nodeType === TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }

    if (node.nodeType !== ELEMENT_NODE) {
      return;
    }

    const childElement = node as HTMLElement;
    if (childElement.tagName === 'BR') {
      text += '\n';
      return;
    }

    visitChildren(childElement);
  };

  const visitChildren = (parent: HTMLElement) => {
    const children = Array.from(parent.childNodes);
    children.forEach((child, index) => {
      const textLengthBeforeChild = text.length;
      visitNode(child);
      if (
        index < children.length - 1 &&
        isBlockTextElement(child) &&
        text.length > textLengthBeforeChild &&
        !text.endsWith('\n')
      ) {
        text += '\n';
      }
    });
  };

  visitChildren(element);
  return text.replace(/\r/g, '');
};

export const placeChatComposerCaretAtEnd = (element: HTMLElement) => {
  const selection = element.ownerDocument.getSelection();
  if (!selection) {
    return;
  }

  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

export const syncChatComposerText = (element: HTMLElement, maxLength: number): string => {
  const value = readChatComposerText(element);
  const capped = value.slice(0, maxLength);
  if (capped !== value) {
    element.textContent = capped;
    placeChatComposerCaretAtEnd(element);
  }
  return capped;
};

export const insertChatComposerLineBreak = (element: HTMLElement, maxLength: number): string => {
  element.focus();

  const selection = element.ownerDocument.getSelection();
  const hasEditorSelection =
    Boolean(selection?.rangeCount) &&
    Boolean(selection?.anchorNode && element.contains(selection.anchorNode)) &&
    Boolean(selection?.focusNode && element.contains(selection.focusNode));
  const range = hasEditorSelection ? selection?.getRangeAt(0) : element.ownerDocument.createRange();
  if (!range) {
    return syncChatComposerText(element, maxLength);
  }

  if (!hasEditorSelection) {
    range.selectNodeContents(element);
    range.collapse(false);
  }

  range.deleteContents();
  const lineBreak = element.ownerDocument.createTextNode('\n');
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.setEndAfter(lineBreak);
  selection?.removeAllRanges();
  selection?.addRange(range);

  return syncChatComposerText(element, maxLength);
};
