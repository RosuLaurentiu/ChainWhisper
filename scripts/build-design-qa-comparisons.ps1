Add-Type -AssemblyName System.Drawing

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$captureRoot = Join-Path $projectRoot 'design-audit\qa-captures'
$outputRoot = Join-Path $projectRoot 'design-audit\qa-comparisons'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$comparisonSets = @(
  @{ Name = 'dex-swap'; Source = 'design-audit\dex-swap-review-v4-price-protection.png'; Capture = 'dex-swap-desktop.png'; Height = 700 },
  @{ Name = 'dex-pool-full'; Source = 'design-audit\dex-strategies-pool-full-range-review-v5.png'; Capture = 'dex-pool-full-desktop.png'; Height = 700 },
  @{ Name = 'dex-pool-preset'; Source = 'design-audit\dex-strategies-pool-preset-range-review-v5.png'; Capture = 'dex-pool-preset-desktop.png'; Height = 700 },
  @{ Name = 'dex-pool-custom'; Source = 'design-audit\dex-strategies-pool-custom-range-review-v5.png'; Capture = 'dex-pool-custom-desktop.png'; Height = 700 },
  @{ Name = 'dex-limit'; Source = 'design-audit\dex-strategies-limit-review-v1.png'; Capture = 'dex-limit-desktop.png'; Height = 700 },
  @{ Name = 'p2p-offers-mobile'; Source = 'design-audit\approved-p2p-mobile-offers-baseline.png'; Capture = 'p2p-offers-mobile.png'; Height = 820 }
)

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } |
  Select-Object -First 1
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]82
)

foreach ($comparison in $comparisonSets) {
  $sourcePath = Join-Path $projectRoot $comparison.Source
  $capturePath = Join-Path $captureRoot $comparison.Capture
  $source = [System.Drawing.Image]::FromFile($sourcePath)
  $capture = [System.Drawing.Image]::FromFile($capturePath)

  try {
    $height = [int]$comparison.Height
    $width = [int][Math]::Round($source.Width * $height / $source.Height)
    $canvas = New-Object System.Drawing.Bitmap -ArgumentList ([int]($width * 2)), $height
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.Clear([System.Drawing.Color]::Black)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($source, 0, 0, $width, $height)
      $graphics.DrawImage($capture, $width, 0, $width, $height)
      $outputPath = Join-Path $outputRoot ($comparison.Name + '-reference-left-implementation-right.jpg')
      $canvas.Save($outputPath, $jpegCodec, $encoderParameters)
      Write-Output $outputPath
    } finally {
      $graphics.Dispose()
      $canvas.Dispose()
    }
  } finally {
    $source.Dispose()
    $capture.Dispose()
  }
}

$executionStateCaptures = @(
  @{ Label = 'Wallet confirmation'; File = 'p2p-trade-action-wallet-desktop.png' },
  @{ Label = 'On-chain pending'; File = 'p2p-trade-action-pending-desktop.png' },
  @{ Label = 'Confirmed'; File = 'p2p-trade-action-success-desktop.png' },
  @{ Label = 'Failed before submission'; File = 'p2p-trade-action-error-desktop.png' },
  @{ Label = 'Submitted, confirmation uncertain'; File = 'p2p-trade-action-uncertain-desktop.png' },
  @{ Label = 'Uncertain recovery on mobile'; File = 'p2p-trade-action-uncertain-mobile.png' }
)

