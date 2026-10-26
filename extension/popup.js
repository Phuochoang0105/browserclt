document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const portInput = document.getElementById('portInput');
  const saveBtn = document.getElementById('saveBtn');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const reconnectBtn = document.getElementById('reconnectBtn');

  // Load configured port
  chrome.storage.local.get(['mcp_port'], (res) => {
    if (res.mcp_port) {
      portInput.value = res.mcp_port;
    }
    checkStatus();
  });

  // Load active tab info
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      tabTitle.textContent = tabs[0].title || 'Untitled Tab';
      tabUrl.textContent = tabs[0].url || '';
    } else {
      tabTitle.textContent = 'No active tab';
      tabUrl.textContent = '';
    }
  });

  function checkStatus() {
    chrome.action.getBadgeText({}, (text) => {
      if (text === 'ON') {
        statusBadge.className = 'status-badge connected';
        statusText.textContent = 'Connected';
      } else {
        statusBadge.className = 'status-badge disconnected';
        statusText.textContent = 'Disconnected';
      }
    });
  }

  saveBtn.addEventListener('click', () => {
    const port = parseInt(portInput.value, 10);
    if (port && port > 1024 && port < 65535) {
      chrome.storage.local.set({ mcp_port: port }, () => {
        saveBtn.textContent = 'Saved!';
        setTimeout(() => {
          saveBtn.textContent = 'Save';
          checkStatus();
        }, 1200);
      });
    }
  });

  reconnectBtn.addEventListener('click', () => {
    reconnectBtn.textContent = 'Reconnecting...';
    // Trigger reconnect by re-saving port
    const port = parseInt(portInput.value, 10) || 3025;
    chrome.storage.local.set({ mcp_port: port }, () => {
      setTimeout(() => {
        reconnectBtn.textContent = 'Reconnect Server';
        checkStatus();
      }, 1000);
    });
  });

  // Periodic status poll while popup is open
  setInterval(checkStatus, 1000);
});
