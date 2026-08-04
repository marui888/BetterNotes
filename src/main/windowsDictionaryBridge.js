import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const POWERSHELL_TIMEOUT_MS = 5000

const WIN32_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeMethods {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

$WM_SETTEXT = 0x000C
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$WM_LBUTTONDBLCLK = 0x0203
$BM_CLICK = 0x00F5
$VK_RETURN = 0x0D
$GW_HWNDNEXT = 2
$SW_NORMAL = 1

function Make-LParam([int]$x, [int]$y) {
  return [IntPtr](($y -shl 16) -bor ($x -band 0xffff))
}

function Next-Window([IntPtr]$handle, [int]$count) {
  $current = $handle
  for ($i = 0; $i -lt $count; $i++) {
    if ($current -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    $current = [NativeMethods]::GetWindow($current, $GW_HWNDNEXT)
  }
  return $current
}

function Write-Result([bool]$ok, [string]$reason) {
  [PSCustomObject]@{ ok = $ok; reason = $reason } | ConvertTo-Json -Compress
}

function Find-VisibleWindow([string]$className, [string]$titleContains) {
  $matched = [IntPtr]::Zero
  $callback = [NativeMethods+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [NativeMethods]::IsWindowVisible($hWnd)) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder 512
    $classBuilder = New-Object System.Text.StringBuilder 256
    [NativeMethods]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
    [NativeMethods]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity) | Out-Null

    $title = $titleBuilder.ToString()
    $currentClassName = $classBuilder.ToString()
    $classMatched = $className -and ($currentClassName -eq $className)
    $titleMatched = $titleContains -and ($title.IndexOf($titleContains, [StringComparison]::OrdinalIgnoreCase) -ge 0)

    if ($classMatched -or $titleMatched) {
      $script:matched = $hWnd
      return $false
    }

    return $true
  }

  [NativeMethods]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $script:matched
}
`

function normalizeWord(word) {
  return typeof word === 'string' ? word.trim() : ''
}

async function runDictionaryScript(script, word) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'windows-only' }
  }

  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, searchWord],
      {
        timeout: POWERSHELL_TIMEOUT_MS,
        windowsHide: true,
      }
    )
    const output = stdout.trim()
    return output ? JSON.parse(output) : { ok: false, reason: 'empty-result' }
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || 'dictionary-command-failed',
    }
  }
}

export async function lookupMDict(word) {
  const script = `${WIN32_SCRIPT}
$word = $args[0]
$mainWindow = Find-VisibleWindow "MDictMainWnd" "MDict"
if ($mainWindow -eq [IntPtr]::Zero) {
  Write-Result $false "mdict-not-found"
  exit
}

[NativeMethods]::ShowWindow($mainWindow, $SW_NORMAL) | Out-Null
[NativeMethods]::SetForegroundWindow($mainWindow) | Out-Null

$inputWindow = [NativeMethods]::FindWindowEx($mainWindow, [IntPtr]::Zero, $null, $null)
$inputWindow = [NativeMethods]::FindWindowEx($inputWindow, [IntPtr]::Zero, $null, $null)
if ($inputWindow -eq [IntPtr]::Zero) {
  Write-Result $false "mdict-input-not-found"
  exit
}

[NativeMethods]::SendMessage($inputWindow, $WM_SETTEXT, [IntPtr]::Zero, $word) | Out-Null
1..2 | ForEach-Object {
  [NativeMethods]::PostMessage($inputWindow, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero) | Out-Null
  [NativeMethods]::PostMessage($inputWindow, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero) | Out-Null
}

Write-Result $true ""
`

  return runDictionaryScript(script, word)
}

export async function lookupWebsterAndRead(word) {
  const script = `${WIN32_SCRIPT}
$word = $args[0]
$mainWindow = Find-VisibleWindow "xMWebCD5100detdoc9012" "Merriam-Webster"
if ($mainWindow -eq [IntPtr]::Zero) {
  Write-Result $false "webster-not-found"
  exit
}

[NativeMethods]::ShowWindow($mainWindow, $SW_NORMAL) | Out-Null
[NativeMethods]::SetForegroundWindow($mainWindow) | Out-Null

$outputWindow = [NativeMethods]::FindWindowEx($mainWindow, [IntPtr]::Zero, $null, $null)
$outputWindow = [NativeMethods]::FindWindowEx($outputWindow, [IntPtr]::Zero, $null, $null)
$outputWindow = [NativeMethods]::FindWindowEx($outputWindow, [IntPtr]::Zero, $null, $null)
if ($outputWindow -eq [IntPtr]::Zero) {
  Write-Result $false "webster-output-not-found"
  exit
}

$searchButton = Next-Window $outputWindow 6
$editBox = Next-Window $searchButton 1
if ($searchButton -eq [IntPtr]::Zero -or $editBox -eq [IntPtr]::Zero) {
  Write-Result $false "webster-search-controls-not-found"
  exit
}

[NativeMethods]::SendMessage($editBox, $WM_SETTEXT, [IntPtr]::Zero, $word) | Out-Null
[NativeMethods]::SendMessage($searchButton, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 650
[NativeMethods]::PostMessage($outputWindow, $WM_LBUTTONDBLCLK, [IntPtr]::Zero, (Make-LParam 165 25)) | Out-Null

Write-Result $true ""
`

  return runDictionaryScript(script, word)
}

export async function findDictionaryWindows() {
  const script = `${WIN32_SCRIPT}
$keywords = @("MDict", "Merriam", "Webster", "Dictionary", "MW", "xMWeb", "Collins", "Longman")
$windows = New-Object System.Collections.Generic.List[object]
$callback = [NativeMethods+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)

  if (-not [NativeMethods]::IsWindowVisible($hWnd)) {
    return $true
  }

  $titleBuilder = New-Object System.Text.StringBuilder 512
  $classBuilder = New-Object System.Text.StringBuilder 256
  [NativeMethods]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
  [NativeMethods]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity) | Out-Null

  $title = $titleBuilder.ToString()
  $className = $classBuilder.ToString()
  $haystack = "$title $className"

  foreach ($keyword in $keywords) {
    if ($haystack.IndexOf($keyword, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $windows.Add([PSCustomObject]@{
        title = $title
        className = $className
        handle = $hWnd.ToInt64()
      }) | Out-Null
      break
    }
  }

  return $true
}

[NativeMethods]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
[PSCustomObject]@{ ok = $true; windows = $windows } | ConvertTo-Json -Compress -Depth 4
`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout: POWERSHELL_TIMEOUT_MS,
        windowsHide: true,
      }
    )
    const output = stdout.trim()
    return output ? JSON.parse(output) : { ok: false, reason: 'empty-result', windows: [] }
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || 'window-enumeration-failed',
      windows: [],
    }
  }
}
