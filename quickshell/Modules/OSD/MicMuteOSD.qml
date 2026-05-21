import QtQuick
import qs.Common
import qs.Services
import qs.Widgets

DankOSD {
    id: root

    readonly property bool useVertical: isVerticalLayout

    // Sized to match the other audio OSDs so the labeled wrapper has room
    // for the source name (e.g. "C920 HD Pro Webcam Analog Stereo"). Was
    // previously a tiny icon-only square — gave up some compactness for
    // disambiguation, which was the whole point of the wrapper.
    osdWidth: useVertical ? (40 + Theme.spacingS * 2) : Math.min(260, Screen.width - Theme.spacingM * 2)
    osdHeight: useVertical ? Math.min(260, Screen.height - Theme.spacingM * 2) : (40 + Theme.fontSizeSmall + Theme.spacingS * 3)
    autoHideInterval: 2000
    enableMouseInteraction: false

    Connections {
        target: AudioService
        function onMicMuteChanged() {
            if (SettingsData.osdMicMuteEnabled) {
                root.show();
            }
        }
    }

    content: Loader {
        anchors.fill: parent
        sourceComponent: useVertical ? verticalContent : horizontalContent
    }

    Component {
        id: horizontalContent

        OSDLabeledContent {
            anchors.fill: parent
            title: AudioService.displayName(AudioService.source) || ""
            useVertical: false

            DankIcon {
                anchors.centerIn: parent
                name: AudioService.source?.audio?.muted ? "mic_off" : "mic"
                size: Theme.iconSize
                color: AudioService.source?.audio?.muted ? Theme.error : Theme.primary
            }
        }
    }

    Component {
        id: verticalContent

        OSDLabeledContent {
            anchors.fill: parent
            title: AudioService.displayName(AudioService.source) || ""
            useVertical: true

            DankIcon {
                anchors.centerIn: parent
                name: AudioService.source?.audio?.muted ? "mic_off" : "mic"
                size: Theme.iconSize
                color: AudioService.source?.audio?.muted ? Theme.error : Theme.primary
            }
        }
    }
}
