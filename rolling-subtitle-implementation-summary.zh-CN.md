# Rolling 字幕实现总结

## 1. 目标

视频模式原来使用 video.js 的 native 字幕显示方式。native 字幕一次只显示当前字幕，位置和样式由浏览器/video.js 控制，适合普通播放，但不适合“看长字幕、跟读、快速浏览上下文”的场景。

Rolling 字幕模式的目标是：

- 用一个可拖动、可缩放的悬浮 panel 显示字幕。
- 字幕像电影片尾名单一样，以上下列表形式显示多行。
- 当前字幕行随播放时间高亮。
- 用户可以改变 panel 字体大小。
- 字幕 panel 背景透明或接近透明，不遮挡视频太多。
- native 字幕和 rolling 字幕互斥显示。
- 在 Toggle View 的“黑暗视图”中，rolling 字幕可以作为主要阅读内容显示。

## 2. 实现过程

### 2.1 增加字幕显示模式

在 `Setting -> General -> Video` 中增加 `Subtitle Display Mode`：

- `native`
- `rolling`

视频模式根据这个设置决定：

- `native`：把字幕交给 video.js 显示。
- `rolling`：关闭 native 字幕轨道，改用自定义 `RollingSubtitlePanel` 显示。

这样避免 native 字幕和 rolling 字幕同时出现。

### 2.2 解析字幕文件

Rolling 字幕需要自己知道每一行字幕的：

- start time
- end time
- text

因此增加了 subtitle cue 解析逻辑，把 VTT/SRT 转成统一的 cue 列表。

重复字幕行会被过滤，避免 panel 里出现连续重复内容。

### 2.3 实现 RollingSubtitlePanel

`RollingSubtitlePanel` 是一个覆盖在视频区域上的 React 组件。

主要功能：

- 显示字幕列表。
- 根据播放器当前时间计算 active cue。
- 高亮当前字幕。
- 支持点击字幕跳转到对应时间。
- 支持拖动 panel 位置。
- 支持拖动右上角/右下角改变 panel 大小。
- 支持字体大小 `[-] [25px] [+]` 调节。
- 支持 `Dim` 按钮切换黑暗视图遮罩强度。

### 2.4 字幕滚动算法演进

最初方案接近“时间同步定位”：

- 每一帧根据当前播放时间计算当前字幕应该出现的位置。
- 直接把当前字幕拉到目标位置。

这个方案的问题是：字幕句子之间的时间间隔不固定，而列表中句子之间的空间距离是固定的，播放时间和视觉距离不成比例，会出现轻微跳动。

后来改为：

- 预先基于当前字幕附近的若干行计算局部平均滚动速度。
- 播放时主要按这个局部速度平滑移动。
- 如果当前字幕快离开可见区域，再做有限幅度的位置修正。
- 修正不是一次拉回，而是分多帧逐步修正。

这样减少了频繁强制定位造成的跳动。

### 2.5 性能优化

Rolling 字幕刚开始会频繁读取 DOM 尺寸，例如 `getBoundingClientRect()`，导致 UI 响应变慢。

后续优化为：

- 字幕行布局只在 cue/font/panel size 变化时重新计算。
- panel 可见区域信息缓存到 ref。
- 播放过程中尽量只用缓存数据。
- 使用 `transform: translate3d(...)` 移动字幕列表，减少 layout/reflow。
- 使用 `requestAnimationFrame` 驱动滚动。
- active cue 查找从“每次从头扫描”改成“从上一次 active index 附近查找”。

### 2.6 黑暗视图支持

Toggle View 增加了一个黑暗视图状态。

黑暗视图中：

- 视频仍继续播放。
- 视频背景被模糊处理。
- 视频亮度降低。
- 覆盖一层可调暗色遮罩。
- rolling 字幕 panel 自动移动到视频区域上方，横向居中，顶部顶满，底部不延伸到 Note Content 区域。

同时保证：

- 黑暗视图中的 panel 临时位置不持久化。
- 退出黑暗视图后恢复进入前的 panel 位置和大小。
- APP 恢复状态时不恢复 Toggle View 状态，默认回到普通视图。

### 2.7 Dark View Dim 设置

增加 `Dark View Blur` 和 `Dark View Dim` 设置项。

后续又在 rolling panel 字体控制区右边增加 `Dim` 按钮。

`Dim` 按钮会让 `Dark View Dim` 在以下值之间切换：

- `0`
- `0.5`
- `0.8`
- `1.0`

`1.0` 表示全黑遮罩。

这个按钮只修改设置值，不切换 Toggle View 状态。

## 3. 遇到的问题与解决方式

### 3.1 native 字幕和 rolling 字幕同时显示

问题：

取消勾选 subtitle 或切换 rolling 时，native 字幕仍可能显示。

解决：

- 明确 `titleOn && subtitleDisplayMode === 'native'` 时才把字幕传给 video.js。
- rolling 模式下不启用 native subtitle track。

### 3.2 字幕不自动滚动或高亮不生效

问题：