function Write-ContactSheet {
  param(
    [Parameter(Mandatory = $true)] [array]$Items,
    [Parameter(Mandatory = $true)] [int]$Columns,
    [Parameter(Mandatory = $true)] [int]$CellWidth,
    [Parameter(Mandatory = $true)] [int]$CellHeight,
    [Parameter(Mandatory = $true)] [string]$OutputName
  )

  $contactLabelHeight = 34
  $rows = [int][Math]::Ceiling($Items.Count / $Columns)
  $contactSheet = New-Object System.Drawing.Bitmap -ArgumentList ([int]($CellWidth * $Columns)), ([int]($CellHeight * $rows))
  $contactGraphics = [System.Drawing.Graphics]::FromImage($contactSheet)
  $contactFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $contactBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 232, 248))
  try {
    $contactGraphics.Clear([System.Drawing.Color]::FromArgb(7, 9, 16))
    $contactGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    for ($itemIndex = 0; $itemIndex -lt $Items.Count; $itemIndex++) {
      $item = $Items[$itemIndex]
      $itemImage = [System.Drawing.Image]::FromFile((Join-Path $captureRoot $item.File))
      try {
        $itemColumn = $itemIndex % $Columns
        $itemRow = [Math]::Floor($itemIndex / $Columns)
        $itemX = [int]($itemColumn * $CellWidth)
        $itemY = [int]($itemRow * $CellHeight)
        $contactGraphics.DrawString($item.Label, $contactFont, $contactBrush, $itemX + 12, $itemY + 6)
        $contactAvailableHeight = $CellHeight - $contactLabelHeight
        $itemScale = [Math]::Min($CellWidth / $itemImage.Width, $contactAvailableHeight / $itemImage.Height)
        $itemWidth = [int][Math]::Round($itemImage.Width * $itemScale)
        $itemHeight = [int][Math]::Round($itemImage.Height * $itemScale)
        $imageX = $itemX + [int][Math]::Floor(($CellWidth - $itemWidth) / 2)
        $imageY = $itemY + $contactLabelHeight
        $contactGraphics.DrawImage($itemImage, $imageX, $imageY, $itemWidth, $itemHeight)
      } finally {
        $itemImage.Dispose()
      }
    }
    $contactOutputRoot = Join-Path $projectRoot 'design-audit\completion-audit'
    New-Item -ItemType Directory -Force -Path $contactOutputRoot | Out-Null
    $contactOutput = Join-Path $contactOutputRoot $OutputName
    $contactSheet.Save($contactOutput, $jpegCodec, $encoderParameters)
    Write-Output $contactOutput
  } finally {
    $contactBrush.Dispose()
    $contactFont.Dispose()
    $contactGraphics.Dispose()
    $contactSheet.Dispose()
  }
}

$finalDesktopCaptures = @(
  @{ Label = 'DEX Swap'; File = 'dex-swap-desktop.png' },
  @{ Label = 'DEX Pool'; File = 'dex-pool-custom-desktop.png' },
  @{ Label = 'DEX Limit'; File = 'dex-limit-desktop.png' },
  @{ Label = 'DEX Recurring'; File = 'dex-recurring-desktop.png' },
  @{ Label = 'DEX Positions'; File = 'dex-positions-desktop.png' },
  @{ Label = 'P2P Offers'; File = 'p2p-offers-desktop.png' },
  @{ Label = 'P2P Trade review'; File = 'p2p-trade-review-desktop.png' },
  @{ Label = 'P2P Create'; File = 'p2p-create-desktop.png' },
  @{ Label = 'P2P My trades'; File = 'p2p-my-trades-populated-desktop.png' }
)

$finalMobileCaptures = @(
  @{ Label = 'DEX Swap'; File = 'dex-swap-mobile.png' },
  @{ Label = 'DEX Pool'; File = 'dex-pool-mobile.png' },
  @{ Label = 'DEX Limit'; File = 'dex-limit-mobile.png' },
  @{ Label = 'DEX Recurring'; File = 'dex-recurring-mobile.png' },
  @{ Label = 'DEX Positions'; File = 'dex-positions-mobile.png' },
  @{ Label = 'P2P Offers'; File = 'p2p-offers-mobile.png' },
  @{ Label = 'P2P Trade review'; File = 'p2p-trade-review-mobile.png' },
  @{ Label = 'P2P Create'; File = 'p2p-create-mobile.png' },
  @{ Label = 'P2P My trades'; File = 'p2p-my-trades-populated-mobile.png' }
)

