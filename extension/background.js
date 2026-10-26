/**
 * Browser Control MCP - Background Service Worker
 * Bridges WebSocket connection between Node.js MCP Server and Chrome Tabs.
 */

const DEFAULT_PORT = 3025;
let socket = null;
let reconnectTimer = null;
let serverPort = DEFAULT_PORT;

// Load configured port from storage
chrome.storage.local.get(['mcp_port'], (res) => {
  if (res.mcp_port) {
    serverPort = res.mcp_port;
  }
  connectWebSocket();
});

// Listen for port changes from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mcp_port) {
    serverPort = changes.mcp_port.newValue;
    if (socket) {
      socket.close();
    }
    connectWebSocket();
  }
});

// Setup Keep-Alive Alarm (Manifest V3)
chrome.alarms.create('mcp_keep_alive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mcp_keep_alive') {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }
});

function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsUrl = `ws://127.0.0.1:${serverPort}`;
  console.log(`[MCP Bridge] Connecting to ${wsUrl}...`);

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[MCP Bridge] Connected to MCP Server!');
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Green
      broadcastTabs();
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        const { id, action, payload } = message;

        const response = await handleServerCommand(action, payload);
        socket.send(
          JSON.stringify({
            id,
            success: true,
            data: response,
          })
        );
      } catch (err) {
        console.error('[MCP Bridge] Error handling server command:', err);
        try {
          const msgObj = JSON.parse(event.data);
          socket.send(
            JSON.stringify({
              id: msgObj.id,
              success: false,
              error: err.message || String(err),
            })
          );
        } catch (_) {}
      }
    };

    socket.onclose = () => {
      console.warn('[MCP Bridge] WebSocket connection closed. Will reconnect...');
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // Red
      socket = null;
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.error('[MCP Bridge] WebSocket error:', err);
      if (socket) {
        socket.close();
      }
    };
  } catch (err) {
    console.error('[MCP Bridge] Connect error:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, 3000);
  }
}

// -------------------------------------------------------------
// Helper: Get Active / Target Tab
// -------------------------------------------------------------
async function getTargetTab(tabId) {
  if (tabId) {
    return await chrome.tabs.get(tabId);
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    return tabs[0];
  }
  const allTabs = await chrome.tabs.query({ active: true });
  if (allTabs.length > 0) {
    return allTabs[0];
  }
  throw new Error('No active browser tab found');
}

// -------------------------------------------------------------
// Helper: Ensure Content Script is loaded & Send Message
// -------------------------------------------------------------
async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // If content script is not yet injected, inject it dynamically
    if (err.message && err.message.includes('Receiving end does not exist')) {
      console.log(`[MCP Bridge] Injecting content script into tab ${tabId}...`);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Small pause for script to initialize
      await new Promise((r) => setTimeout(r, 200));
      return await chrome.tabs.sendMessage(tabId, message);
    }
    throw err;
  }
}

// -------------------------------------------------------------
// Broadcast tab changes to server
// -------------------------------------------------------------
async function broadcastTabs() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  try {
    const tabs = await chrome.tabs.query({});
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0] || null;

    socket.send(
      JSON.stringify({
        type: 'tabs_update',
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId,
        })),
        activeTab: activeTab
          ? {
              id: activeTab.id,
              url: activeTab.url,
              title: activeTab.title,
              active: true,
              windowId: activeTab.windowId,
            }
          : null,
      })
    );
  } catch (err) {
    console.error('[MCP Bridge] broadcastTabs error:', err);
  }
}

// Tab change listeners
chrome.tabs.onActivated.addListener(() => broadcastTabs());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    broadcastTabs();
  }
});
chrome.tabs.onRemoved.addListener(() => broadcastTabs());

// -------------------------------------------------------------
// Handle commands from MCP server
// -------------------------------------------------------------
async function handleServerCommand(action, payload = {}) {
  switch (action) {
    case 'GET_STATUS': {
      const tabs = await chrome.tabs.query({});
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return {
        connected: true,
        port: serverPort,
        activeTab: activeTabs[0] || null,
        tabCount: tabs.length,
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
        })),
      };
    }

    case 'OPEN_URL': {
      let targetTab;
      if (payload.newTab) {
        targetTab = await chrome.tabs.create({ url: payload.url, active: true });
      } else {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs.length > 0) {
          targetTab = await chrome.tabs.update(activeTabs[0].id, { url: payload.url });
        } else {
          targetTab = await chrome.tabs.create({ url: payload.url, active: true });
        }
      }

      // Wait for page load
      const tabId = targetTab.id;
      await new Promise((resolve) => {
        let timeoutTimer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(updateListener);
          resolve(null);
        }, 15000);

        function updateListener(updatedId, info) {
          if (updatedId === tabId && info.status === 'complete') {
            clearTimeout(timeoutTimer);
            chrome.tabs.onUpdated.removeListener(updateListener);
            resolve(null);
          }
        }
        chrome.tabs.onUpdated.addListener(updateListener);
      });

      // Small delay to let initial JS run
      await new Promise((r) => setTimeout(r, 600));

      const finalTab = await chrome.tabs.get(tabId);
      return {
        tabId: finalTab.id,
        url: finalTab.url,
        title: finalTab.title,
        status: finalTab.status,
      };
    }

    case 'SCREENSHOT': {
      const activeTab = await getTargetTab(payload.tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
        format: 'png',
      });
      return { dataUrl };
    }

    // All in-page actions forwarded to content script
    case 'READ_PAGE':
    case 'GET_ELEMENTS':
    case 'CLICK':
    case 'FILL_INPUT':
    case 'PRESS_KEY':
    case 'SCROLL':
    case 'EVALUATE_JS': {
      const targetTab = await getTargetTab(payload.tabId);
      if (!targetTab || !targetTab.id) {
        throw new Error('No target tab found for command ' + action);
      }

      const res = await sendToContentScript(targetTab.id, {
        action,
        payload,
      });

      if (!res) {
        throw new Error(`Content script returned empty response for ${action}`);
      }

      if (!res.success) {
        throw new Error(res.error || `Action ${action} failed in webpage`);
      }

      return res.data;
    }

    default:
      throw new Error(`Unknown background action: ${action}`);
  }
}
