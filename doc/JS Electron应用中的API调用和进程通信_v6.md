# Electron 通信模板 v6（企业级结构：IPC 统一调度 + 日志 + 状态管理思路）

> JS 版本，不包含 TypeScript。

---

## 一、v6 的目标

v6 不只是“能通信”，而是让通信结构更适合真实项目维护：

- IPC channel 统一管理
- main process 统一注册 IPC
- preload 统一暴露安全 API
- renderer 只调用业务 API
- 加入日志系统
- 加入简单状态管理思路
- 为后期扩展多窗口、多模块、多业务做准备

---

## 二、推荐文件结构

```txt
src/
  main/
    main.js
    windows/
      createMainWindow.js
    ipc/
      index.js
      app.ipc.js
      file.ipc.js
      log.ipc.js
    services/
      app.service.js
      file.service.js
      log.service.js

  preload/
    index.js
    api/
      app.api.js
      file.api.js
      log.api.js

  renderer/
    main.jsx
    App.jsx
    store/
      appStore.js
    pages/
      Home.jsx
```

---

## 三、分层理解

```txt
renderer/App.jsx
  ↓
window.api.xxx()
  ↓
preload/api/*.api.js
  ↓
ipcRenderer.invoke / send
  ↓
main/ipc/*.ipc.js
  ↓
main/services/*.service.js
```

---

## 四、IPC Channel 统一命名

建议统一格式：

```txt
模块:动作
```

例如：

```txt
app:get-version
file:read-text
log:write
window:open-main
```

---

## 五、main/services/app.service.js

```js
function getVersion(app) {
  return app.getVersion();
}

module.exports = {
  getVersion,
};
```

---

## 六、main/services/file.service.js

```js
const fs = require('fs');

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

module.exports = {
  readTextFile,
};
```

---

## 七、main/services/log.service.js

```js
function writeLog(message) {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
}

module.exports = {
  writeLog,
};
```

---

## 八、main/ipc/app.ipc.js

```js
const appService = require('../services/app.service');

function registerAppIPC(ipcMain, app) {
  ipcMain.handle('app:get-version', () => {
    return appService.getVersion(app);
  });
}

module.exports = registerAppIPC;
```

---

## 九、main/ipc/file.ipc.js

```js
const { dialog } = require('electron');
const fileService = require('../services/file.service');

function registerFileIPC(ipcMain) {
  ipcMain.handle('file:read-text', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text Files', extensions: ['txt', 'md'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = fileService.readTextFile(filePath);

    return {
      filePath,
      content,
    };
  });
}

module.exports = registerFileIPC;
```

---

## 十、main/ipc/log.ipc.js

```js
const logService = require('../services/log.service');

function registerLogIPC(ipcMain) {
  ipcMain.on('log:write', (event, message) => {
    logService.writeLog(message);
  });
}

module.exports = registerLogIPC;
```

---

## 十一、main/ipc/index.js

```js
const registerAppIPC = require('./app.ipc');
const registerFileIPC = require('./file.ipc');
const registerLogIPC = require('./log.ipc');

function registerAllIPC(ipcMain, app) {
  registerAppIPC(ipcMain, app);
  registerFileIPC(ipcMain);
  registerLogIPC(ipcMain);
}

module.exports = registerAllIPC;
```

---

## 十二、main/windows/createMainWindow.js

```js
const { BrowserWindow } = require('electron');
const path = require('path');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  return mainWindow;
}

module.exports = createMainWindow;
```

---

## 十三、main/main.js

```js
const { app, ipcMain } = require('electron');
const createMainWindow = require('./windows/createMainWindow');
const registerAllIPC = require('./ipc');

let mainWindow = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  // 统一注册 IPC
  registerAllIPC(ipcMain, app);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

---

## 十四、preload/api/app.api.js

```js
function createAppAPI(ipcRenderer) {
  return {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
  };
}

module.exports = createAppAPI;
```

---

## 十五、preload/api/file.api.js

```js
function createFileAPI(ipcRenderer) {
  return {
    readText: () => ipcRenderer.invoke('file:read-text'),
  };
}

module.exports = createFileAPI;
```

---

## 十六、preload/api/log.api.js

```js
function createLogAPI(ipcRenderer) {
  return {
    write: (message) => ipcRenderer.send('log:write', message),
  };
}

module.exports = createLogAPI;
```

---

## 十七、preload/index.js

```js
const { contextBridge, ipcRenderer } = require('electron');

const createAppAPI = require('./api/app.api');
const createFileAPI = require('./api/file.api');
const createLogAPI = require('./api/log.api');

contextBridge.exposeInMainWorld('api', {
  app: createAppAPI(ipcRenderer),
  file: createFileAPI(ipcRenderer),
  log: createLogAPI(ipcRenderer),
});
```

---

## 十八、renderer/store/appStore.js

这是一个简单的状态管理思路，不引入 Redux / Zustand。

```js
let appState = {
  version: '',
  fileContent: '',
};

const listeners = new Set();

function getState() {
  return appState;
}

function setState(partialState) {
  appState = {
    ...appState,
    ...partialState,
  };

  listeners.forEach((listener) => listener(appState));
}

function subscribe(listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export const appStore = {
  getState,
  setState,
  subscribe,
};
```

---

## 十九、renderer/App.jsx

```jsx
import { useEffect, useState } from 'react';
import { appStore } from './store/appStore';

export default function App() {
  const [state, setState] = useState(appStore.getState());

  useEffect(() => {
    const unsubscribe = appStore.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, []);

  async function handleGetVersion() {
    const version = await window.api.app.getVersion();

    appStore.setState({
      version,
    });

    window.api.log.write(`Get version: ${version}`);
  }

  async function handleReadFile() {
    const result = await window.api.file.readText();

    if (!result) {
      appStore.setState({
        fileContent: 'No file selected.',
      });
      return;
    }

    appStore.setState({
      fileContent: result.content,
    });

    window.api.log.write(`Read file: ${result.filePath}`);
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Electron Communication v6</h1>

      <section>
        <h2>App Info</h2>
        <button onClick={handleGetVersion}>Get Version</button>
        <p>Version: {state.version}</p>
      </section>

      <hr />

      <section>
        <h2>File</h2>
        <button onClick={handleReadFile}>Read Text File</button>
        <pre>{state.fileContent}</pre>
      </section>
    </div>
  );
}
```

---

## 二十、v6 的核心优点

| 层 | 职责 |
|---|---|
| renderer | UI 和用户交互 |
| preload | 暴露安全 API |
| ipc | 注册通信通道 |
| service | 真正业务逻辑 |
| windows | 管理窗口创建 |

---

## 二十一、为什么 v6 更适合真实项目？

因为它避免了：

```txt
main.js 越写越大
preload.js 越写越乱
IPC channel 到处散落
React 页面直接写太多通信细节
```

v6 让项目变成：

```txt
UI 层
API 层
IPC 层
Service 层
Window 层
```

这和后端项目的分层思想很接近。

---

## 二十二、重要原则

```txt
React 不直接碰 Node。
preload 不写复杂业务。
ipc 只负责通信注册。
service 才写业务逻辑。
main.js 只负责启动和组装。
```

---

## 二十三、下一步可升级方向

v7 可以继续加入：

- 多窗口专用 router
- IPC channel 常量文件
- 参数校验工具
- 日志写入本地文件
- 错误统一返回格式
- 自动更新模块
- 数据库模块，例如 SQLite
