; Puts the `polotno` command (resources\bin\polotno.cmd) on the per-user PATH.
; An auto-update runs the old uninstaller and then this installer, so the
; entry is removed and re-added — never duplicated.

!macro polotnoCliPath ACTION
  InitPluginsDir
  File /oname=$PLUGINSDIR\cli-path.ps1 "${BUILD_RESOURCES_DIR}\win\cli-path.ps1"
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cli-path.ps1" -Action ${ACTION} -Dir "$INSTDIR\resources\bin"'
  Pop $0
  ; WM_SETTINGCHANGE to all windows, so newly opened terminals see the change.
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  !insertmacro polotnoCliPath add
!macroend

!macro customUnInstall
  !insertmacro polotnoCliPath remove
!macroend