Write-ContactSheet -Items $finalDesktopCaptures -Columns 3 -CellWidth 560 -CellHeight 430 -OutputName '54-trading-final-desktop-current.jpg'
Write-ContactSheet -Items $finalMobileCaptures -Columns 3 -CellWidth 300 -CellHeight 660 -OutputName '55-trading-final-mobile-current.jpg'

$managementDesktopCaptures = @(
  @{ Label = '1. Active and actionable'; File = 'p2p-my-trades-populated-desktop.png' },
  @{ Label = '2. Attached overview'; File = 'p2p-my-trades-terminal-desktop.png' },
  @{ Label = '3. Attached activity'; File = 'p2p-my-trades-activity-desktop.png' },
  @{ Label = '4. Completed history'; File = 'p2p-my-trades-history-desktop.png' }
)
$managementMobileCaptures = @(
  @{ Label = '1. Active list'; File = 'p2p-my-trades-populated-mobile.png' },
  @{ Label = '2. Focused terminal'; File = 'p2p-my-trades-terminal-mobile.png' },
  @{ Label = '3. History after return'; File = 'p2p-my-trades-history-mobile.png' }
)

Write-ContactSheet -Items $managementDesktopCaptures -Columns 2 -CellWidth 720 -CellHeight 540 -OutputName '57-p2p-my-trades-populated-desktop-flow.jpg'
Write-ContactSheet -Items $managementMobileCaptures -Columns 3 -CellWidth 300 -CellHeight 660 -OutputName '58-p2p-my-trades-populated-mobile-flow.jpg'

$p2pCreateCaptures = @(
  @{ Label = 'Desktop - Public'; File = 'p2p-create-public-desktop.png' },
  @{ Label = 'Desktop - Private link'; File = 'p2p-create-private-link-desktop.png' },
  @{ Label = 'Desktop - Direct proposal'; File = 'p2p-create-direct-desktop.png' },
  @{ Label = 'Desktop - Recurring'; File = 'p2p-create-recurring-desktop.png' },
  @{ Label = 'Mobile - Public'; File = 'p2p-create-mobile.png' },
  @{ Label = 'Mobile - Private link'; File = 'p2p-create-private-link-mobile.png' },
  @{ Label = 'Mobile - Direct proposal'; File = 'p2p-create-direct-mobile.png' },
  @{ Label = 'Mobile - Recurring'; File = 'p2p-create-recurring-mobile.png' }
)

Write-ContactSheet -Items $p2pCreateCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '59-p2p-create-desktop-mobile-flow.jpg'

$positionsDetailCaptures = @(
  @{ Label = 'Desktop - Overview'; File = 'dex-positions-desktop.png' },
  @{ Label = 'Desktop - Activity'; File = 'dex-positions-activity-desktop.png' },
  @{ Label = 'Desktop - Transfer review entry'; File = 'dex-positions-transfer-desktop.png' },
  @{ Label = 'Mobile - Position list'; File = 'dex-positions-mobile.png' },
  @{ Label = 'Mobile - Attached overview'; File = 'dex-positions-terminal-mobile.png' },
  @{ Label = 'Mobile - Attached activity'; File = 'dex-positions-activity-mobile.png' }
)

Write-ContactSheet -Items $positionsDetailCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '76-dex-positions-detail-refinement-states.jpg'

$offersDetailCaptures = @(
  @{ Label = 'Desktop - Market-centered ladder'; File = 'p2p-offers-desktop.png' },
  @{ Label = 'Desktop - Chart and offer line'; File = 'p2p-offers-chart-desktop.png' },
  @{ Label = 'Mobile - Approved ladder hierarchy'; File = 'p2p-offers-mobile.png' },
  @{ Label = 'Mobile - Expanded chart in viewport'; File = 'p2p-offers-chart-mobile.png' },
  @{ Label = 'Desktop - Recoverable load error'; File = 'p2p-offers-error-desktop.png' },
  @{ Label = 'Mobile - Stale link recovery'; File = 'p2p-offers-stale-mobile.png' }
)

Write-ContactSheet -Items $offersDetailCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '77-p2p-offers-detail-refinement-states.jpg'

