

## //mr:: 2026_04_30 13_14_39
1. 给Electron的应该，安装react dev tool时，Electron可能支持的不好。需要 在代码中
   先执行打开Electron dev tool，
   然后加载 react dev tool的扩展，
   然后再强制刷新 mainWindow.webContents.reloadIgnoringCache(); 
   （代码在main.js)