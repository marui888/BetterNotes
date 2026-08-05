; AutoHotkey v1.1 dictionary bridge for NoteReview TextMode.
; Usage:
;   AutoHotkey.exe dictionary-bridge.ahk list
;   AutoHotkey.exe dictionary-bridge.ahk mdict anesthesia
;   AutoHotkey.exe dictionary-bridge.ahk mdict-sendmsg anesthesia
;   AutoHotkey.exe dictionary-bridge.ahk mdict-sendmsg-restore anesthesia
;   AutoHotkey.exe dictionary-bridge.ahk mdict-cycle
;   AutoHotkey.exe dictionary-bridge.ahk mdict-cycle-post
;   AutoHotkey.exe dictionary-bridge.ahk mdict-gettext
;   AutoHotkey.exe dictionary-bridge.ahk webster anesthesia
;   AutoHotkey.exe dictionary-bridge.ahk webster-read
;   AutoHotkey.exe dictionary-bridge.ahk webster-both anesthesia
;   AutoHotkey.exe dictionary-bridge.ahk webster-blue
;   AutoHotkey.exe dictionary-bridge.ahk webster-read-blue
;   AutoHotkey.exe dictionary-bridge.ahk webster-blue-rows
;   AutoHotkey.exe dictionary-bridge.ahk webster-output-rect
;   AutoHotkey.exe dictionary-bridge.ahk webster-click 100 200
;   AutoHotkey.exe dictionary-bridge.ahk webster-client-dblclick 165 25

#NoEnv
#SingleInstance Off
#Warn
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

resultPath := A_ScriptDir . "\dictionary-bridge-result.json"

mode := A_Args.Length() >= 1 ? A_Args[1] : ""
word := A_Args.Length() >= 2 ? JoinArgsFrom(2) : ""
commandName := mode
startedAt := A_Now
Process, Exist
processId := ErrorLevel
FileDelete, %resultPath%
WriteStatusJson("running")

if (mode = "list") {
    ListDictionaryWindows()
    ExitApp, 0
}

if (mode = "mdict") {
    commandExitCode := LookupMDict(word)
    ExitApp, %commandExitCode%
}

if (mode = "mdict-sendmsg") {
    commandExitCode := LookupMDictByMessage(word)
    ExitApp, %commandExitCode%
}

if (mode = "mdict-sendmsg-restore") {
    commandExitCode := LookupMDictByMessageRestore(word)
    ExitApp, %commandExitCode%
}

if (mode = "mdict-cycle") {
    commandExitCode := CycleMDictDictionary()
    ExitApp, %commandExitCode%
}

if (mode = "mdict-cycle-post") {
    commandExitCode := CycleMDictDictionaryPost()
    ExitApp, %commandExitCode%
}

if (mode = "mdict-gettext") {
    commandExitCode := GetMDictInputTextCommand()
    ExitApp, %commandExitCode%
}

if (mode = "webster") {
    commandExitCode := LookupWebster(word)
    ExitApp, %commandExitCode%
}

if (mode = "webster-read") {
    commandExitCode := ReadWebsterOutputCopy()
    ExitApp, %commandExitCode%
}

if (mode = "webster-both") {
    commandExitCode := LookupWebsterAndRead(word)
    ExitApp, %commandExitCode%
}

if (mode = "webster-blue") {
    commandExitCode := FindWebsterBlueCommand(false)
    ExitApp, %commandExitCode%
}

if (mode = "webster-read-blue") {
    blueIndex := A_Args.Length() >= 2 ? A_Args[2] : 1
    commandExitCode := FindWebsterBlueCommand(true, blueIndex)
    ExitApp, %commandExitCode%
}

if (mode = "webster-blue-rows") {
    commandExitCode := WriteWebsterBlueRowsCommand()
    ExitApp, %commandExitCode%
}

if (mode = "webster-output-rect") {
    commandExitCode := WriteWebsterOutputRectCommand()
    ExitApp, %commandExitCode%
}

if (mode = "webster-click") {
    clickX := A_Args.Length() >= 2 ? A_Args[2] : ""
    clickY := A_Args.Length() >= 3 ? A_Args[3] : ""
    commandExitCode := WebsterClickCommand(clickX, clickY)
    ExitApp, %commandExitCode%
}

if (mode = "webster-client-dblclick") {
    clientDblClickX := A_Args.Length() >= 2 ? A_Args[2] : ""
    clientDblClickY := A_Args.Length() >= 3 ? A_Args[3] : ""
    commandExitCode := WebsterClientDoubleClickCommand(clientDblClickX, clientDblClickY)
    ExitApp, %commandExitCode%
}

WriteJson(false, "unknown-command")
ExitApp, 10

JoinArgsFrom(startIndex) {
    text := ""
    endIndex := A_Args.Length()
    if (endIndex >= startIndex && A_Args[endIndex] = "silent") {
        endIndex -= 1
    }

    Loop, % endIndex - startIndex + 1 {
        index := A_Index + startIndex - 1
        text .= (text = "" ? "" : " ") . A_Args[index]
    }
    return Trim(text)
}

LookupMDict(word) {
    word := Trim(word)
    if (word = "") {
        WriteJson(false, "empty-word")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, No word to lookup.
        }
        return 2
    }

    if !WinExist("ahk_class MDictMainWnd") {
        WriteJson(false, "mdict-not-found")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, MDict not found.
        }
        return 3
    }

    WinActivate, ahk_class MDictMainWnd
    WinWaitActive, ahk_class MDictMainWnd,, 2
    if ErrorLevel {
        WriteJson(false, "mdict-activate-failed")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, MDict activate failed.
        }
        return 4
    }

    PasteWord(word)
    Sleep, 80
    Send, {Enter}
    Sleep, 80
    Send, {Enter}
    Sleep, 500
    WriteJson(true, "")
    return 0
}