$productOwnerDesktopCaptures = @(
  @{ Label = '1. DEX Limit'; File = 'dex-limit-desktop.png' },
  @{ Label = '2. DEX Recurring'; File = 'dex-recurring-desktop.png' },
  @{ Label = '3. DEX Positions'; File = 'dex-positions-desktop.png' },
  @{ Label = '4. P2P Create'; File = 'p2p-create-filled-desktop.png' },
  @{ Label = '5. P2P Trade review'; File = 'p2p-trade-review-desktop.png' },
  @{ Label = '6. P2P My trades'; File = 'p2p-my-trades-populated-desktop.png' }
)

$productOwnerMobileCaptures = @(
  @{ Label = '1. DEX Limit'; File = 'dex-limit-mobile.png' },
  @{ Label = '2. DEX Recurring'; File = 'dex-recurring-mobile.png' },
  @{ Label = '3. DEX Positions'; File = 'dex-positions-mobile.png' },
  @{ Label = '4. P2P Create'; File = 'p2p-create-mobile.png' },
  @{ Label = '5. P2P Trade review'; File = 'p2p-trade-review-mobile.png' },
  @{ Label = '6. P2P My trades'; File = 'p2p-my-trades-populated-mobile.png' }
)

Write-ContactSheet -Items $productOwnerDesktopCaptures -Columns 3 -CellWidth 560 -CellHeight 460 -OutputName '78-product-owner-candidates-current-desktop.jpg'
Write-ContactSheet -Items $productOwnerMobileCaptures -Columns 3 -CellWidth 320 -CellHeight 680 -OutputName '79-product-owner-candidates-current-mobile.jpg'

$p2pCreateBlockedActionCaptures = @(
  @{ Label = 'Desktop - blocked creation hierarchy'; File = 'p2p-create-blocked-action-desktop.png' },
  @{ Label = 'Mobile - one readiness owner'; File = 'p2p-create-blocked-action-mobile.png' }
)

Write-ContactSheet -Items $p2pCreateBlockedActionCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '80-p2p-create-blocked-action-honesty.jpg'

$myTradesFilterHierarchyCaptures = @(
  @{ Label = 'Desktop - filters inside My trades'; File = 'p2p-my-trades-populated-desktop.png' },
  @{ Label = 'Mobile - compact disclosure'; File = 'p2p-my-trades-populated-mobile.png' },
  @{ Label = 'Mobile - expanded search and filters'; File = 'p2p-my-trades-filters-open-mobile.png' }
)

Write-ContactSheet -Items $myTradesFilterHierarchyCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '81-p2p-my-trades-filter-hierarchy.jpg'

$tradeTerminalDetailCaptures = @(
  @{ Label = 'Desktop - concise review fields'; File = 'p2p-trade-review-desktop.png' },
  @{ Label = 'Desktop - content-driven activity'; File = 'p2p-trade-activity-desktop.png' },
  @{ Label = 'Mobile - concise review fields'; File = 'p2p-trade-review-mobile.png' },
  @{ Label = 'Mobile - content-driven activity'; File = 'p2p-trade-activity-mobile.png' }
)

Write-ContactSheet -Items $tradeTerminalDetailCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '82-p2p-trade-terminal-detail-refinement.jpg'

$sharedAddressVisibilityCaptures = @(
  @{ Label = 'Desktop - one complete shortened address'; File = 'shared-header-dex-desktop.png' },
  @{ Label = 'Mobile - useful compact address'; File = 'shared-header-dex-mobile.png' }
)

Write-ContactSheet -Items $sharedAddressVisibilityCaptures -Columns 2 -CellWidth 720 -CellHeight 320 -OutputName '83-shared-header-address-visibility.jpg'

$disconnectedHeaderCaptures = @(
  @{ Label = 'Desktop - one connection action'; File = '..\whole-product-captures\chat-disconnected-desktop.png' },
  @{ Label = 'Mobile - compact connection controls'; File = '..\whole-product-captures\chat-disconnected-mobile.png' }
)

