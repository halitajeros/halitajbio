param(
  [string]$InputPath = (Join-Path $PSScriptRoot '_import.docx'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'questions.js')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-DocumentXml {
  param([string]$Path)

  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entry = $zip.Entries | Where-Object FullName -eq 'word/document.xml'
    $reader = New-Object IO.StreamReader($entry.Open())
    try {
      return $reader.ReadToEnd()
    }
    finally {
      $reader.Close()
    }
  }
  finally {
    $zip.Dispose()
  }
}

function Normalize-Text {
  param([string]$Text)

  return (($Text -replace '\s+', ' ').Trim())
}

function Get-ParagraphData {
  param(
    [System.Xml.XmlNode]$Paragraph,
    [System.Xml.XmlNamespaceManager]$NamespaceManager
  )

  $characters = New-Object System.Collections.Generic.List[char]
  $colors = New-Object System.Collections.Generic.List[string]

  foreach ($run in $Paragraph.SelectNodes('./w:r', $NamespaceManager)) {
    $colorNode = $run.SelectSingleNode('./w:rPr/w:color', $NamespaceManager)
    $color = if ($null -ne $colorNode) { $colorNode.val.ToUpperInvariant() } else { 'NONE' }

    foreach ($node in $run.ChildNodes) {
      switch ($node.Name) {
        'w:t' {
          foreach ($character in $node.InnerText.ToCharArray()) {
            [void]$characters.Add($character)
            [void]$colors.Add($color)
          }
        }
        'w:tab' {
          [void]$characters.Add([char]9)
          [void]$colors.Add('NONE')
        }
        'w:br' {
          [void]$characters.Add([char]10)
          [void]$colors.Add('NONE')
        }
        'w:cr' {
          [void]$characters.Add([char]10)
          [void]$colors.Add('NONE')
        }
      }
    }
  }

  [void]$characters.Add([char]10)
  [void]$colors.Add('NONE')

  return [pscustomobject]@{
    Text = (-join $characters)
    Colors = $colors
  }
}

function New-Block {
  return [pscustomobject]@{
    TextBuilder = [System.Text.StringBuilder]::new()
    Colors = New-Object System.Collections.Generic.List[string]
  }
}

function Append-BlockSlice {
  param(
    [object]$Block,
    [string]$Text,
    [System.Collections.Generic.List[string]]$Colors,
    [int]$Start,
    [int]$Length
  )

  if ($null -eq $Block -or $Length -le 0) {
    return
  }

  $end = [Math]::Min($Start + $Length, $Text.Length)
  for ($index = $Start; $index -lt $end; $index += 1) {
    [void]$Block.TextBuilder.Append($Text[$index])
    [void]$Block.Colors.Add($Colors[$index])
  }
}

function Get-ColorSliceHasRed {
  param(
    [System.Collections.Generic.List[string]]$Colors,
    [int]$Start,
    [int]$Length
  )

  $end = [Math]::Min($Start + $Length, $Colors.Count)
  for ($index = $Start; $index -lt $end; $index += 1) {
    if ($Colors[$index] -eq 'FF0000') {
      return $true
    }
  }

  return $false
}

function Parse-Block {
  param([object]$Block)

  $blockText = $Block.TextBuilder.ToString()
  $headerMatch = [regex]::Match($blockText, '^\s*(\d{1,4})\.(?=\s*[A-Za-zÇçËë])\s*')
  if (-not $headerMatch.Success) {
    return $null
  }

  $contentStart = $headerMatch.Index + $headerMatch.Length
  $optionsText = $blockText.Substring($contentStart)
  $optionMatches = [regex]::Matches($optionsText, '[a-dA-D]\.\s*')

  $questionEnd = if ($optionMatches.Count -gt 0) { $optionMatches[0].Index } else { $optionsText.Length }
  $contentText = Normalize-Text -Text ($optionsText.Substring(0, $questionEnd))
  if ([string]::IsNullOrWhiteSpace($contentText)) {
    return $null
  }

  $options = New-Object System.Collections.Generic.List[object]
  $correctIndex = -1

  for ($index = 0; $index -lt $optionMatches.Count; $index += 1) {
    $match = $optionMatches[$index]
    $optionStart = $match.Index + $match.Length
    $optionEnd = if ($index + 1 -lt $optionMatches.Count) { $optionMatches[$index + 1].Index } else { $optionsText.Length }

    $rawOption = $optionsText.Substring($optionStart, [Math]::Max(0, $optionEnd - $optionStart))
    $optionText = Normalize-Text -Text $rawOption
    if ([string]::IsNullOrWhiteSpace($optionText)) {
      continue
    }

    $hasRed = Get-ColorSliceHasRed -Colors $Block.Colors -Start ($contentStart + $optionStart) -Length ($optionEnd - $optionStart)
    $options.Add([pscustomobject]@{
      Text = $optionText
      HasRed = $hasRed
    })
  }

  for ($index = 0; $index -lt $options.Count; $index += 1) {
    if ($options[$index].HasRed) {
      $correctIndex = $index
      break
    }
  }

  return [pscustomobject]@{
    question = $contentText
    options = @($options | ForEach-Object Text)
    correctIndex = $correctIndex
  }
}

$xml = Get-DocumentXml -Path $InputPath
[xml]$doc = $xml
$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')

$questions = New-Object System.Collections.Generic.List[object]
$currentBlock = $null

foreach ($paragraph in $doc.SelectNodes('//w:body//w:p', $ns)) {
  $paragraphData = Get-ParagraphData -Paragraph $paragraph -NamespaceManager $ns
  $paragraphText = $paragraphData.Text
  $paragraphColors = $paragraphData.Colors

  $matches = [regex]::Matches($paragraphText, '(?<!\d)(\d{1,4})\.(?=\s*[A-Za-zÇçËë])')
  if ($matches.Count -eq 0) {
    if ($null -ne $currentBlock) {
      Append-BlockSlice -Block $currentBlock -Text $paragraphText -Colors $paragraphColors -Start 0 -Length $paragraphText.Length
    }
    continue
  }

  $cursor = 0
  foreach ($match in $matches) {
    if ($null -ne $currentBlock -and $match.Index -gt $cursor) {
      Append-BlockSlice -Block $currentBlock -Text $paragraphText -Colors $paragraphColors -Start $cursor -Length ($match.Index - $cursor)
    }

    if ($null -ne $currentBlock) {
      $question = Parse-Block -Block $currentBlock
      if ($null -ne $question) {
        $questions.Add($question)
      }
    }

    $currentBlock = New-Block
    Append-BlockSlice -Block $currentBlock -Text $paragraphText -Colors $paragraphColors -Start $match.Index -Length ($match.Length)
    $cursor = $match.Index + $match.Length
  }

  if ($null -ne $currentBlock -and $cursor -lt $paragraphText.Length) {
    Append-BlockSlice -Block $currentBlock -Text $paragraphText -Colors $paragraphColors -Start $cursor -Length ($paragraphText.Length - $cursor)
  }
}

if ($null -ne $currentBlock) {
  $question = Parse-Block -Block $currentBlock
  if ($null -ne $question) {
    $questions.Add($question)
  }
}

$json = $questions | ConvertTo-Json -Depth 6 -Compress
$js = 'window.BIOLOGY_QUESTIONS = ' + $json + ';'
Set-Content -LiteralPath $OutputPath -Value $js -Encoding UTF8

Write-Output ('Imported questions: ' + $questions.Count)
