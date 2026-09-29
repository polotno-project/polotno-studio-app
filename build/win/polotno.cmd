@echo off
rem Command-line entry point: `polotno render ...` / `polotno lint ...`.
rem Polotno.exe is a GUI program, and cmd/PowerShell do not wait for one typed
rem at the prompt. A batch file does wait, so the output lands before the next
rem prompt and the exit code survives.
"%~dp0..\..\Polotno.exe" %*
exit /b %ERRORLEVEL%