Write-ContactSheet -Items $disconnectedHeaderCaptures -Columns 2 -CellWidth 720 -CellHeight 320 -OutputName '84-shared-header-disconnected-simplification.jpg'

$p2pCreateTaskHierarchyCaptures = @(
  @{ Label = 'Desktop - one-off task hierarchy'; File = 'p2p-create-public-desktop.png' },
  @{ Label = 'Mobile - one-off task hierarchy'; File = 'p2p-create-mobile.png' },
  @{ Label = 'Desktop - recurring task hierarchy'; File = 'p2p-create-recurring-desktop.png' },
  @{ Label = 'Mobile - recurring task hierarchy'; File = 'p2p-create-recurring-mobile.png' }
)

Write-ContactSheet -Items $p2pCreateTaskHierarchyCaptures -Columns 2 -CellWidth 720 -CellHeight 560 -OutputName '85-p2p-create-task-hierarchy.jpg'

function Write-HeaderCropSheet {
  param(
    [Parameter(Mandatory = $true)] [array]$Items,
    [Parameter(Mandatory = $true)] [int]$Columns,
    [Parameter(Mandatory = $true)] [int]$CellWidth,
    [Parameter(Mandatory = $true)] [int]$CropHeight,
    [Parameter(Mandatory = $true)] [string]$OutputName
  )

  $headerLabelHeight = 34
  $rows = [int][Math]::Ceiling($Items.Count / $Columns)
  $cellHeight = $headerLabelHeight + $CropHeight
  $headerSheet = New-Object System.Drawing.Bitmap -ArgumentList ([int]($CellWidth * $Columns)), ([int]($cellHeight * $rows))
  $headerGraphics = [System.Drawing.Graphics]::FromImage($headerSheet)
  $headerFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 232, 248))
  try {
    $headerGraphics.Clear([System.Drawing.Color]::FromArgb(7, 9, 16))
    $headerGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    for ($itemIndex = 0; $itemIndex -lt $Items.Count; $itemIndex++) {
      $item = $Items[$itemIndex]
      $itemImage = [System.Drawing.Image]::FromFile((Join-Path $captureRoot $item.File))
      try {
        $itemColumn = $itemIndex % $Columns
        $itemRow = [Math]::Floor($itemIndex / $Columns)
        $itemX = [int]($itemColumn * $CellWidth)
        $itemY = [int]($itemRow * $cellHeight)
        $headerGraphics.DrawString($item.Label, $headerFont, $headerBrush, $itemX + 12, $itemY + 6)
        $sourceHeight = [Math]::Min($CropHeight, $itemImage.Height)
        $scale = [Math]::Min($CellWidth / $itemImage.Width, $CropHeight / $sourceHeight)
        $drawWidth = [int][Math]::Round($itemImage.Width * $scale)
        $drawHeight = [int][Math]::Round($sourceHeight * $scale)
        $drawX = $itemX + [int][Math]::Floor(($CellWidth - $drawWidth) / 2)
        $drawY = $itemY + $headerLabelHeight
        $destination = New-Object System.Drawing.Rectangle -ArgumentList $drawX, $drawY, $drawWidth, $drawHeight
        $source = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $itemImage.Width, $sourceHeight
        $headerGraphics.DrawImage($itemImage, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $itemImage.Dispose()
      }
    }
    $headerOutputRoot = Join-Path $projectRoot 'design-audit\completion-audit'
    New-Item -ItemType Directory -Force -Path $headerOutputRoot | Out-Null
    $headerOutput = Join-Path $headerOutputRoot $OutputName
    $headerSheet.Save($headerOutput, $jpegCodec, $encoderParameters)
    Write-Output $headerOutput
  } finally {
    $headerBrush.Dispose()
    $headerFont.Dispose()
    $headerGraphics.Dispose()
    $headerSheet.Dispose()
  }
}

