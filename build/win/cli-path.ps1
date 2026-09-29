# Adds or removes the Polotno CLI folder on the per-user PATH. Run by the NSIS
# installer (build/installer.nsh). Reads and writes the raw registry value so
# entries like %USERPROFILE%\bin stay unexpanded and the value stays
# REG_EXPAND_SZ — [Environment]::SetEnvironmentVariable would flatten both.
param(
  [Parameter(Mandatory)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory)][string]$Dir
)

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  $current = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  # -ne is case-insensitive, like Windows paths.
  $entries = @($current -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Dir.TrimEnd('\')) })
  if ($Action -eq 'add') { $entries += $Dir }
  $updated = $entries -join ';'
  if ($updated -ne $current) {
    if ($updated) { $key.SetValue('Path', $updated, 'ExpandString') }
    else { $key.DeleteValue('Path', $false) }
  }
}
finally {
  $key.Close()
}
