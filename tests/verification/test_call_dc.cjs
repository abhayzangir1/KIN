const { DesktopController } = require('./core/dist/computer/desktop_controller.js');
async function test() {
  const dc = new DesktopController();
  // We can inspect what dc.runPowerShell produces on the script:
  const psScript = `
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
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
            Write-Output ("META_INTERACTIVE:" + $bounds.Width + "x" + $bounds.Height + "|" + $sessionId + "|")
            Write-Output $b64
            exit 0
          } catch {
            # GDI CopyFromScreen failed in non-desktop context; fall through to headless virtual canvas
          }
        }

        # Headless / Virtual Display Fallback Canvas
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
        Write-Output ("META_HEADLESS:" + $w + "x" + $h + "|" + $sessionId + "|")
        Write-Output $b64
  `;

  console.log('Executing dc.runPowerShell...');
  const res = await dc.runPowerShell(psScript);
  console.log('exitCode:', res.exitCode);
  console.log('stdout length:', res.stdout.length);
  console.log('stdout preview:', res.stdout.slice(0, 100));
  console.log('stderr length:', res.stderr.length);
  console.log('stderr preview:', res.stderr.slice(0, 200));
}
test().catch(console.error);
