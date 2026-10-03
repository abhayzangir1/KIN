const cp = require('child_process');

function runPowerShell(script) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    cp.exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`,
      {
        timeout: 20000,
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || (error ? error.message : ''),
          exitCode: error ? (error.code ?? 1) : 0,
        });
      }
    );
  });
}

async function main() {
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $sessionId = (Get-Process -Id $PID).SessionId
    $isInteractive = [System.Environment]::UserInteractive
    $primaryScreen = [System.Windows.Forms.Screen]::PrimaryScreen

    $canGdiCapture = $isInteractive -and ($primaryScreen -ne $null) -and ($primaryScreen.Bounds.Width -gt 0)

    if ($canGdiCapture) {
      try {
        $bounds = $primaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $ms = New-Object System.IO.MemoryStream
        $fmt = [System.Drawing.Imaging.ImageFormat]::Png
        $bmp.Save($ms, $fmt)
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $bmp.Dispose()
        $g.Dispose()
        $ms.Dispose()
        [Console]::Out.WriteLine("META_INTERACTIVE:" + $bounds.Width + "x" + $bounds.Height + "|" + $sessionId + "|")
        [Console]::Out.WriteLine($b64)
        return
      } catch {
        [Console]::Error.WriteLine("GDI_ERROR:" + $_.Exception.Message)
      }
    }

    $w = 1920
    $h = 1080
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(11, 16, 30))
    $g.FillRectangle($brushBg, 0, 0, $w, $h)

    $penGrid = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(25, 35, 60)), 1
    for ($x = 0; $x -lt $w; $x += 80) { $g.DrawLine($penGrid, $x, 0, $x, $h) }
    for ($y = 0; $y -lt $h; $y += 80) { $g.DrawLine($penGrid, 0, $y, $w, $y) }

    $fontTitle = New-Object System.Drawing.Font ("Consolas", 22, [System.Drawing.FontStyle]::Bold)
    $fontSub = New-Object System.Drawing.Font ("Consolas", 13, [System.Drawing.FontStyle]::Regular)
    $brushText = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(147, 197, 253))
    $brushSub = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(148, 163, 184))

    $timeStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss UTC")
    $g.DrawString("KIN OS - HEADLESS VIRTUAL DISPLAY SESSION", $fontTitle, $brushText, 80, 80)
    $g.DrawString("Session ID: $sessionId | Interactive: $isInteractive | Virtual Resolution: 1920x1080", $fontSub, $brushSub, 80, 130)
    $g.DrawString("Timestamp: $timeStr", $fontSub, $brushSub, 80, 160)
    $g.DrawString("Physical Display: Unattached / Background Session (GDI+ Direct Surface Unavailable)", $fontSub, $brushSub, 80, 190)

    $ms = New-Object System.IO.MemoryStream
    $fmt = [System.Drawing.Imaging.ImageFormat]::Png
    $bmp.Save($ms, $fmt)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $bmp.Dispose()
    $g.Dispose()
    $ms.Dispose()
    [Console]::Out.WriteLine("META_HEADLESS:" + $w + "x" + $h + "|" + $sessionId + "|")
    [Console]::Out.WriteLine($b64)
  `;

  const res = await runPowerShell(psScript);
  console.log('ExitCode:', res.exitCode);
  console.log('Stdout length:', res.stdout.length);
  console.log('Stdout prefix:', res.stdout.slice(0, 100));
  if (res.stderr) console.log('Stderr prefix:', res.stderr.slice(0, 200));
}

main();
