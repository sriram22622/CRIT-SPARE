/**
 * CRIT-SPARE Privacy-First Analytics Module
 * Zero-cookie telemetry that respects operator privacy and consent preferences.
 */
import { STORAGE_KEYS } from './config.js';

class AnalyticsTracker {
  constructor() {
    this.sessionEvents = [];
    this.startTime = Date.now();
  }

  isConsentGiven() {
    // Only track if consent has been explicitly given or essential telemetry is allowed
    return localStorage.getItem(STORAGE_KEYS.cookieChoice) === 'saved';
  }

  trackEvent(category, action, label = '', value = 0) {
    if (!this.isConsentGiven()) return;
    const event = {
      category,
      action,
      label,
      value,
      timestamp: new Date().toISOString(),
      timeOnPageMs: Date.now() - this.startTime
    };
    this.sessionEvents.push(event);
    if (this.sessionEvents.length > 50) this.sessionEvents.shift();

    // Log telemetry event in development or dispatch for inspection
    window.dispatchEvent(new CustomEvent('app:analytics', { detail: event }));
  }

  trackPageView(pageName) {
    this.trackEvent('navigation', 'page_view', pageName || document.body.dataset.page || location.pathname);
  }
}

export const analytics = new AnalyticsTracker();
export function initAnalytics() {
  analytics.trackPageView();
}

