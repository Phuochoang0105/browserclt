#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BrowserBridge } from './wsServer.js';
import { saveMarkdownFile } from './utils/fileExport.js';
import * as fs from 'fs';
import * as path from 'path';

const PORT = parseInt(process.env.BROWSER_MCP_PORT || '3025', 10);
const bridge = new BrowserBridge(PORT);

const server = new Server(
  {
    name: 'browser-ctl-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'browser_get_status',
        description:
          'Get the connection status of the Chrome Extension, along with current active tab and all open tabs in the browser.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'browser_open_url',
        description:
          'Navigate the active browser tab or open a new tab to a specific URL and wait for page to load.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to (e.g. "https://news.ycombinator.com" or "https://google.com")',
            },
            newTab: {
              type: 'boolean',
              description: 'Whether to open in a new tab (default: false, reuses current tab)',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'browser_read_page',
        description:
          'Extract and read the content of the current page in the browser as clean Markdown, plain text, or HTML.',
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              enum: ['markdown', 'text', 'html'],
              description: 'Format of the extracted content (default: markdown)',
            },
            fullPage: {
              type: 'boolean',
              description:
                'If true, extracts the full page body. If false (default), intelligently extracts the main article/body content and filters out navs/sidebars/ads.',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID to read from (optional, defaults to active tab)',
            },
          },
        },
      },
      {
        name: 'browser_export_markdown',
        description:
          'Extract the webpage content as clean Markdown and save it directly to a local .md file on disk. Perfect for collecting research, documentation, or articles.',
        inputSchema: {
          type: 'object',
          properties: {
            outputPath: {
              type: 'string',
              description:
                'Optional file path to save the markdown file. If not provided, saves into ./exports/<title>_<timestamp>.md',
            },
            fullPage: {
              type: 'boolean',
              description: 'Extract full page body (default false: smart article extraction)',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID to extract from (optional, defaults to active tab)',
            },
          },
        },
      },
      {
        name: 'browser_get_interactive_elements',
        description:
          'Scan the current page for interactive elements (buttons, links, inputs, selects, textareas). Returns an indexed list with element text, placeholder, selector, and visibility so the AI can choose what to click or fill.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'Optional CSS selector to scope the search within (e.g. "form.search-form" or "main")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of elements to return (default: 60)',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
        },
      },
      {
        name: 'browser_click',
        description:
          'Click on an element on the webpage by CSS selector, text content, or elementIndex (from browser_get_interactive_elements).',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click (e.g. "button.submit-btn" or "#login-button")',
            },
            elementIndex: {
              type: 'number',
              description: 'The index number of the element obtained from browser_get_interactive_elements',
            },
            text: {
              type: 'string',
              description: 'Exact or partial visible text of the button or link to click (e.g. "Đăng nhập" or "Submit")',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
        },
      },
      {
        name: 'browser_fill_input',
        description:
          'Fill or type text into an input field, textarea, or contenteditable element. Triggers input and change events for React/Vue/Angular compatibility.',
        inputSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description: 'Text value to enter into the input field',
            },
            selector: {
              type: 'string',
              description: 'CSS selector of the input field (e.g. "input[name=q]" or "#search")',
            },
            elementIndex: {
              type: 'number',
              description: 'The index number of the element from browser_get_interactive_elements',
            },
            clearFirst: {
              type: 'boolean',
              description: 'Whether to clear existing text before typing (default: true)',
            },
            pressEnter: {
              type: 'boolean',
              description: 'Whether to press Enter key after typing (default: false)',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
          required: ['value'],
        },
      },
      {
        name: 'browser_press_key',
        description: 'Send a keyboard key press to the page or to a focused element (e.g. "Enter", "Tab", "Escape", "ArrowDown").',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key name (e.g. "Enter", "Tab", "Escape", "ArrowDown", "Backspace")',
            },
            selector: {
              type: 'string',
              description: 'Optional selector of element to focus before pressing key',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the active webpage or a specific scrollable element up, down, to top, or to bottom.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['down', 'up', 'top', 'bottom'],
              description: 'Direction to scroll (default: "down")',
            },
            amount: {
              type: 'number',
              description: 'Pixel amount to scroll for "up" or "down" (default: 500)',
            },
            selector: {
              type: 'string',
              description: 'Optional selector of a scrollable container element',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
        },
      },
      {
        name: 'browser_evaluate_js',
        description: 'Execute arbitrary JavaScript inside the webpage and return the result. Useful for complex queries or DOM manipulation.',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'JavaScript code to execute in the page context. Can return a value or a Promise.',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
          required: ['script'],
        },
      },
      {
        name: 'browser_screenshot',
        description: 'Capture a visual screenshot of the current active browser tab and optionally save to disk as a PNG image.',
        inputSchema: {
          type: 'object',
          properties: {
            outputPath: {
              type: 'string',
              description: 'Optional file path to save the PNG screenshot (e.g. "./exports/screenshot.png")',
            },
            tabId: {
              type: 'number',
              description: 'Specific tab ID (optional, defaults to active tab)',
            },
          },
        },
      },
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'browser_get_status': {
        const isConnected = bridge.isConnected();
        if (!isConnected) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    connected: false,
                    message:
                      'Browser extension is NOT connected. Please check that Chrome is open and the extension is loaded and connected to ws://127.0.0.1:' +
                      PORT,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const statusData = await bridge.sendCommand('GET_STATUS', {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(statusData, null, 2),
            },
          ],
        };
      }

      case 'browser_open_url': {
        const result = await bridge.sendCommand('OPEN_URL', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_read_page': {
        const result = await bridge.sendCommand('READ_PAGE', args);
        const format = args.format || 'markdown';
        return {
          content: [
            {
              type: 'text',
              text:
                `# Page: ${result.title}\n` +
                `**URL**: ${result.url}\n` +
                `**Format**: ${format}\n\n` +
                `---\n\n` +
                result.content,
            },
          ],
        };
      }

      case 'browser_export_markdown': {
        const readResult = await bridge.sendCommand('READ_PAGE', {
          format: 'markdown',
          fullPage: args.fullPage || false,
          tabId: args.tabId,
        });

        const header = `# ${readResult.title}\n\n- **Source URL**: ${readResult.url}\n- **Collected Date**: ${new Date().toISOString()}\n\n---\n\n`;
        const fullContent = header + (readResult.content || '');

        const savedPath = saveMarkdownFile(fullContent, args.outputPath as string | undefined, readResult.title);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Successfully exported page content to Markdown file',
                  savedPath,
                  title: readResult.title,
                  url: readResult.url,
                  contentLength: fullContent.length,
                  preview: fullContent.slice(0, 400) + '...',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'browser_get_interactive_elements': {
        const result = await bridge.sendCommand('GET_ELEMENTS', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_click': {
        const result = await bridge.sendCommand('CLICK', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_fill_input': {
        const result = await bridge.sendCommand('FILL_INPUT', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_press_key': {
        const result = await bridge.sendCommand('PRESS_KEY', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_scroll': {
        const result = await bridge.sendCommand('SCROLL', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_evaluate_js': {
        const result = await bridge.sendCommand('EVALUATE_JS', args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'browser_screenshot': {
        const result = await bridge.sendCommand('SCREENSHOT', args);
        let message = 'Screenshot captured successfully.';
        let savedPath: string | undefined;

        if (args.outputPath || !args.outputPath) {
          const exportDir = path.resolve(process.cwd(), 'exports');
          if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
          }
          savedPath = args.outputPath
            ? path.isAbsolute(args.outputPath as string)
              ? (args.outputPath as string)
              : path.resolve(process.cwd(), args.outputPath as string)
            : path.join(exportDir, `screenshot_${Date.now()}.png`);

          const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(savedPath, Buffer.from(base64Data, 'base64'));
          message += ` Saved to ${savedPath}`;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message,
                  savedPath,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error(`[Browser MCP] Error executing tool ${name}:`, error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error.message}`,
        },
      ],
    };
  }
});

async function main() {
  await bridge.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Browser MCP] Server running on stdio transport');

  process.on('SIGINT', async () => {
    console.error('[Browser MCP] Shutting down...');
    await bridge.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('[Browser MCP] Shutting down...');
    await bridge.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Browser MCP] Fatal error in main():', err);
  process.exit(1);
});
