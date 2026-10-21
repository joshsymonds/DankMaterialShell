import QtQuick
import qs.Common
import qs.Widgets

// Wraps an OSD's icon/slider row with a small device/app-name label so
// the user can tell at a glance which sink, source, MPRIS player, or
// display the OSD is targeting (e.g. "SB Katana V2X Analog Stereo"
// for the system VolumeOSD vs "Spotify" for the MediaVolumeOSD — they
// look identical otherwise).
//
// Layout:
//   useVertical=false → [label] above [content]   (default for bar-style OSDs)
//   useVertical=true  → [content] above [label]   (label sits near screen edge)
//
// The content slot is the default property, so consumers just place
// their existing icon+slider Item inside the tag.
//
// Hides the label entirely when `title` is empty so opt-out is trivial
// (a consumer that doesn't pass a title falls back to standard layout
// minus the label band).
Item {
    id: root

    property string title: ""
    property bool useVertical: false
    default property alias contentChildren: contentHolder.data

    Column {
        anchors.fill: parent
        anchors.margins: Theme.spacingS
        spacing: Theme.spacingXS

        StyledText {
            id: topLabel
            visible: !root.useVertical && root.title.length > 0
            width: parent.width
            text: root.title
            font.pixelSize: Theme.fontSizeSmall
            color: Theme.surfaceVariantText
            elide: Text.ElideRight
            horizontalAlignment: Text.AlignHCenter
        }

        Item {
            id: contentHolder
            width: parent.width
            // Computed height: Column body minus whichever single label is
            // visible (plus its inter-row spacing). topLabel and bottomLabel
            // are mutually exclusive by construction — their `visible`
            // bindings split on `useVertical` — so at most one of topH/botH
            // is ever non-zero. We never double-count spacing.
            //
            // Works the same for horizontal (~40 high) and vertical
            // (whatever the OSD's tall axis allows). No floor: if the
            // residual is too small to fit the slot's content, the bug is
            // upstream in the consumer's osdHeight and should be exposed,
            // not papered over here.
            height: {
                const topH = topLabel.visible ? topLabel.implicitHeight + parent.spacing : 0;
                const botH = bottomLabel.visible ? bottomLabel.implicitHeight + parent.spacing : 0;
                return parent.height - topH - botH;
            }
        }

        StyledText {
            id: bottomLabel
            visible: root.useVertical && root.title.length > 0
            width: parent.width
            text: root.title
            font.pixelSize: Theme.fontSizeSmall
            color: Theme.surfaceVariantText
            elide: Text.ElideRight
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
