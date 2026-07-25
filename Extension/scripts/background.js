/**
 * LinkedIn SpeedFill – Background Service Worker v1.1
 * Handles: storage init, hotkey commands, application notifications
 */

// ─── Install: seed default profile ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.storage.local.get(['userProfile'], result => {
      if (!result.userProfile) {
        fetch(chrome.runtime.getURL('data/default_profile.json'))
          .then(r => r.json())
          .then(data => chrome.storage.local.set({ userProfile: data }))
          .catch(err => console.error('[SpeedFill] default profile load error:', err));
      }
    });
  }
});

// ─── Keyboard command: Alt+F → trigger autofill ─────────────────────────────
chrome.commands.onCommand.addListener(command => {
  if (command !== 'fill_form') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (tab?.id && tab.url?.includes('linkedin.com')) {
      chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTOFILL' });
    }
  });
});

// ─── Messages from content scripts ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Desktop notification request
  if (message.type === 'SHOW_NOTIFICATION') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: message.title || '⚡ LinkedIn SpeedFill',
      message: message.body || 'Action required on your LinkedIn tab.',
      priority: 2
    });
  }

  // Update badge counter on extension icon
  if (message.type === 'UPDATE_BADGE') {
    const count = String(message.count || '');
    chrome.action.setBadgeText({ text: count, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }
});
