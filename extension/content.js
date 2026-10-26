/**
 * Browser Control MCP - Content Script
 * Handles in-page inspection, extraction, and interactions for AI Agents.
 */

(function () {
  // Avoid multiple injections
  if (window.__browser_mcp_initialized) {
    return;
  }
  window.__browser_mcp_initialized = true;

  // Cache for indexed elements
  let cachedElements = [];

  // -------------------------------------------------------------
  // 1. HTML to Markdown Converter
  // -------------------------------------------------------------
  function nodeToMarkdown(node) {
    if (!node) return '';

    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }

    // Comment node or non-element
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();

    // Ignore non-content / hidden tags
    const ignoredTags = ['script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'video', 'audio', 'head'];
    if (ignoredTags.includes(tag)) return '';

    // Check visibility
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return '';
    }

    // Process children
    const getChildrenMd = () => {
      let result = '';
      for (const child of node.childNodes) {
        result += nodeToMarkdown(child);
      }
      return result;
    };

    switch (tag) {
      case 'h1':
        return `\n\n# ${getChildrenMd().trim()}\n\n`;
      case 'h2':
        return `\n\n## ${getChildrenMd().trim()}\n\n`;
      case 'h3':
        return `\n\n### ${getChildrenMd().trim()}\n\n`;
      case 'h4':
        return `\n\n#### ${getChildrenMd().trim()}\n\n`;
      case 'h5':
        return `\n\n##### ${getChildrenMd().trim()}\n\n`;
      case 'h6':
        return `\n\n###### ${getChildrenMd().trim()}\n\n`;
      case 'p':
        return `\n\n${getChildrenMd().trim()}\n\n`;
      case 'br':
        return '\n';
      case 'hr':
        return '\n\n---\n\n';
      case 'strong':
      case 'b': {
        const text = getChildrenMd().trim();
        return text ? ` **${text}** ` : '';
      }
      case 'em':
      case 'i': {
        const text = getChildrenMd().trim();
        return text ? ` *${text}* ` : '';
      }
      case 'code': {
        if (node.parentNode && node.parentNode.tagName.toLowerCase() === 'pre') {
          return node.textContent;
        }
        const text = node.textContent.trim();
        return text ? ` \`${text}\` ` : '';
      }
      case 'pre': {
        const code = node.querySelector('code');
        const lang = code?.className?.match(/language-([a-z0-9_-]+)/i)?.[1] || '';
        const content = code ? code.textContent : node.textContent;
        return `\n\n\`\`\`${lang}\n${content.trim()}\n\`\`\`\n\n`;
      }
      case 'blockquote':
        return `\n\n> ${getChildrenMd().trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'a': {
        const text = getChildrenMd().trim();
        const href = node.getAttribute('href');
        if (!text && !href) return '';
        if (!href || href.startsWith('javascript:')) return text;
        const fullUrl = new URL(href, window.location.href).href;
        return ` [${text || fullUrl}](${fullUrl}) `;
      }
      case 'img': {
        const alt = node.getAttribute('alt') || 'image';
        const src = node.getAttribute('src');
        if (!src) return '';
        const fullSrc = new URL(src, window.location.href).href;
        return `\n\n![${alt}](${fullSrc})\n\n`;
      }
      case 'ul': {
        let ulResult = '\n';
        for (const child of node.children) {
          if (child.tagName.toLowerCase() === 'li') {
            ulResult += `- ${nodeToMarkdown(child).trim()}\n`;
          }
        }
        return `${ulResult}\n`;
      }
      case 'ol': {
        let olResult = '\n';
        let idx = 1;
        for (const child of node.children) {
          if (child.tagName.toLowerCase() === 'li') {
            olResult += `${idx++}. ${nodeToMarkdown(child).trim()}\n`;
          }
        }
        return `${olResult}\n`;
      }
      case 'table': {
        return `\n\n${convertTableToMarkdown(node)}\n\n`;
      }
      default:
        return getChildrenMd();
    }
  }

  function convertTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    let md = '';
    const tableData = rows.map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((cell) => cell.textContent.replace(/[\n|]/g, ' ').trim())
    );

    if (tableData.length === 0) return '';

    const colCount = Math.max(...tableData.map((r) => r.length));
    if (colCount === 0) return '';

    // First row
    const firstRow = tableData[0];
    while (firstRow.length < colCount) firstRow.push('');
    md += `| ${firstRow.join(' | ')} |\n`;
    md += `| ${Array(colCount).fill('---').join(' | ')} |\n`;

    // Remaining rows
    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i];
      while (row.length < colCount) row.push('');
      md += `| ${row.join(' | ')} |\n`;
    }

    return md;
  }

  function cleanMarkdown(md) {
    return md
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n +/g, '\n')
      .trim();
  }

  // -------------------------------------------------------------
  // 2. Intelligent Page Reader / Article Extractor
  // -------------------------------------------------------------
  function extractPageContent(options = {}) {
    const { format = 'markdown', fullPage = false } = options;
    const title = document.title || window.location.href;
    const url = window.location.href;

    let targetElement = document.body;

    if (!fullPage) {
      // Try to find semantic main content
      const mainCandidate =
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('.content, #content, .post-content, .article-content, #main-content');

      if (mainCandidate && mainCandidate.textContent.trim().length > 200) {
        targetElement = mainCandidate;
      }
    }

    let content = '';
    if (format === 'html') {
      content = targetElement.innerHTML;
    } else if (format === 'text') {
      content = targetElement.innerText;
    } else {
      content = cleanMarkdown(nodeToMarkdown(targetElement));
    }

    return {
      title,
      url,
      content,
      format,
    };
  }

  // -------------------------------------------------------------
  // 3. Interactive Elements Scanner
  // -------------------------------------------------------------
  function getUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    if (el.getAttribute('data-testid')) {
      return `[data-testid="${CSS.escape(el.getAttribute('data-testid'))}"]`;
    }

    if (el.name && ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    }

    if (el.getAttribute('aria-label')) {
      return `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;
    }

    let path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let tag = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) index++;
        sibling = sibling.previousElementSibling;
      }
      path.unshift(index > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  function getInteractiveElements(options = {}) {
    const { selector, limit = 60 } = options;
    const root = selector ? document.querySelector(selector) || document.body : document.body;

    const interactiveQuery =
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"]';
    const elements = Array.from(root.querySelectorAll(interactiveQuery));

    cachedElements = [];
    const results = [];

    for (const el of elements) {
      if (results.length >= limit) break;

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;

      if (!isVisible) continue;

      const index = results.length + 1;
      cachedElements.push(el);

      const tagName = el.tagName.toUpperCase();
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const placeholder = el.getAttribute('placeholder') || undefined;
      const value = el.value ? String(el.value).slice(0, 80) : undefined;
      const href = el.getAttribute('href') ? new URL(el.getAttribute('href'), window.location.href).href : undefined;
      const type = el.getAttribute('type') || undefined;
      const ariaLabel = el.getAttribute('aria-label') || undefined;

      results.push({
        index,
        tagName,
        type,
        id: el.id || undefined,
        name: el.name || undefined,
        selector: getUniqueSelector(el),
        text: text || undefined,
        placeholder,
        value,
        href,
        ariaLabel,
      });
    }

    return {
      total: results.length,
      url: window.location.href,
      title: document.title,
      elements: results,
    };
  }

  // -------------------------------------------------------------
  // 4. Element Actions: Click, Fill, Keypress, Scroll
  // -------------------------------------------------------------
  function findTargetElement(params = {}) {
    const { selector, elementIndex, text } = params;

    // By index
    if (typeof elementIndex === 'number' && elementIndex > 0) {
      if (cachedElements[elementIndex - 1]) {
        return cachedElements[elementIndex - 1];
      }
    }

    // By CSS selector
    if (selector) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    // By visible text
    if (text) {
      const lowerText = text.toLowerCase().trim();
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], span, p, div'));
      for (const el of candidates) {
        if ((el.innerText || el.textContent || '').toLowerCase().trim().includes(lowerText)) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return el;
          }
        }
      }
    }

    return null;
  }

  function simulateClick(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();

    const mouseEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const eventName of mouseEvents) {
      const event = new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      el.dispatchEvent(event);
    }
  }

  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  function simulateInput(el, value, clearFirst = true, pressEnter = false) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();

    if (clearFirst) {
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    if (pressEnter) {
      const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      const enterPress = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
      el.dispatchEvent(enterDown);
      el.dispatchEvent(enterPress);
      el.dispatchEvent(enterUp);

      // Submit parent form if applicable
      if (el.form && typeof el.form.requestSubmit === 'function') {
        el.form.requestSubmit();
      }
    }
  }

  // -------------------------------------------------------------
  // 5. Message Dispatcher
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, payload = {} } = request;

    try {
      switch (action) {
        case 'READ_PAGE': {
          const result = extractPageContent(payload);
          sendResponse({ success: true, data: result });
          break;
        }

        case 'GET_ELEMENTS': {
          const result = getInteractiveElements(payload);
          sendResponse({ success: true, data: result });
          break;
        }

        case 'CLICK': {
          const target = findTargetElement(payload);
          if (!target) {
            sendResponse({
              success: false,
              error: `Could not find clickable element matching: ${JSON.stringify(payload)}`,
            });
            break;
          }
          simulateClick(target);
          sendResponse({
            success: true,
            data: {
              clicked: true,
              tag: target.tagName,
              selector: getUniqueSelector(target),
              text: (target.innerText || target.textContent || '').trim().slice(0, 50),
            },
          });
          break;
        }

        case 'FILL_INPUT': {
          const target = findTargetElement(payload);
          if (!target) {
            sendResponse({
              success: false,
              error: `Could not find input element matching: ${JSON.stringify(payload)}`,
            });
            break;
          }
          simulateInput(target, payload.value, payload.clearFirst !== false, payload.pressEnter === true);
          sendResponse({
            success: true,
            data: {
              filled: true,
              tag: target.tagName,
              selector: getUniqueSelector(target),
              value: payload.value,
            },
          });
          break;
        }

        case 'PRESS_KEY': {
          const target = payload.selector ? document.querySelector(payload.selector) : document.activeElement || document.body;
          const key = payload.key || 'Enter';

          const eventOpts = { key, code: key, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
          target.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
          target.dispatchEvent(new KeyboardEvent('keyup', eventOpts));

          sendResponse({ success: true, data: { pressed: true, key } });
          break;
        }

        case 'SCROLL': {
          const direction = payload.direction || 'down';
          const amount = payload.amount || 500;
          const container = payload.selector ? document.querySelector(payload.selector) : window;

          if (direction === 'top') {
            container.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (direction === 'bottom') {
            const maxScroll = document.documentElement.scrollHeight || document.body.scrollHeight;
            container.scrollTo({ top: maxScroll, behavior: 'smooth' });
          } else if (direction === 'up') {
            container.scrollBy({ top: -amount, behavior: 'smooth' });
          } else {
            container.scrollBy({ top: amount, behavior: 'smooth' });
          }

          sendResponse({
            success: true,
            data: {
              direction,
              scrollY: window.scrollY,
            },
          });
          break;
        }

        case 'EVALUATE_JS': {
          Promise.resolve()
            .then(() => eval(payload.script))
            .then((result) => {
              sendResponse({ success: true, data: { result } });
            })
            .catch((err) => {
              sendResponse({ success: false, error: err.message });
            });
          return true; // asynchronous sendResponse
        }

        default:
          sendResponse({ success: false, error: `Unknown content script action: ${action}` });
          break;
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }

    return true; // keep channel open for async response
  });

  console.log('[Browser MCP] Content script injected and listening.');
})();
