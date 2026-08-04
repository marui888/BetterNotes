# Electron 通信模板 v5（完整项目结构）

## 目标
可直接用于开发的标准架构

## 结构
src/
  main/
    main.js
    ipc/
      app.js
      file.js
  preload/
    index.js
    modules/
      app.js
      file.js
  renderer/
    main.jsx
    App.jsx

## main/ipc/app.js
module.exports = (ipcMain, app) => {
  ipcMain.handle('app:get-version', () => app.getVersion());
};

## main.js
const { ipcMain, app } = require('electron');
require('./ipc/app')(ipcMain, app);

## preload/modules/app.js
const { ipcRenderer } = require('electron');

module.exports = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
};

## renderer 使用
window.api.app.getVersion()

## 特点
- 分层清晰
- 易扩展
- 可维护性强