LookupMDictByMessage(word) {
    word := Trim(word)
    if (word = "") {
        WriteJson(false, "empty-word")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, No word to lookup.
        }
        return 2
    }

    handles := InitMDictHandlesCopy()
    if (!handles.ok) {
        WriteMDictHandlesJson(false, handles.reason, handles, -1, 0)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 12
    }

    if (!handles.input) {
        WriteMDictHandlesJson(false, "mdict-input-not-found", handles, -1, 0)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, MDict input not found.
        }
        return 13
    }

    WM_SETTEXT := 0x000C
    WM_KEYDOWN := 0x0100
    WM_KEYUP := 0x0101
    VK_RETURN := 0x0D
    scanCode := DllCall("MapVirtualKey", "UInt", VK_RETURN, "UInt", 0)
    keyDownLParam := 1 | (scanCode << 16)
    keyUpLParam := 1 | (scanCode << 16) | (1 << 30) | (1 << 31)

    DllCall("SendMessage", "Ptr", handles.input, "UInt", WM_SETTEXT, "Ptr", 0, "Str", word, "Ptr")
    Sleep, 80
    DllCall("PostMessage", "Ptr", handles.input, "UInt", WM_KEYDOWN, "Ptr", VK_RETURN, "Ptr", keyDownLParam)
    DllCall("PostMessage", "Ptr", handles.input, "UInt", WM_KEYUP, "Ptr", VK_RETURN, "Ptr", keyUpLParam)
    Sleep, 80
    DllCall("PostMessage", "Ptr", handles.input, "UInt", WM_KEYDOWN, "Ptr", VK_RETURN, "Ptr", keyDownLParam)
    DllCall("PostMessage", "Ptr", handles.input, "UInt", WM_KEYUP, "Ptr", VK_RETURN, "Ptr", keyUpLParam)
    Sleep, 300
    WriteMDictHandlesJson(true, "", handles, -1, 0)
    return 0
}

LookupMDictByMessageRestore(word) {
    oldForeground := DllCall("GetForegroundWindow", "Ptr")
    exitCode := LookupMDictByMessage(word)
    if (exitCode = 0 && oldForeground) {
        Sleep, 160
        DllCall("SetForegroundWindow", "Ptr", oldForeground)
    }
    return exitCode
}

