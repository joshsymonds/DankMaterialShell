pragma Singleton
pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import qs.Common
import "GreetdEnv.js" as GreetdEnv

Singleton {
    id: root

    readonly property var _envRememberLastSession: GreetdEnv.readBoolOverride(Quickshell.env, ["DMS_GREET_REMEMBER_LAST_SESSION", "DMS_SAVE_SESSION"], undefined)
    readonly property var _envRememberLastUser: GreetdEnv.readBoolOverride(Quickshell.env, ["DMS_GREET_REMEMBER_LAST_USER", "DMS_SAVE_USERNAME"], undefined)

    readonly property bool settingsLoaded: SettingsData._hasLoaded
    readonly property bool rememberLastSession: _envRememberLastSession !== undefined ? _envRememberLastSession : SettingsData.greeterRememberLastSession
    readonly property bool rememberLastUser: _envRememberLastUser !== undefined ? _envRememberLastUser : SettingsData.greeterRememberLastUser
    // When true, the greeter renders no wallpaper Image and no dim
    // Rectangle — the layer surface (already transparent) reveals
    // whatever the underlying compositor is painting. Intended for
    // hosts like halmasuit (Linux system compositor) which paint the
    // wallpaper themselves; without this, DMS's own SessionData
    // fallback paints opaque on top. Default false preserves upstream
    // behavior; flip true only in greeter contexts.
    readonly property bool greeterTransparentBackground: SettingsData.greeterTransparentBackground

    function setConfigBaseDir(dir) {
        SettingsData.setGreeterSettingsBaseDir(dir);
    }

    function resetConfigBaseDir() {
        SettingsData.resetGreeterSettingsBaseDir();
    }
}
