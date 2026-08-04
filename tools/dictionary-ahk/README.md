# dictionary-ahk

AutoHotkey v1.1 bridge for testing dictionary automation before wiring it into Electron.

## Commands

```powershell
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk list
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk mdict anesthesia
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster anesthesia
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-read
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-both anesthesia
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-blue
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-read-blue
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-read-blue 2
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-blue-rows
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-output-rect
AutoHotkey.exe .\tools\dictionary-ahk\dictionary-bridge.ahk webster-click 100 200
```

## Behavior

- `list` prints visible dictionary-like windows as JSON.
- `mdict <word>` activates `ahk_class MDictMainWnd`, pastes the word, then sends Enter twice.
- `webster <word>` copies the old Visual C++ Webster handle initialization order exactly, writes the word to `m_hEditBox`, then clicks `m_hSearchButton`.
- `webster-read` copies the old Visual C++ Webster handle initialization order exactly, then sends `SendMessage(m_hOutput, WM_LBUTTONDBLCLK, 0, MAKELPARAM(165, 25))`.
- `webster-both <word>` initializes Webster handles once, sends the word to Webster, then reads the word.
- `webster-blue` scans the Webster output window for clustered blue text areas and reports all areas in the result JSON.
- `webster-read-blue [index]` scans the Webster output window and double-clicks the indexed blue area. The default index is `1`.
- `webster-blue-rows` reports every output-window row that contains blue pixels. Use it to diagnose whether a blue word was scanned but not grouped.
- `webster-output-rect` writes the Webster output child window screen rectangle and monitor information to the result JSON.
- `webster-click <screenX> <screenY>` double-clicks the specified screen coordinate.

Dictionary operation delays follow the old Visual C++ project style:

- MDict waits 500ms after the second Enter.
- Webster waits 50ms after `WM_SETTEXT` and 500ms after clicking the search button.

Each command writes the latest result to:

```text
tools\dictionary-ahk\dictionary-bridge-result.json
```

`list` and failure cases also show a message box, because AutoHotkey v1 GUI executables do not reliably print stdout in PowerShell.

The Webster read behavior follows the old Visual C++ project. If the current dictionary version has a different child-window layout, adjust `InitWebsterHandlesCopy()` in `dictionary-bridge.ahk`.

Blue text detection scans only the Webster output child window. It groups blue pixels into text-like areas, ignores the right scrollbar area, and selects the first valid top-left blue cluster.
