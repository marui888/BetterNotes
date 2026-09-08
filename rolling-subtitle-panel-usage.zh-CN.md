# Rolling Subtitle Panel 使用说明

`RollingSubtitlePanel` 是一个可复用的滚动字幕面板组件。它负责字幕显示、滚动、高亮、字体大小、时间偏移、字幕选择和面板拖动/缩放；视频播放、字幕文件加载、笔记保存等业务逻辑由外部组件负责。

## 目录结构

```txt
src/renderer/components/rollingSubtitle/
├─ index.js
├─ RollingSubtitlePanel.jsx
├─ RollingSubtitlePanel.css
├─ subtitleTiming.js
├─ subtitleMotion.js
└─ subtitleWindowing.js
```

文件职责：

- `RollingSubtitlePanel.jsx`：React 组件主体，负责 UI、状态和事件连接。
- `RollingSubtitlePanel.css`：面板、字幕行、caption 控制区、resize handle 的样式。
- `subtitleTiming.js`：字幕 active cue 计算、Timing Offset 显示格式。
- `subtitleMotion.js`：Follow / Float 滚动算法、可见区域计算、平滑和修正参数。
- `subtitleWindowing.js`：字幕渲染窗口计算，避免一次性渲染全部字幕 DOM。
- `index.js`：统一导出组件和算法工具。

## 最小用法

```jsx
import RollingSubtitlePanel from '../components/rollingSubtitle'

<RollingSubtitlePanel
  containerRef={videoStageRef}
  cues={rollingSubtitleCues}
  currentTime={currentPlaybackTime}
  getCurrentTime={() => playerRef.current?.currentTime?.()}
  defaultFontSize={25}
  onCueClick={(cue) => {
    playerRef.current?.currentTime?.(cue.start)
  }}
/>
```

最小用法只启用通用字幕能力：

- 字幕滚动显示
- 当前字幕高亮
- Follow / Float 模式切换
- Timing Offset 调整
- 字体大小选择
- Hide / Show 字幕内容
- 面板拖动、缩放、Dock 左中右切换

## Props

### 基础输入

| Prop | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `cues` | `Array` | `[]` | 字幕 cue 列表。 |
| `currentTime` | `number` | `0` | 当前播放时间，单位秒。 |
| `getCurrentTime` | `function` | `undefined` | 获取实时播放时间，优先于 `currentTime`。 |
| `containerRef` | `React ref` | `undefined` | 面板所在父容器，用于计算拖动、Dock、可见区域。 |
| `bottomPanelRef` | `React ref` | `undefined` | Dark layout 时用于避开底部区域。普通复用场景可不传。 |
| `defaultFontSize` | `number` | `25` | 默认字幕字号。 |
| `fontSizeKey` | `'normal' | 'overlay' | 'dark'` | `'normal'` | 不同视图下独立保存字号。 |

### 事件输出

| Prop | 类型 | 说明 |
|---|---|---|
| `onCueClick` | `(cue) => void` | 点击字幕行时触发，常用于跳转播放位置。 |
| `onSelectedSubtitlesChange` | `(selectedCues) => void` | Add Subs 选择状态变化时触发。 |
| `onAddSelectedSubtitles` | `(selectedCues) => boolean | Promise<boolean>` | 点击 Add Subs 确认时触发。返回 `false` 表示不退出选择状态。 |
| `onToggleDarkViewDim` | `() => void` | 点击 Dim 按钮时触发。 |

### 可选能力开关

| Prop | 默认值 | 说明 |
|---|---:|---|
| `enableDimView` | `false` | 是否显示 `Dim` 按钮。 |
| `enableDarkLayout` | `false` | 是否启用 Dark View 自动布局能力。 |
| `enableSubtitleNoteAdding` | `false` | 是否启用 Add Subs 字幕选句生成笔记能力。 |

这些能力默认关闭，所以在其它项目中复用时，不会自动带入 `prj_videoPlayer_new` 的专属交互。

### Dark View 相关

| Prop | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `darkModeActive` | `boolean` | `false` | 当前是否处于 Dark View。只有 `enableDarkLayout=true` 时才影响布局。 |
| `darkSubView` | `number` | `0` | Dark View 子视图编号，用于显示 Dim 状态标签。 |
| `darkLayoutRequest` | `number` | `0` | 外部递增该值时，触发 panel 自动按 Dark View 布局。 |
| `darkViewDim` | `number` | `0.65` | Dim 强度显示用。 |

## Cue 数据结构

组件期望 `cues` 至少包含：

```js
{
  id: 'unique-cue-id',
  start: 12.3,
  end: 15.8,
  text: 'subtitle text'
}
```

可选字段：

```js
{
  groupId: 'cue-group-id',
  groupIds: ['cue-group-id'],
  groupLineIndex: 0,
  groupSize: 2
}
```

