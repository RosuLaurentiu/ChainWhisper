export {};

declare global {
  interface NotificationOptions {
    /** Allow renotify flag for repeated notifications (not in older lib.dom) */
    renotify?: boolean;
  }
}