InitMDictHandlesCopy() {
    handles := {}
    mainHwnd := DllCall("FindWindow", "Ptr", 0, "Str", "MDict", "Ptr")
    if (!mainHwnd) {
        handles.ok := false
        handles.reason := "mdict-not-found"
        return handles
    }

    inputParentHwnd := DllCall("FindWindowEx", "Ptr", mainHwnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr")
    inputHwnd := inputParentHwnd ? DllCall("FindWindowEx", "Ptr", inputParentHwnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr") : 0

    firstChildHwnd := DllCall("FindWindowEx", "Ptr", mainHwnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr")
    mainMenuHwnd := firstChildHwnd ? DllCall("GetWindow", "Ptr", firstChildHwnd, "UInt", 2, "Ptr") : 0
    toolbarHwnd := mainMenuHwnd ? DllCall("FindWindowEx", "Ptr", mainMenuHwnd, "Ptr", 0, "Str", "ToolbarWindow32", "Ptr", 0, "Ptr") : 0

    if (!mainMenuHwnd) {
        handles.ok := false
        handles.reason := "mdict-main-menu-not-found"
        handles.main := mainHwnd
        handles.inputParent := inputParentHwnd
        handles.input := inputHwnd
        handles.firstChild := firstChildHwnd
        handles.mainMenu := mainMenuHwnd
        handles.toolbar := toolbarHwnd
        return handles
    }

    handles.ok := true
    handles.reason := ""
    handles.main := mainHwnd
    handles.inputParent := inputParentHwnd
    handles.input := inputHwnd
    handles.firstChild := firstChildHwnd
    handles.mainMenu := mainMenuHwnd
    handles.toolbar := toolbarHwnd
    return handles
}

ReadMDictCycleIndex() {
    statePath := A_ScriptDir . "\mdict-cycle-state.txt"
    FileRead, value, %statePath%
    value := Trim(value)
    if value is integer
        return value
    return -1
}

WriteMDictCycleIndex(index) {
    statePath := A_ScriptDir . "\mdict-cycle-state.txt"
    FileDelete, %statePath%
    FileAppend, %index%, %statePath%, UTF-8
}

CycleMDictDictionary() {
    handles := InitMDictHandlesCopy()
    if (!handles.ok) {
        WriteMDictHandlesJson(false, handles.reason, handles, -1, 0)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 11
    }

    currentIndex := ReadMDictCycleIndex()
    nextIndex := currentIndex + 1
    if (nextIndex > 4 || nextIndex < 0) {
        nextIndex := 0
    }

    commandId := 0x7D0 + nextIndex
    WM_COMMAND := 0x0111
    DllCall("SendMessage", "Ptr", handles.mainMenu, "UInt", WM_COMMAND, "Ptr", commandId, "Ptr", 0, "Ptr")
    WriteMDictCycleIndex(nextIndex)
    WriteMDictHandlesJson(true, "", handles, nextIndex, commandId)

    if (!IsSilentCommand()) {
        MsgBox, 64, Dictionary Bridge - MDict, % "Dictionary index: " . nextIndex . "`nCommand: " . Format("0x{:X}", commandId)
    }
    return 0
}

CycleMDictDictionaryPost() {
    handles := InitMDictHandlesCopy()
    if (!handles.ok) {
        WriteMDictHandlesJson(false, handles.reason, handles, -1, 0)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 11
    }

    currentIndex := ReadMDictCycleIndex()
    nextIndex := currentIndex + 1
    if (nextIndex > 4 || nextIndex < 0) {
        nextIndex := 0
    }

    commandId := 0x7D0 + nextIndex
    WM_COMMAND := 0x0111
    DllCall("PostMessage", "Ptr", handles.mainMenu, "UInt", WM_COMMAND, "Ptr", commandId, "Ptr", 0, "Int")
    WriteMDictCycleIndex(nextIndex)
    WriteMDictHandlesJson(true, "", handles, nextIndex, commandId)

    if (!IsSilentCommand()) {
        MsgBox, 64, Dictionary Bridge - MDict, % "Dictionary index: " . nextIndex . "`nPost command: " . Format("0x{:X}", commandId)
    }
    return 0
}

GetMDictInputTextCommand() {
    handles := InitMDictHandlesCopy()
    if (!handles.ok) {
        WriteMDictTextJson(false, handles.reason, handles, "")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 11
    }
    if (!handles.input) {
        WriteMDictTextJson(false, "mdict-input-not-found", handles, "")
        return 12
    }

    WM_GETTEXTLENGTH := 0x000E
    WM_GETTEXT := 0x000D
    textLength := DllCall("SendMessage", "Ptr", handles.input, "UInt", WM_GETTEXTLENGTH, "Ptr", 0, "Ptr", 0, "Ptr")
    if (textLength <= 0) {
        WriteMDictTextJson(true, "", handles, "")
        return 0
    }
    if (textLength > 512) {
        WriteMDictTextJson(false, "mdict-input-too-long", handles, "")
        return 13
    }

    VarSetCapacity(textBuffer, (textLength + 1) * 2, 0)
    DllCall("SendMessage", "Ptr", handles.input, "UInt", WM_GETTEXT, "Ptr", textLength + 1, "Ptr", &textBuffer, "Ptr")
    text := StrGet(&textBuffer, "UTF-16")
    WriteMDictTextJson(true, "", handles, text)
    return 0
}

LookupWebsterAndRead(word) {
    lookupExitCode := LookupWebster(word, false)
    if (lookupExitCode != 0) {
        return lookupExitCode
    }

    return ReadWebsterOutputCopy()
}

LookupWebster(word, showSuccess := true) {
    word := Trim(word)
    if (word = "") {
        WriteJson(false, "empty-word")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, No word to lookup.
        }
        return 2
    }

    handles := InitWebsterHandlesCopy()
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 8
    }

    WM_SETTEXT := 0x000C
    BM_CLICK := 0x00F5
    DllCall("SendMessage", "Ptr", handles.editBox, "UInt", WM_SETTEXT, "Ptr", 0, "Str", word, "Ptr")
    Sleep, 50
    DllCall("SendMessage", "Ptr", handles.searchButton, "UInt", BM_CLICK, "Ptr", 0, "Ptr", 0, "Ptr")
    Sleep, 500

    if (showSuccess) {
        WriteWebsterHandlesJson(true, "", handles)
    }
    return 0
}

ReadWebsterOutputCopy() {
    handles := InitWebsterHandlesCopy()
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 8
    }

    WM_LBUTTONDBLCLK := 0x0203
    lParam := MakeLParam(165, 25)
    DllCall("SendMessage", "Ptr", handles.output, "UInt", WM_LBUTTONDBLCLK, "Ptr", 0, "Ptr", lParam, "Ptr")
    WriteWebsterHandlesJson(true, "", handles)
    return 0
}

FindWebsterBlueCommand(doubleClick, areaIndex := 1) {
    handles := InitWebsterHandlesCopy()
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        MsgBox, 48, Dictionary Bridge, % handles.reason
        return 8
    }

    blueAreas := FindBlueTextAreas(handles.output)
    if (blueAreas.Length() = 0) {
        emptyBlue := { ok: false, reason: "webster-blue-text-not-found" }
        WriteBlueTextJson(false, emptyBlue.reason, handles, emptyBlue, blueAreas)
        MsgBox, 48, Dictionary Bridge, % emptyBlue.reason
        return 9
    }

    areaIndex := Floor(areaIndex)
    if (areaIndex < 1 || areaIndex > blueAreas.Length()) {
        areaIndex := 1
    }
    blue := blueAreas[areaIndex]

    WriteBlueTextJson(true, "", handles, blue, blueAreas)
    if (doubleClick) {
        CoordMode, Mouse, Screen
        screenX := blue.screenX
        screenY := blue.screenY
        Click, %screenX%, %screenY%, 2
    } else {
        MsgBox, 64, Dictionary Bridge - blue text, % BuildBlueAreasMessage(blueAreas)
    }

    return 0
}

WriteWebsterBlueRowsCommand() {
    handles := InitWebsterHandlesCopy()
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        MsgBox, 48, Dictionary Bridge, % handles.reason
        return 8
    }

    rows := FindBlueRows(handles.output)
    WriteBlueRowsJson(handles, rows)
    MsgBox, 64, Dictionary Bridge - blue rows, % "blue rows: " . rows.Length()
    return 0
}

WriteWebsterOutputRectCommand() {
    handles := InitWebsterHandlesCopy(true)
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, % handles.reason
        }
        return 8
    }

    rect := GetOutputScreenRect(handles.output)
    if (!rect.ok) {
        WriteJson(false, "webster-output-screen-rect-failed")
        if (!IsSilentCommand()) {
            MsgBox, 48, Dictionary Bridge, Webster output rect failed.
        }
        return 11
    }

    WriteOutputRectJson(handles, rect)
    if (!IsSilentCommand()) {
        MsgBox, 64, Dictionary Bridge - output rect, % "screen: " . rect.screenX . "," . rect.screenY . "`nsize: " . rect.width . " x " . rect.height
    }
    return 0
}