早期实现里 cue active 状态和滚动位置没有稳定绑定，导致列表停在末尾，或者高亮固定不动。

解决：

- 建立 `activeIndexRef`。
- 每帧根据播放器当前时间查找 active cue。
- active cue 变化时更新 React state。
- 滚动位置通过 ref 和 transform 更新。

### 3.3 字幕滚动抖动

问题：

按时间直接计算位置时，字幕行时间间隔不均匀，视觉上出现“一跳一跳”的移动。

解决：

- 引入局部平均速度。
- 使用未来/过去若干字幕行拟合局部滚动趋势。
- 当前字幕偏离舒适区域时再做有限修正。
- 避免每一帧把当前行硬拉到中心。

### 3.4 快放、慢放时滚动不同步

问题：

如果只按真实时间推进滚动，播放速度改变后字幕运动速度不匹配。

解决：

- 滚动步进基于 video currentTime 的变化量，而不是单纯基于真实帧间隔。
- 快放时滚动加快，慢放时滚动变慢。

### 3.5 panel 拖动和缩放后可见区域计算错误

问题：

panel 位置、大小变化后，当前行是否可见的判断可能失效。

解决：

- panel 拖动/缩放后刷新可见区域缓存。
- 字体大小变化和 ResizeObserver 触发后重建字幕布局。
- 计算可见区域时同时考虑 video stage、panel list、当前行位置。

### 3.6 黑暗视图修改了 panel 位置后被保留

问题：

进入黑暗视图会自动调整 panel 位置和大小；退出后如果保留这个调整，会破坏用户原来的 rolling 字幕布局。

解决：

- 进入黑暗视图时保存进入前的 panel rect。
- 黑暗视图只做临时 rect 修改。
- 退出黑暗视图后恢复原 rect。

### 3.7 黑暗视图过于单调

问题：

纯黑背景虽然干净，但看不出视频仍在播放。

解决：

- 改为模糊视频背景。
- 通过 blur + brightness + dim overlay 实现“看得出在动，但看不清内容”的效果。
- blur 和 dim 允许在设置中调整。

## 4. 当前方案优点

- 和 video.js native 字幕解耦，rolling 字幕可以完全自定义 UI。
- native / rolling 互斥，语义清楚。
- panel 可以拖动、缩放，适应不同视频和字幕长度。
- 字体大小可以在 panel 内直接调节。
- 使用 CSS transform 实现滚动，性能比频繁修改 scrollTop 或布局位置更稳。
- 黑暗视图和普通视图分离，黑暗视图不会污染普通视图的 panel 位置。
- `Dark View Dim` 和 `Dark View Blur` 已进入 settings，可配置。

## 5. 当前方案缺点

- 滚动算法仍然是启发式算法，不是严格排版引擎。
- 字幕时间间隔极不均匀时，仍可能出现局部速度不自然。
- 当前 active cue 的高亮位置不是绝对固定在中心，而是在可见区域内动态修正。
- 字幕解析、去重、滚动、panel UI 都在同一功能链里，后续如果继续复杂化，可能需要进一步分层。
- `Dim` 按钮目前显示为简单文本按钮，不是最终精致图标形态。
- 黑暗视图的 brightness 当前写死在 CSS 中，只有 blur 和 dim 可配置。

## 6. 后续改进空间

### 6.1 更稳定的滚动速度曲线

可以在字幕文件加载后预先生成完整的滚动速度曲线。

例如：

- 对每个 cue 计算理想位置。
- 对相邻 cue 做平滑插值。
- 对异常时间间隔做限制。
- 播放时直接查表或插值。

这样比实时启发式修正更稳定。

### 6.2 Web Worker 预计算

字幕很多时，可以把布局规划、速度曲线拟合放到 Worker。

主线程只负责：

- 接收当前时间。
- 查找当前 offset。
- 应用 transform。

### 6.3 暂停时的阅读模式

暂停视频时，可以允许 rolling panel：

- 停止自动滚动。
- 支持鼠标滚轮手动浏览字幕。
- 点击某行跳转后再恢复同步。

### 6.4 更完整的外观设置

后续可以加入：

- 高亮字体颜色。
- 普通字幕颜色。
- 字幕行间距。
- panel 透明度。
- 黑暗视图 brightness。
- 默认 panel 宽高比例。

### 6.5 字幕分组与段落化

长字幕可以按时间间隔或语义分段。

这样 rolling panel 可以显示更自然的段落结构，而不是纯粹逐行列表。

### 6.6 更精细的去重规则

当前主要处理连续重复行。

后续可以考虑：

- 忽略大小写去重。
- 忽略标点差异去重。
- 多语言字幕并排显示时的重复合并。

## 7. 当前相关文件

- `src/renderer/video/RollingSubtitlePanel.jsx`
- `src/renderer/video/RollingSubtitlePanel.css`
- `src/renderer/video/subtitleParser.js`
- `src/renderer/modes/VideoMode.jsx`
- `src/renderer/settings/SettingsDialog.jsx`
- `src/stores/settingsStore.js`
- `src/main.js`
- `src/index.css`

