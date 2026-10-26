import { BrowserBridge } from '../server/src/wsServer.js';
import WebSocket from 'ws';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

async function runTest() {
  const TEST_PORT = 3099;
  console.log(`[TEST] Starting BrowserBridge on port ${TEST_PORT}...`);
  const bridge = new BrowserBridge(TEST_PORT);
  await bridge.start();

  console.log('[TEST] Connecting mock extension WebSocket client...');
  const mockClient = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);

  mockClient.on('open', () => {
    console.log('[TEST] Mock extension connected.');
    // Send initial tabs update
    mockClient.send(
      JSON.stringify({
        type: 'tabs_update',
        tabs: [
          { id: 101, url: 'https://example.com', title: 'Example Domain', active: true },
          { id: 102, url: 'https://news.ycombinator.com', title: 'Hacker News', active: false },
        ],
        activeTab: { id: 101, url: 'https://example.com', title: 'Example Domain', active: true },
      })
    );
  });

  // Handle commands sent from bridge
  mockClient.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    console.log(`[TEST] Mock extension received action: ${msg.action} (id: ${msg.id})`);

    let responseData: any = {};
    if (msg.action === 'GET_STATUS') {
      responseData = {
        connected: true,
        activeTab: { id: 101, url: 'https://example.com', title: 'Example Domain' },
        tabCount: 2,
      };
    } else if (msg.action === 'OPEN_URL') {
      responseData = {
        tabId: 101,
        url: msg.payload.url,
        title: 'Navigated Page',
      };
    } else if (msg.action === 'READ_PAGE') {
      responseData = {
        title: 'Example Domain',
        url: 'https://example.com',
        content: '# Example Domain\n\nThis domain is for use in illustrative examples.',
        format: msg.payload.format || 'markdown',
      };
    } else if (msg.action === 'CLICK') {
      responseData = { clicked: true, selector: msg.payload.selector || 'button' };
    } else if (msg.action === 'FILL_INPUT') {
      responseData = { filled: true, value: msg.payload.value };
    }

    mockClient.send(
      JSON.stringify({
        id: msg.id,
        success: true,
        data: responseData,
      })
    );
  });

  // Wait for connection to establish
  await new Promise((r) => setTimeout(r, 400));

  assert.strictEqual(bridge.isConnected(), true, 'Bridge should be connected');
  console.log('[TEST] Check 1 Passed: Bridge connected.');

  // Test GET_STATUS
  const status = await bridge.sendCommand('GET_STATUS', {});
  assert.strictEqual(status.connected, true);
  console.log('[TEST] Check 2 Passed: GET_STATUS returned correctly:', status);

  // Test OPEN_URL
  const openRes = await bridge.sendCommand('OPEN_URL', { url: 'https://example.com' });
  assert.strictEqual(openRes.url, 'https://example.com');
  console.log('[TEST] Check 3 Passed: OPEN_URL returned correctly:', openRes);

  // Test READ_PAGE
  const readRes = await bridge.sendCommand('READ_PAGE', { format: 'markdown' });
  assert.ok(readRes.content.includes('Example Domain'));
  console.log('[TEST] Check 4 Passed: READ_PAGE returned markdown content.');

  // Test CLICK
  const clickRes = await bridge.sendCommand('CLICK', { selector: '#test-btn' });
  assert.strictEqual(clickRes.clicked, true);
  console.log('[TEST] Check 5 Passed: CLICK returned success.');

  // Test FILL_INPUT
  const fillRes = await bridge.sendCommand('FILL_INPUT', { value: 'Hello MCP' });
  assert.strictEqual(fillRes.filled, true);
  console.log('[TEST] Check 6 Passed: FILL_INPUT returned success.');

  // Clean up
  mockClient.close();
  await bridge.stop();
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
}

runTest().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
