import * as React from 'react';
import { Platform, Pressable, View, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { ICON_LABEL_OPTICAL_NUDGE_STYLE } from '@/components/ui/icons/iconOpticalAlignment';
import { MENU_ROW_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { Text } from '@/components/ui/text/Text';


/**
 * Resizes an icon-like accessory, and only an icon-like one.
 *
 * Mirrors `Item`'s accessory rule: a node is icon-like when it names a glyph and takes a size and
 * has no children. Avatars, gauges and composed nodes are laid out by their own owner and must not
 * be stretched to the icon box.
 */
function sizeRowIconForDensity(node: React.ReactNode, glyphSize: number): React.ReactNode {
    if (!React.isValidElement(node) || node.type === React.Fragment) return node;
    const props = (node.props ?? {}) as Record<string, unknown>;
    const isIconLike = typeof props.name === 'string'
        && (typeof props.size === 'number' || typeof props.size === 'string')
        && props.children == null;
    if (!isIconLike) return node;
    return React.cloneElement(node, { size: glyphSize } as Record<string, unknown>);
}

export type SelectableRowVariant = 'slim' | 'default' | 'selectable';

export type SelectableRowProps = Readonly<{
    testID?: string;
    title: React.ReactNode;
    /** Zero allows the full title to wrap within the available row width. */
    titleLines?: number;
    subtitle?: React.ReactNode;
    left?: React.ReactNode;
    right?: React.ReactNode;
    leftGap?: number;

    selected?: boolean;
    disabled?: boolean;
    destructive?: boolean;

    variant?: SelectableRowVariant;
    onPress?: () => void;
    onHover?: () => void;
    onMouseDownCapture?: (event: unknown) => void;

    containerStyle?: StyleProp<ViewStyle>;
    titleStyle?: StyleProp<TextStyle>;
    subtitleStyle?: StyleProp<TextStyle>;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 10,
        backgroundColor: 'transparent',
    },
    rowSlim: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 0,
    },
    rowDefault: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    rowSelectable: {
        // Match historical CommandPalette look
        paddingHorizontal: 24,
        paddingVertical: 12,
        marginHorizontal: 8,
        marginVertical: 2,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    rowPressed: {
        backgroundColor: theme.colors.surface.pressed,
    },
    rowHovered: {
        backgroundColor: theme.colors.surface.pressed,
    },
    rowSelected: {
        backgroundColor: theme.colors.surface.pressedOverlay,
        borderColor: theme.colors.border.default,
    },
    // Palette variant states (match old CommandPaletteItem styles exactly)
    rowSelectablePressed: {
        backgroundColor: theme.colors.surface.pressed,
    },
    rowSelectableHovered: {
        backgroundColor: theme.dark ? theme.colors.surface.elevated : theme.colors.surface.inset,
    },
    rowSelectableSelected: {
        backgroundColor: theme.colors.surface.selected,
        borderColor: theme.colors.accent.blue,
    },
    rowDisabled: {
        opacity: 0.5,
    },
    left: {
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
        // Optical, not geometric — see ICON_LABEL_OPTICAL_NUDGE_STYLE.
        ...ICON_LABEL_OPTICAL_NUDGE_STYLE,
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...Typography.default(),
        color: theme.colors.text.primary,
        fontSize: Platform.select({ ios: 16, default: 15 }),
        lineHeight: Platform.select({ ios: 20, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.2, default: 0 }),
    },
    titleSelectable: {
        color: theme.colors.text.primary,
        fontSize: 15,
        letterSpacing: -0.2,
    },
    titleDestructive: {
        color: theme.colors.state.danger.foreground,
    },
    subtitle: {
        ...Typography.default(),
        marginTop: 2,
        color: theme.colors.text.secondary,
        fontSize: Platform.select({ ios: 13, default: 13 }),
        lineHeight: 18,
    },
    subtitleSelectable: {
        color: theme.colors.text.secondary,
        letterSpacing: -0.1,
    },
    right: {
        marginLeft: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    accessoryTitleAligned: {
        alignSelf: 'flex-start',
        marginTop: 2,
    },
}));

