# Custom NSIS steps for the Nexus installer/uninstaller (electron-builder
# `nsis.include`). Must stay UTF-8 WITH BOM — makensis mis-decodes the Serbian
# diacritics below without it.
#
# customUnInstall runs inside the generated uninstaller, after the app files
# are removed. It offers to also delete the user's local data — everything the
# app ever writes:
#   $APPDATA\Nexus            userData (nexus.db, window state, localStorage)
#   $LOCALAPPDATA\Nexus-updater   electron-updater download cache
# The prompt defaults to "Ne" (MB_DEFBUTTON2 for the focused button, /SD IDNO
# for silent runs), so data survives unless the user explicitly chooses
# deletion. ${isUpdated} guards the auto-update path: when the uninstaller
# runs as part of installing a newer version, nothing is asked and nothing is
# deleted.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Da li želiš da obrišeš i sve lokalne podatke aplikacije Nexus (bazu podataka i podešavanja)?$\r$\n$\r$\nOvo se ne može opozvati. Ako planiraš ponovnu instalaciju ili si izvezao podatke, izaberi Ne da ih zadržiš." \
      /SD IDNO IDYES nexusRemoveUserData
    Goto nexusKeepUserData
    nexusRemoveUserData:
      RMDir /r "$APPDATA\Nexus"
      RMDir /r "$LOCALAPPDATA\Nexus-updater"
    nexusKeepUserData:
  ${endIf}
!macroend
