# Electron 通信模板 v4（安全控制）

## 目标
限制 renderer 可调用的能力，防止滥用。

## 原则
- 白名单 channel
- 参数校验
- 不暴露底层 API

## preload 示例
const allowedChannels = ['app:get-version'];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!allowedChannels.includes(channel)) {
      throw new Error('Not allowed');
    }
    return ipcRenderer.invoke(channel, ...args);
  }
});

## main 示例
ipcMain.handle('app:get-version', () => app.getVersion());

## 强化建议
- 参数类型检查
- 数据过滤
- 权限分级（用户角色）