$sharedHeaderDesktopRoutes = @(
  @{ Label = 'Chat'; File = '..\whole-product-captures\chat-connected-empty-desktop.png' },
  @{ Label = 'Privacy Portal'; File = '..\whole-product-captures\privacy-portal-connected-desktop.png' },
  @{ Label = 'Private TVL'; File = '..\whole-product-captures\private-tvl-desktop.png' },
  @{ Label = 'Trading'; File = '..\whole-product-captures\trade-agent-desktop.png' }
)

$sharedHeaderMobileRoutes = @(
  @{ Label = 'Chat'; File = '..\whole-product-captures\chat-connected-empty-mobile.png' },
  @{ Label = 'Privacy Portal'; File = '..\whole-product-captures\privacy-portal-connected-mobile.png' },
  @{ Label = 'Private TVL'; File = '..\whole-product-captures\private-tvl-mobile.png' },
  @{ Label = 'Trading'; File = '..\whole-product-captures\trade-agent-mobile.png' }
)

Write-HeaderCropSheet -Items $sharedHeaderDesktopRoutes -Columns 1 -CellWidth 1440 -CropHeight 90 -OutputName '86-shared-header-route-consistency-desktop.jpg'
Write-HeaderCropSheet -Items $sharedHeaderMobileRoutes -Columns 2 -CellWidth 430 -CropHeight 180 -OutputName '87-shared-header-route-consistency-mobile.jpg'

$p2pTradeMobileDockCaptures = @(
  @{ Label = 'Trade review - Offers context retained'; File = 'p2p-trade-review-mobile.png' },
  @{ Label = 'Activity - P2P dock remains attached'; File = 'p2p-trade-activity-mobile.png' }
)

Write-ContactSheet -Items $p2pTradeMobileDockCaptures -Columns 2 -CellWidth 430 -CellHeight 720 -OutputName '88-p2p-trade-review-mobile-dock.jpg'

$cellWidth = 720
$cellHeight = 520
$labelHeight = 40
$sheet = New-Object System.Drawing.Bitmap -ArgumentList ([int]($cellWidth * 2)), ([int]($cellHeight * 3))
$sheetGraphics = [System.Drawing.Graphics]::FromImage($sheet)
$labelFont = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 232, 248))
try {
  $sheetGraphics.Clear([System.Drawing.Color]::FromArgb(7, 9, 16))
  $sheetGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  for ($index = 0; $index -lt $executionStateCaptures.Count; $index++) {
    $captureSpec = $executionStateCaptures[$index]
    $capturePath = Join-Path $captureRoot $captureSpec.File
    $capture = [System.Drawing.Image]::FromFile($capturePath)
    try {
      $column = $index % 2
      $row = [Math]::Floor($index / 2)
      $cellX = [int]($column * $cellWidth)
      $cellY = [int]($row * $cellHeight)
      $sheetGraphics.DrawString($captureSpec.Label, $labelFont, $labelBrush, $cellX + 16, $cellY + 8)
      $availableWidth = $cellWidth
      $availableHeight = $cellHeight - $labelHeight
      $scale = [Math]::Min($availableWidth / $capture.Width, $availableHeight / $capture.Height)
      $drawWidth = [int][Math]::Round($capture.Width * $scale)
      $drawHeight = [int][Math]::Round($capture.Height * $scale)
      $drawX = $cellX + [int][Math]::Floor(($availableWidth - $drawWidth) / 2)
      $drawY = $cellY + $labelHeight
      $sheetGraphics.DrawImage($capture, $drawX, $drawY, $drawWidth, $drawHeight)
    } finally {
      $capture.Dispose()
    }
  }
  $completionAuditRoot = Join-Path $projectRoot 'design-audit\completion-audit'
  New-Item -ItemType Directory -Force -Path $completionAuditRoot | Out-Null
  $executionStateOutput = Join-Path $completionAuditRoot '56-p2p-execution-feedback-states.jpg'
  $sheet.Save($executionStateOutput, $jpegCodec, $encoderParameters)
  Write-Output $executionStateOutput
} finally {
  $labelBrush.Dispose()
  $labelFont.Dispose()
  $sheetGraphics.Dispose()
  $sheet.Dispose()
}

$encoderParameters.Dispose()