IsSilentCommand() {
    return (A_Args.Length() >= 2 && A_Args[A_Args.Length()] = "silent")
}

WebsterClickCommand(x, y) {
    x := Trim(x)
    y := Trim(y)
    if (x = "" || y = "") {
        WriteJson(false, "invalid-click-position")
        MsgBox, 48, Dictionary Bridge, Invalid click position.
        return 12
    }

    CoordMode, Mouse, Screen
    Click, %x%, %y%, 2
    WriteClickJson(x, y)
    return 0
}

WebsterClientDoubleClickCommand(x, y) {
    x := Floor(Trim(x))
    y := Floor(Trim(y))
    if (x < 0 || y < 0) {
        WriteJson(false, "invalid-client-double-click-position")
        MsgBox, 48, Dictionary Bridge, Invalid client double click position.
        return 13
    }

    handles := InitWebsterHandlesCopy(true)
    if (!handles.ok) {
        WriteWebsterHandlesJson(false, handles.reason, handles)
        MsgBox, 48, Dictionary Bridge, % handles.reason
        return 8
    }

    WM_LBUTTONDBLCLK := 0x0203
    lParam := MakeLParam(x, y)
    DllCall("SendMessage", "Ptr", handles.output, "UInt", WM_LBUTTONDBLCLK, "Ptr", 0, "Ptr", lParam, "Ptr")
    WriteClientDoubleClickJson(handles, x, y)
    return 0
}

