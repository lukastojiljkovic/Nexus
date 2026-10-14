# Custom NSIS steps for the Nexus installer/uninstaller (electron-builder
# `nsis.include`). Must stay UTF-8 WITH BOM even though nothing below needs a
# diacritic any more: the BOM was added for the Serbian prompt this file used to
# carry, and makensis mis-decodes a Serbian string without it — so it is kept,
# and a Serbian line written here later does not have to rediscover that.
#
# customUnInstall runs inside the generated uninstaller, after the app files
# are removed. It offers to also delete the user's local data — everything the
# app ever writes:
#   $APPDATA\Nexus            userData (nexus.db, window state, localStorage,
#                             including the update downloads under updates/)
#   $LOCALAPPDATA\Nexus-updater   a legacy cache directory left by builds that
#                             shipped electron-updater; removed if present
#   $APPDATA\@nexus\desktop   the data folder Nexus 2.0.0 to 2.0.2 wrote by
#                             mistake. 2.0.3 moves what is in it into
#                             $APPDATA\Nexus on its first launch and deletes
#                             nothing there, so this uninstaller is the only
#                             thing that removes it. The scope folder above it,
#                             $APPDATA\@nexus, is then removed WITHOUT /r:
#                             another app could own that folder, so it goes only
#                             if it is empty.
# The prompt defaults to "No" (MB_DEFBUTTON2 for the focused button, /SD IDNO
# for silent runs), so data survives unless the user explicitly chooses
# deletion. ${isUpdated} guards the auto-update path: when the uninstaller
# runs as part of installing a newer version, nothing is asked and nothing is
# deleted.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also delete Nexus's local data on this computer: accounts, settings, downloaded packs and models?$\r$\n$\r$\nThis cannot be undone. Choose No to keep it, for example if you plan to reinstall or have not exported your data." \
      /SD IDNO IDYES nexusRemoveUserData
    Goto nexusKeepUserData
    nexusRemoveUserData:
      RMDir /r "$APPDATA\Nexus"
      RMDir /r "$LOCALAPPDATA\Nexus-updater"
      RMDir /r "$APPDATA\@nexus\desktop"
      RMDir "$APPDATA\@nexus"
    nexusKeepUserData:
  ${endIf}
!macroend
