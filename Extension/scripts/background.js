/**
 * LinkedIn SpeedFill - Service Worker Background Script
 * Handles commands, desktop notifications, and storage setup
 */

// Initialize default profile into storage if empty
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['userProfile'], (result) => {
    if (!result.userProfile) {
      fetch(chrome.runtime.getURL('data/default_profile.json'))
        .then(response => response.json())
        .then(data => {
          chrome.storage.local.set({ userProfile: data });
          console.log('[LinkedIn SpeedFill] Default profile initialized');
        })
        .catch(err => console.error('[LinkedIn SpeedFill] Error loading default profile:', err));
    }
  });
});

// Handle keyboard hotkeys (Alt+F)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'fill_form') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_AUTOFILL' });
      }
    });
  }
});

// Handle background notifications
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_NOTIFICATION') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: message.title || '⚡ LinkedIn SpeedFill Alert',
      message: message.message || 'Action required on application tab.'
    });
  }
});