WriteClientDoubleClickJson(handles, x, y) {
    global resultPath
    main := handles.HasKey("main") ? handles.main : 0
    output := handles.HasKey("output") ? handles.output : 0
    json := "{""ok"":true"
        . "," . ResultMetaJson()
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""output"":""" . FormatHwnd(output) . """"
        . ",""clientX"":" . x
        . ",""clientY"":" . y . "}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

FindBlueTextAreas(outputHwnd) {
    rect := GetClientRectObj(outputHwnd)
    if (!rect.ok) {
        return []
    }

    hdc := DllCall("GetDC", "Ptr", outputHwnd, "Ptr")
    if (!hdc) {
        return []
    }

    marginLeft := 4
    marginTop := 4
    marginRight := 24
    marginBottom := 4
    minAreaWidth := 8
    maxAreaWidth := 120
    minAreaHeight := 6
    maxAreaHeight := 20
    minPixelCount := 12
    minRunWidth := 2
    areas := []

    contentBounds := FindContentBounds(outputHwnd, hdc, rect)
    if (!contentBounds.ok) {
        DllCall("ReleaseDC", "Ptr", outputHwnd, "Ptr", hdc)
        return []
    }

    padding := 8
    yStart := Max(marginTop, contentBounds.minY - padding)
    yEnd := Min(rect.height - marginBottom, contentBounds.maxY + padding)
    xStart := Max(marginLeft, contentBounds.minX - padding)
    xEnd := Min(rect.width - marginRight, contentBounds.maxX + padding)

    Loop, % yEnd - yStart {
        y := yStart + A_Index - 1
        runStart := -1
        runEnd := -1

        Loop, % xEnd - xStart {
            x := xStart + A_Index - 1
            color := DllCall("GetPixel", "Ptr", hdc, "Int", x, "Int", y, "UInt")
            if (IsBlueTextPixel(color)) {
                if (runStart < 0) {
                    runStart := x
                }
                runEnd := x
            } else if (runStart >= 0) {
                if ((runEnd - runStart + 1) >= minRunWidth) {
                    MergeBlueRunIntoAreas(areas, runStart, runEnd, y, runEnd - runStart + 1)
                }
                runStart := -1
                runEnd := -1
            }
        }

        if (runStart >= 0 && (runEnd - runStart + 1) >= minRunWidth) {
            MergeBlueRunIntoAreas(areas, runStart, runEnd, y, runEnd - runStart + 1)
        }
    }

    blueResults := []
    Loop, % areas.Length() {
        area := areas[A_Index]
        if (IsValidBlueArea(area, minAreaWidth, maxAreaWidth, minAreaHeight, maxAreaHeight, minPixelCount)) {
            blueResult := BuildBlueResult(outputHwnd, area)
            if (blueResult.ok) {
                AddContentBoundsToResult(blueResult, contentBounds)
                blueResults.Push(blueResult)
            }
        }
    }

    DllCall("ReleaseDC", "Ptr", outputHwnd, "Ptr", hdc)
    return blueResults
}

AddContentBoundsToResult(result, contentBounds) {
    result.contentMinX := contentBounds.minX
    result.contentMinY := contentBounds.minY
    result.contentMaxX := contentBounds.maxX
    result.contentMaxY := contentBounds.maxY
}

FindBlueRows(outputHwnd) {
    rect := GetClientRectObj(outputHwnd)
    if (!rect.ok) {
        return []
    }

    hdc := DllCall("GetDC", "Ptr", outputHwnd, "Ptr")
    if (!hdc) {
        return []
    }

    marginLeft := 4
    marginTop := 4
    marginRight := 24
    marginBottom := 4
    rows := []

    yStart := marginTop
    yEnd := rect.height - marginBottom
    xStart := marginLeft
    xEnd := rect.width - marginRight

    Loop, % yEnd - yStart {
        y := yStart + A_Index - 1
        rowMinX := -1
        rowMaxX := -1
        rowCount := 0

        Loop, % xEnd - xStart {
            x := xStart + A_Index - 1
            color := DllCall("GetPixel", "Ptr", hdc, "Int", x, "Int", y, "UInt")
            if (IsBlueTextPixel(color)) {
                if (rowMinX < 0 || x < rowMinX) {
                    rowMinX := x
                }
                if (x > rowMaxX) {
                    rowMaxX := x
                }
                rowCount += 1
            }
        }

        if (rowCount > 0) {
            rows.Push({ y: y, minX: rowMinX, maxX: rowMaxX, count: rowCount })
        }
    }

    DllCall("ReleaseDC", "Ptr", outputHwnd, "Ptr", hdc)
    return rows
}

MergeBlueRunIntoAreas(areas, x1, x2, y, count) {
    bestIndex := 0
    bestDistance := 999999

    Loop, % areas.Length() {
        area := areas[A_Index]
        yGap := y - area.maxY
        if (yGap < 0 || yGap > 2) {
            continue
        }

        if (x2 < area.minX - 6 || x1 > area.maxX + 6) {
            continue
        }

        distance := Abs(x1 - area.minX) + Abs(x2 - area.maxX) + yGap
        if (distance < bestDistance) {
            bestDistance := distance
            bestIndex := A_Index
        }
    }

    if (bestIndex > 0) {
        area := areas[bestIndex]
        area.minX := Min(area.minX, x1)
        area.maxX := Max(area.maxX, x2)
        area.minY := Min(area.minY, y)
        area.maxY := Max(area.maxY, y)
        area.pixelCount += count
        area.rowCounts[y] := area.rowCounts.HasKey(y) ? area.rowCounts[y] + count : count
        areas[bestIndex] := area
        return
    }

    rowCounts := {}
    rowCounts[y] := count
    areas.Push({ minX: x1, maxX: x2, minY: y, maxY: y, pixelCount: count, rowCounts: rowCounts })
}

IsValidBlueArea(area, minWidth, maxWidth, minHeight, maxHeight, minPixelCount) {
    if (!IsObject(area)) {
        return false
    }

    width := area.maxX - area.minX + 1
    height := area.maxY - area.minY + 1
    density := area.pixelCount / (width * height)

    return (width >= minWidth
        && width <= maxWidth
        && height >= minHeight
        && height <= maxHeight
        && area.pixelCount >= minPixelCount
        && density >= 0.08
        && HasUnderlineLikeRow(area))
}

HasUnderlineLikeRow(area) {
    if (!area.HasKey("rowCounts")) {
        return true
    }

    threshold := Max(5, Floor((area.maxX - area.minX + 1) * 0.3))
    for y, count in area.rowCounts {
        if (count >= threshold) {
            return true
        }
    }
    return false
}

BuildBlueResult(outputHwnd, area) {
    clientX := Floor((area.minX + area.maxX) / 2)
    clientY := Floor((area.minY + area.maxY) / 2)
    point := ClientToScreenObj(outputHwnd, clientX, clientY)
    if (!point.ok) {
        return { ok: false, reason: "webster-client-to-screen-failed" }
    }

    result := {}
    result.ok := true
    result.reason := ""
    result.minX := area.minX
    result.minY := area.minY
    result.maxX := area.maxX
    result.maxY := area.maxY
    result.pixelCount := area.pixelCount
    result.clientX := clientX
    result.clientY := clientY
    result.screenX := point.x
    result.screenY := point.y
    return result
}

FindContentBounds(outputHwnd, hdc, rect) {
    step := 4
    marginLeft := 4
    marginTop := 4
    marginRight := 24
    marginBottom := 4
    minX := rect.width
    minY := rect.height
    maxX := -1
    maxY := -1

    yStart := marginTop
    yEnd := rect.height - marginBottom
    xStart := marginLeft
    xEnd := rect.width - marginRight

    y := yStart
    while (y < yEnd) {
        x := xStart
        while (x < xEnd) {
            color := DllCall("GetPixel", "Ptr", hdc, "Int", x, "Int", y, "UInt")
            if (IsNonWhitePixel(color)) {
                minX := Min(minX, x)
                minY := Min(minY, y)
                maxX := Max(maxX, x)
                maxY := Max(maxY, y)
            }
            x += step
        }
        y += step
    }

    if (maxX < 0 || maxY < 0) {
        return { ok: false }
    }

    return { ok: true, minX: minX, minY: minY, maxX: maxX, maxY: maxY }
}

IsNonWhitePixel(color) {
    r := color & 0xff
    g := (color >> 8) & 0xff
    b := (color >> 16) & 0xff
    return (r < 245 || g < 245 || b < 245)
}

IsBlueTextPixel(color) {
    r := color & 0xff
    g := (color >> 8) & 0xff
    b := (color >> 16) & 0xff
    return (b >= 170 && r <= 70 && g <= 90 && b >= r + 120 && b >= g + 100)
}

GetClientRectObj(hwnd) {
    VarSetCapacity(rect, 16, 0)
    if (!DllCall("GetClientRect", "Ptr", hwnd, "Ptr", &rect)) {
        return { ok: false }
    }
    left := NumGet(rect, 0, "Int")
    top := NumGet(rect, 4, "Int")
    right := NumGet(rect, 8, "Int")
    bottom := NumGet(rect, 12, "Int")
    return { ok: true, width: right - left, height: bottom - top }
}

ClientToScreenObj(hwnd, x, y) {
    VarSetCapacity(point, 8, 0)
    NumPut(x, point, 0, "Int")
    NumPut(y, point, 4, "Int")
    if (!DllCall("ClientToScreen", "Ptr", hwnd, "Ptr", &point)) {
        return { ok: false }
    }
    return { ok: true, x: NumGet(point, 0, "Int"), y: NumGet(point, 4, "Int") }
}

GetOutputScreenRect(outputHwnd) {
    rect := GetClientRectObj(outputHwnd)
    if (!rect.ok) {
        return { ok: false }
    }

    topLeft := ClientToScreenObj(outputHwnd, 0, 0)
    if (!topLeft.ok) {
        return { ok: false }
    }

    result := {}
    result.ok := true
    result.screenX := topLeft.x
    result.screenY := topLeft.y
    result.width := rect.width
    result.height := rect.height
    result.screenRight := topLeft.x + rect.width
    result.screenBottom := topLeft.y + rect.height
    monitor := GetMonitorForPoint(result.screenX + Floor(result.width / 2), result.screenY + Floor(result.height / 2))
    result.monitorIndex := monitor.index
    result.monitorLeft := monitor.left
    result.monitorTop := monitor.top
    result.monitorRight := monitor.right
    result.monitorBottom := monitor.bottom
    result.monitorWidth := monitor.right - monitor.left
    result.monitorHeight := monitor.bottom - monitor.top
    return result
}

GetMonitorForPoint(x, y) {
    SysGet, monitorCount, MonitorCount
    Loop, %monitorCount% {
        SysGet, monitor, Monitor, %A_Index%
        if (x >= monitorLeft && x < monitorRight && y >= monitorTop && y < monitorBottom) {
            return { index: A_Index, left: monitorLeft, top: monitorTop, right: monitorRight, bottom: monitorBottom }
        }
    }

    SysGet, primary, MonitorPrimary
    SysGet, monitor, Monitor, %primary%
    return { index: primary, left: monitorLeft, top: monitorTop, right: monitorRight, bottom: monitorBottom }
}

InitWebsterHandlesCopy(focusDefinitionArea := false) {
    ; Exact order copied from the old Visual C++ project:
    ; hWnd = ::FindWindow("xMWebCD5100detdoc9012", NULL);
    mainHwnd := DllCall("FindWindow", "Str", "xMWebCD5100detdoc9012", "Ptr", 0, "Ptr")
    if (!mainHwnd) {
        return { ok: false, reason: "webster-not-found" }
    }

    if (focusDefinitionArea) {
        FocusWebsterDefinitionArea(mainHwnd)
    }

    ; hWnd = ::FindWindowEx(hWnd, NULL, NULL, NULL);
    ; hWnd = ::FindWindowEx(hWnd, NULL, NULL, NULL);
    ; hWnd = ::FindWindowEx(hWnd, NULL, NULL, NULL);
    hWnd := DllCall("FindWindowEx", "Ptr", mainHwnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr")
    hWnd := DllCall("FindWindowEx", "Ptr", hWnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr")
    hWnd := DllCall("FindWindowEx", "Ptr", hWnd, "Ptr", 0, "Ptr", 0, "Ptr", 0, "Ptr")
    outputHwnd := hWnd
    if (!outputHwnd) {
        return { ok: false, reason: "webster-output-not-found", main: mainHwnd }
    }

    GW_HWNDNEXT := 2
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 1
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 2
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 3
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 4
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 5
    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);  // 6
    Loop, 6 {
        hWnd := DllCall("GetWindow", "Ptr", hWnd, "UInt", GW_HWNDNEXT, "Ptr")
    }
    searchButtonHwnd := hWnd
    if (!searchButtonHwnd) {
        return { ok: false, reason: "webster-search-button-not-found", main: mainHwnd, output: outputHwnd }
    }

    ; hWnd = ::GetNextWindow(hWnd, GW_HWNDNEXT);
    editBoxHwnd := DllCall("GetWindow", "Ptr", hWnd, "UInt", GW_HWNDNEXT, "Ptr")
    if (!editBoxHwnd) {
        return { ok: false, reason: "webster-edit-box-not-found", main: mainHwnd, output: outputHwnd, searchButton: searchButtonHwnd }
    }

    return { ok: true, reason: "", main: mainHwnd, output: outputHwnd, searchButton: searchButtonHwnd, editBox: editBoxHwnd }
}

FocusWebsterDefinitionArea(mainHwnd) {
    WinActivate, ahk_id %mainHwnd%
    WinWaitActive, ahk_id %mainHwnd%,, 1

    VarSetCapacity(rect, 16, 0)
    if (!DllCall("GetWindowRect", "Ptr", mainHwnd, "Ptr", &rect)) {
        return false
    }

    left := NumGet(rect, 0, "Int")
    top := NumGet(rect, 4, "Int")
    right := NumGet(rect, 8, "Int")
    bottom := NumGet(rect, 12, "Int")
    width := right - left
    height := bottom - top

    if (width <= 0 || height <= 0) {
        return false
    }

    focusX := left + Floor(width * 0.72)
    focusY := top + Floor(height * 0.62)
    return FocusWindowAtScreenPoint(focusX, focusY)
}

FocusWindowAtScreenPoint(screenX, screenY) {
    pointValue := (screenY << 32) | (screenX & 0xffffffff)
    targetHwnd := DllCall("WindowFromPoint", "Int64", pointValue, "Ptr")
    if (!targetHwnd) {
        return false
    }

    VarSetCapacity(point, 8, 0)
    NumPut(screenX, point, 0, "Int")
    NumPut(screenY, point, 4, "Int")
    if (!DllCall("ScreenToClient", "Ptr", targetHwnd, "Ptr", &point)) {
        return false
    }

    clientX := NumGet(point, 0, "Int")
    clientY := NumGet(point, 4, "Int")
    lParam := MakeLParam(clientX, clientY)
    WM_LBUTTONDOWN := 0x0201
    WM_LBUTTONUP := 0x0202
    MK_LBUTTON := 0x0001

    DllCall("SetFocus", "Ptr", targetHwnd, "Ptr")
    DllCall("SendMessage", "Ptr", targetHwnd, "UInt", WM_LBUTTONDOWN, "Ptr", MK_LBUTTON, "Ptr", lParam, "Ptr")
    DllCall("SendMessage", "Ptr", targetHwnd, "UInt", WM_LBUTTONUP, "Ptr", 0, "Ptr", lParam, "Ptr")
    Sleep, 120
    return true
}

MakeLParam(x, y) {
    return (y << 16) | (x & 0xffff)
}

PasteWord(word) {
    oldClipboard := ClipboardAll
    Clipboard :=
    Clipboard := word
    ClipWait, 1
    Send, ^v
    Sleep, 80
    Clipboard := oldClipboard
}

ListDictionaryWindows() {
    global resultPath
    WinGet, ids, List
    result := ""
    message := ""
    Loop, %ids% {
        hwnd := ids%A_Index%
        WinGetTitle, title, ahk_id %hwnd%
        WinGetClass, className, ahk_id %hwnd%
        haystack := title . " " . className
        if (InStr(haystack, "MDict") || InStr(haystack, "Merriam") || InStr(haystack, "Webster") || InStr(haystack, "Dictionary") || InStr(haystack, "xMWeb")) {
            item := "{""title"":""" . JsonEscape(title) . """,""className"":""" . JsonEscape(className) . """,""handle"":""" . hwnd . """}"
            result .= (result = "" ? "" : ",") . item
            message .= (message = "" ? "" : "`n") . title . " [" . className . "]"
        }
    }
    json := "{""ok"":true," . ResultMetaJson() . ",""windows"":[" . result . "]}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
    if (message = "") {
        message := "No dictionary-like windows were found."
    }
    if (!IsSilentCommand()) {
        MsgBox, 64, Dictionary Bridge - list, %message%
    }
}

WriteJson(ok, reason) {
    global resultPath
    okText := ok ? "true" : "false"
    json := "{""ok"":" . okText . "," . ResultMetaJson() . ",""reason"":""" . JsonEscape(reason) . """}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteStatusJson(status) {
    global resultPath
    json := "{""ok"":false," . ResultMetaJson() . ",""status"":""" . JsonEscape(status) . """}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteMDictHandlesJson(ok, reason, handles, dictionaryIndex, commandId) {
    global resultPath
    okText := ok ? "true" : "false"
    main := handles.HasKey("main") ? handles.main : 0
    input := handles.HasKey("input") ? handles.input : 0
    firstChild := handles.HasKey("firstChild") ? handles.firstChild : 0
    mainMenu := handles.HasKey("mainMenu") ? handles.mainMenu : 0
    toolbar := handles.HasKey("toolbar") ? handles.toolbar : 0
    json := "{""ok"":" . okText
        . "," . ResultMetaJson()
        . ",""reason"":""" . JsonEscape(reason) . """"
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""input"":""" . FormatHwnd(input) . """"
        . ",""firstChild"":""" . FormatHwnd(firstChild) . """"
        . ",""mainMenu"":""" . FormatHwnd(mainMenu) . """"
        . ",""toolbar"":""" . FormatHwnd(toolbar) . """"
        . ",""dictionaryIndex"":" . dictionaryIndex
        . ",""commandId"":" . commandId
        . ",""commandIdHex"":""" . (commandId > 0 ? Format("0x{:X}", commandId) : "0x0") . """}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteMDictTextJson(ok, reason, handles, text) {
    global resultPath
    okText := ok ? "true" : "false"
    main := handles.HasKey("main") ? handles.main : 0
    input := handles.HasKey("input") ? handles.input : 0
    json := "{""ok"":" . okText
        . "," . ResultMetaJson()
        . ",""reason"":""" . JsonEscape(reason) . """"
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""input"":""" . FormatHwnd(input) . """"
        . ",""text"":""" . JsonEscape(text) . """}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

ResultMetaJson() {
    global commandName, startedAt, processId
    return """command"":""" . JsonEscape(commandName) . """"
        . ",""startedAt"":""" . FormatAhkTime(startedAt) . """"
        . ",""writtenAt"":""" . FormatAhkTime(A_Now) . """"
        . ",""pid"":" . processId
}

WriteWebsterHandlesJson(ok, reason, handles) {
    global resultPath
    okText := ok ? "true" : "false"
    main := handles.HasKey("main") ? handles.main : 0
    output := handles.HasKey("output") ? handles.output : 0
    searchButton := handles.HasKey("searchButton") ? handles.searchButton : 0
    editBox := handles.HasKey("editBox") ? handles.editBox : 0
    json := "{""ok"":" . okText
        . "," . ResultMetaJson()
        . ",""reason"":""" . JsonEscape(reason) . """"
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""output"":""" . FormatHwnd(output) . """"
        . ",""searchButton"":""" . FormatHwnd(searchButton) . """"
        . ",""editBox"":""" . FormatHwnd(editBox) . """}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteBlueTextJson(ok, reason, handles, blue, areas := "") {
    global resultPath
    okText := ok ? "true" : "false"
    main := handles.HasKey("main") ? handles.main : 0
    output := handles.HasKey("output") ? handles.output : 0
    clientX := blue.HasKey("clientX") ? blue.clientX : -1
    clientY := blue.HasKey("clientY") ? blue.clientY : -1
    screenX := blue.HasKey("screenX") ? blue.screenX : -1
    screenY := blue.HasKey("screenY") ? blue.screenY : -1
    minX := blue.HasKey("minX") ? blue.minX : -1
    minY := blue.HasKey("minY") ? blue.minY : -1
    maxX := blue.HasKey("maxX") ? blue.maxX : -1
    maxY := blue.HasKey("maxY") ? blue.maxY : -1
    pixelCount := blue.HasKey("pixelCount") ? blue.pixelCount : 0
    contentMinX := blue.HasKey("contentMinX") ? blue.contentMinX : -1
    contentMinY := blue.HasKey("contentMinY") ? blue.contentMinY : -1
    contentMaxX := blue.HasKey("contentMaxX") ? blue.contentMaxX : -1
    contentMaxY := blue.HasKey("contentMaxY") ? blue.contentMaxY : -1
    json := "{""ok"":" . okText
        . "," . ResultMetaJson()
        . ",""reason"":""" . JsonEscape(reason) . """"
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""output"":""" . FormatHwnd(output) . """"
        . ",""clientX"":" . clientX
        . ",""clientY"":" . clientY
        . ",""screenX"":" . screenX
        . ",""screenY"":" . screenY
        . ",""minX"":" . minX
        . ",""minY"":" . minY
        . ",""maxX"":" . maxX
        . ",""maxY"":" . maxY
        . ",""pixelCount"":" . pixelCount
        . ",""contentMinX"":" . contentMinX
        . ",""contentMinY"":" . contentMinY
        . ",""contentMaxX"":" . contentMaxX
        . ",""contentMaxY"":" . contentMaxY
        . ",""areas"":" . BlueAreasToJson(areas) . "}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

BlueAreasToJson(areas) {
    if (!IsObject(areas)) {
        return "[]"
    }

    result := ""
    Loop, % areas.Length() {
        item := areas[A_Index]
        itemJson := "{""index"":" . A_Index
            . ",""clientX"":" . item.clientX
            . ",""clientY"":" . item.clientY
            . ",""screenX"":" . item.screenX
            . ",""screenY"":" . item.screenY
            . ",""minX"":" . item.minX
            . ",""minY"":" . item.minY
            . ",""maxX"":" . item.maxX
            . ",""maxY"":" . item.maxY
            . ",""pixelCount"":" . item.pixelCount
            . ",""contentMinX"":" . item.contentMinX
            . ",""contentMinY"":" . item.contentMinY
            . ",""contentMaxX"":" . item.contentMaxX
            . ",""contentMaxY"":" . item.contentMaxY . "}"
        result .= (result = "" ? "" : ",") . itemJson
    }
    return "[" . result . "]"
}

BuildBlueAreasMessage(areas) {
    if (!IsObject(areas) || areas.Length() = 0) {
        return "No blue text areas were found."
    }

    message := "Found " . areas.Length() . " blue text areas."
    Loop, % areas.Length() {
        item := areas[A_Index]
        message .= "`n`n" . A_Index . ". client: " . item.clientX . "," . item.clientY
            . "  screen: " . item.screenX . "," . item.screenY
            . "`n   rect: " . item.minX . "," . item.minY . " - " . item.maxX . "," . item.maxY
            . "  pixels: " . item.pixelCount
    }
    return message
}

WriteBlueRowsJson(handles, rows) {
    global resultPath
    main := handles.HasKey("main") ? handles.main : 0
    output := handles.HasKey("output") ? handles.output : 0
    json := "{""ok"":true"
        . "," . ResultMetaJson()
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""output"":""" . FormatHwnd(output) . """"
        . ",""rowCount"":" . rows.Length()
        . ",""rows"":" . BlueRowsToJson(rows) . "}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteOutputRectJson(handles, rect) {
    global resultPath
    main := handles.HasKey("main") ? handles.main : 0
    output := handles.HasKey("output") ? handles.output : 0
    json := "{""ok"":true"
        . "," . ResultMetaJson()
        . ",""main"":""" . FormatHwnd(main) . """"
        . ",""output"":""" . FormatHwnd(output) . """"
        . ",""screenX"":" . rect.screenX
        . ",""screenY"":" . rect.screenY
        . ",""width"":" . rect.width
        . ",""height"":" . rect.height
        . ",""screenRight"":" . rect.screenRight
        . ",""screenBottom"":" . rect.screenBottom
        . ",""monitorIndex"":" . rect.monitorIndex
        . ",""monitorLeft"":" . rect.monitorLeft
        . ",""monitorTop"":" . rect.monitorTop
        . ",""monitorRight"":" . rect.monitorRight
        . ",""monitorBottom"":" . rect.monitorBottom
        . ",""monitorWidth"":" . rect.monitorWidth
        . ",""monitorHeight"":" . rect.monitorHeight . "}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

WriteClickJson(x, y) {
    global resultPath
    json := "{""ok"":true"
        . "," . ResultMetaJson()
        . ",""screenX"":" . x
        . ",""screenY"":" . y . "}"
    FileDelete, %resultPath%
    FileAppend, %json%, %resultPath%, UTF-8
}

BlueRowsToJson(rows) {
    if (!IsObject(rows)) {
        return "[]"
    }

    result := ""
    Loop, % rows.Length() {
        item := rows[A_Index]
        itemJson := "{""y"":" . item.y
            . ",""minX"":" . item.minX
            . ",""maxX"":" . item.maxX
            . ",""count"":" . item.count . "}"
        result .= (result = "" ? "" : ",") . itemJson
    }
    return "[" . result . "]"
}

FormatHwnd(hwnd) {
    if (!hwnd) {
        return "0x0"
    }
    return Format("0x{:X}", hwnd)
}

FormatAhkTime(value) {
    if (StrLen(value) < 14) {
        return value
    }
    return SubStr(value, 1, 4) . "-" . SubStr(value, 5, 2) . "-" . SubStr(value, 7, 2)
        . " " . SubStr(value, 9, 2) . ":" . SubStr(value, 11, 2) . ":" . SubStr(value, 13, 2)
}

JsonEscape(text) {
    text := StrReplace(text, "\", "\\")
    text := StrReplace(text, """", "\""")
    text := StrReplace(text, "`r", "\r")
    text := StrReplace(text, "`n", "\n")
    text := StrReplace(text, "`t", "\t")
    return text
}
