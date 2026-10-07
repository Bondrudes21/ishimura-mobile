// Где мы запущены: внутри Android-приложения (Capacitor) или как сайт/PWA (iPhone, браузер)
import { Capacitor, registerPlugin } from '../../vendor/capacitor.js';

export { Capacitor };
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export const isAndroid = platform === 'android';
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

document.documentElement.dataset.platform = isNative ? platform : 'web';
if (isIOS) document.documentElement.dataset.ios = '';

// Собственный нативный плагин приложения (android/app/src/main/java/.../ArkPlugin.java)
export const Ark = isNative ? registerPlugin('Ark') : null;

export const APP_VERSION = '1.0.0';