如果存在 `groupId/groupIds`，高亮会按组处理。比如一个原始字幕 cue 包含两行，组件可以同时高亮这两行。

## 当前交互

caption 控制区停靠在 panel 右侧，默认隐藏。鼠标移动到 caption 区、控件获得焦点、或处于 Add Subs 状态时显示。

caption 内部控件：

- 字体大小下拉框
- Timing Offset `- / +`
- `Dock`：左停靠、居中、右停靠循环切换
- `Follow / Float`：滚动模式切换
- `Dim`：可选，依赖 `enableDimView`
- `Hide / Show`：隐藏或恢复字幕内容，但不隐藏 panel
- `Add Subs`：可选，依赖 `enableSubtitleNoteAdding`
- `Cancel Subs`：Add Subs 状态下显示

## Dock 行为

点击 `Dock` 后，panel 在父容器内按三个状态循环：

```txt
left -> center -> right -> left ...
```

每次 Dock 会重新设置：

```txt
width  ≈ 父容器宽度 * 0.48
height ≈ 父容器高度 * 0.95
```

手动拖动和手动 resize 不会改变 Dock 状态；下次点击 `Dock` 时，再继续切换到下一个 Dock 状态。

## 渲染窗口优化

组件不会一次性把所有字幕行渲染到 DOM。它只渲染当前高亮字幕附近的一段窗口：

```txt
当前字幕前 30 条
当前字幕后 60 条
```

这样长视频、长字幕文件也不会产生过多 DOM 节点。窗口切换时会记录当前高亮行的视觉位置，并在新窗口渲染后补偿 offset，减少切换时的跳动。

## Follow 与 Float

`Follow`：

- 依据当前字幕附近的局部平均速度滚动。
- 当前字幕如果离开舒适可见区，会被平滑拉回。

`Float`：

- 依据字幕行位置拟合一条 offset 曲线。
- 当前字幕不可见时做弱修正。

两种模式的 offset 状态是分开的，互不混用，方便比较效果。

## 在 prj_videoPlayer_new 中的接入

当前项目在 `VideoMode.jsx` 中这样接入：

```jsx
<RollingSubtitlePanel
  bottomPanelRef={videoBottomPanelRef}
  containerRef={videoStageRef}
  cues={rollingSubtitleCues}
  currentTime={currentPlaybackTime}
  darkModeActive={fullscreenCycleState === 4}
  darkSubView={darkSubView}
  darkLayoutRequest={rollingSubtitleDarkLayoutRequest}
  darkViewDim={runtimeDarkViewDim}
  enableDarkLayout
  enableDimView
  enableSubtitleNoteAdding
  defaultFontSize={rollingSubtitleFontSize}
  fontSizeKey={rollingSubtitleFontSizeKey}
  getCurrentTime={() => playerRef.current?.currentTime?.()}
  onAddSelectedSubtitles={addSelectedSubtitleNote}
  onToggleDarkViewDim={toggleDarkViewDim}
  onSelectedSubtitlesChange={previewSelectedSubtitleNote}
  onCueClick={jumpToSubtitleCue}
/>
```

这里显式开启了三个项目专属能力：

```jsx
enableDarkLayout
enableDimView
enableSubtitleNoteAdding
```

## 复用到其它项目

例如复用到 `prj_annotation_lab`，第一版可以只复制整个目录：

```txt
src/renderer/components/rollingSubtitle/
```

然后用最小 props 接入：

```jsx
<RollingSubtitlePanel
  containerRef={mediaStageRef}
  cues={subtitleCues}
  currentTime={currentTime}
  getCurrentTime={() => videoElementRef.current?.currentTime ?? 0}
  defaultFontSize={25}
  onCueClick={(cue) => {
    if (videoElementRef.current) videoElementRef.current.currentTime = cue.start
  }}
/>
```

如果目标项目暂时不需要字幕选句生成笔记，不要传 `enableSubtitleNoteAdding`。

如果目标项目暂时不需要 Dark View，不要传 `enableDarkLayout` 和 `enableDimView`。

## 注意事项

1. `containerRef` 很重要。拖动、缩放、Dock、可见区域计算都依赖它。
2. `getCurrentTime` 比 `currentTime` 更适合播放中的实时滚动。
3. 字幕 cue 的 `id` 必须稳定且唯一，否则 Add Subs 选择状态可能异常。
4. 如果外部播放器 seek，组件会自动基于当前时间重新定位 active cue。
5. 如果字体大小、panel 尺寸、字幕列表变化，组件会重新测量布局。

## 后续可改进

- 把 caption 控件进一步拆成子组件。
- 把 panel 位置和大小通过 `value/onChange` 交给外部持久化。
- 把 Follow / Float 参数变成 props，方便不同项目调优。
- 增加 keyboard shortcuts 支持，但快捷键注册应放在外部项目的 Action Registry 中。
- 做成真正的本地 npm package 或 shared workspace package。