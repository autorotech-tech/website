/**
 * Runtime защита от реверс-инжиниринга
 * Детектирует открытие инструментов разработчика (DevTools)
 */

// Проверка размера окна (DevTools обычно изменяют размер окна)
let devToolsOpen = false;
const threshold = 160;

function detectDevTools(): void {
  const widthThreshold = window.outerWidth - window.innerWidth > threshold;
  const heightThreshold = window.outerHeight - window.innerHeight > threshold;
  
  if (widthThreshold || heightThreshold) {
    if (!devToolsOpen) {
      devToolsOpen = true;
      // Можно добавить логирование или уведомление
      console.clear();
      console.log('%c⚠️ Защита от реверс-инжиниринга', 'color: red; font-size: 20px; font-weight: bold;');
      console.log('%cИспользование инструментов разработчика ограничено.', 'color: red; font-size: 14px;');
    }
  } else {
    devToolsOpen = false;
  }
}

// Проверка через console.debug
let devToolsOpenByConsole = false;
const element = new Image();
const isProd = typeof import.meta !== 'undefined' && !!import.meta.env?.PROD;
Object.defineProperty(element, 'id', {
  get: function() {
    if (!devToolsOpenByConsole) {
      devToolsOpenByConsole = true;
      console.clear();
      console.log('%c⚠️ Защита от реверс-инжиниринга', 'color: red; font-size: 20px; font-weight: bold;');
    }
    return 'devtools-detector';
  }
});

// Проверка через debugger
const checkDebugger = () => {
  const start = performance.now();
  debugger; // eslint-disable-line no-debugger
  const end = performance.now();
  if (end - start > 100) {
    console.clear();
    console.log('%c⚠️ Обнаружена отладка', 'color: red; font-size: 20px; font-weight: bold;');
  }
};

// Защита от правого клика и контекстного меню (опционально, можно отключить)
// Функции оставлены для возможного использования в будущем
// @ts-ignore - неиспользуемая функция, оставлена для возможного использования
function disableContextMenu(_e: MouseEvent): void {
  // Разрешаем правый клик на элементах ввода (input, textarea)
  // const target = _e.target as HTMLElement;
  // if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
  //   return;
  // }
  // e.preventDefault();
}

// Защита от горячих клавиш для открытия DevTools
// @ts-ignore - неиспользуемая функция, оставлена для возможного использования
function disableDevToolsShortcuts(_e: KeyboardEvent): void {
  // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U
  // if (
  //   _e.key === 'F12' ||
  //   (_e.ctrlKey && _e.shiftKey && ['I', 'J', 'C'].includes(_e.key)) ||
  //   (_e.ctrlKey && _e.key === 'U')
  // ) {
  //   _e.preventDefault();
  // }
}

// Инициализация защиты
export function initAntiDebug(): void {
  // Проверка размера окна каждые 500ms
  setInterval(detectDevTools, 500);
  
  // Проверка через console (реже, чтобы не нагружать)
  setInterval(() => {
    console.log(element);
    console.clear();
  }, 1000);
  
  // Проверка debugger (реже, чтобы не замедлять работу)
  if (isProd) {
    setInterval(checkDebugger, 2000);
  }
  
  // Защита от контекстного меню (опционально)
  // document.addEventListener('contextmenu', disableContextMenu);
  
  // Защита от горячих клавиш (можно отключить, если мешает работе)
  // document.addEventListener('keydown', disableDevToolsShortcuts);
  
  // Очистка консоли при загрузке
  if (isProd) {
    console.clear();
  }
}