export function SelectableRow(props: SelectableRowProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [isHovered, setIsHovered] = React.useState(false);

    const variant: SelectableRowVariant = props.variant ?? 'default';
    const selected = Boolean(props.selected);
    const disabled = Boolean(props.disabled);

    const canHover = Platform.OS === 'web' && !disabled;

    const pressableProps: any = {};
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = () => {
            if (!canHover) return;
            setIsHovered(true);
            props.onHover?.();
        };
        pressableProps.onMouseLeave = () => {
            if (!canHover) return;
            setIsHovered(false);
        };
        if (props.onMouseDownCapture) {
            pressableProps.onMouseDownCapture = props.onMouseDownCapture;
        }
    }

    const rowVariantStyle =
        variant === 'slim'
            ? styles.rowSlim
            : variant === 'selectable'
                ? styles.rowSelectable
                : styles.rowDefault;

    const iconGlyphSize = MENU_ROW_METRICS.iconGlyphSizePx;
    const titleColorStyle = props.destructive ? styles.titleDestructive : null;
    const titleVariantStyle = variant === 'selectable' ? styles.titleSelectable : null;
    const subtitleVariantStyle = variant === 'selectable' ? styles.subtitleSelectable : null;
    // A menu row's icon is one size whichever row kind the dropdown chose, and whatever list density
    // the user prefers. `SelectableRow` rows used to pass the call site's number straight through, so
    // the same DropdownMenu could show 16px icons on one menu and 24px on the next.
    const leftAccessory = React.useMemo(
        () => sizeRowIconForDensity(normalizeNodeForView(props.left ?? null), iconGlyphSize),
        [props.left, iconGlyphSize],
    );
    const rightAccessory = React.useMemo(() => normalizeNodeForView(props.right ?? null), [props.right]);
    const accessoryTitleAlignmentStyle = props.subtitle ? styles.accessoryTitleAligned : null;

    return (
        <Pressable
            testID={props.testID}
            onPress={disabled ? undefined : props.onPress}
            disabled={disabled}
            accessibilityRole={props.onPress ? 'button' : undefined}
            style={({ pressed }) => ([
                styles.row,
                rowVariantStyle,
                Platform.OS === 'web' && disabled ? ({ cursor: 'not-allowed' } as any) : null,
                pressed && !disabled
                    ? (variant === 'selectable' ? styles.rowSelectablePressed : styles.rowPressed)
                    : null,
                isHovered && !selected && !disabled
                    ? (variant === 'selectable' ? styles.rowSelectableHovered : styles.rowHovered)
                    : null,
                selected
                    ? (variant === 'selectable' ? styles.rowSelectableSelected : styles.rowSelected)
                    : null,
                disabled ? styles.rowDisabled : null,
                props.containerStyle,
            ])}
            {...pressableProps}
        >
            {leftAccessory ? (
                <View style={[styles.left, accessoryTitleAlignmentStyle, typeof props.leftGap === 'number' ? { marginRight: props.leftGap } : null]}>
                    {leftAccessory}
                </View>
            ) : null}

            <View style={styles.content}>
                <Text style={[styles.title, titleVariantStyle, titleColorStyle, props.titleStyle]} numberOfLines={props.titleLines ?? 1}>
                    {props.title}
                </Text>
                {props.subtitle ? (
                    <Text style={[styles.subtitle, subtitleVariantStyle, props.subtitleStyle]} numberOfLines={2}>
                        {props.subtitle}
                    </Text>
                ) : null}
            </View>

            {rightAccessory ? (
                <View style={[styles.right, accessoryTitleAlignmentStyle]}>
                    {rightAccessory}
                </View>
            ) : null}
        </Pressable>
    );
}
