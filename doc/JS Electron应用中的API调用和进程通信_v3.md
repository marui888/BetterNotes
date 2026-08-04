# Electron 通信模板 v3（模块化 API 设计）

## 目标
将 preload API 按模块拆分，类似后端分层结构。

## 结构
src/
  preload/
    index.js
    app.js
    file.js

## preload/index.js
const { contextBridge } = require('electron');
const appAPI = require('./app');
const fileAPI = require('./file');

contextBridge.exposeInMainWorld('api', {
  app: appAPI,
  file: fileAPI,
});

## preload/app.js
const { ipcRenderer } = require('electron');

module.exports = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
};

## preload/file.js
const { ipcRenderer } = require('electron');

module.exports = {
  readText: () => ipcRenderer.invoke('file:read-text'),
};

## React 使用
window.api.app.getVersion()
window.api.file.readText()
