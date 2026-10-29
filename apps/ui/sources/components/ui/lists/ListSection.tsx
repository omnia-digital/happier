import * as React from 'react';
import { Platform, View, type StyleProp, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SelectionListSectionHeader } from '@/components/ui/selectionList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';

/**
 * A titled list section in two densities: `flat` (a popover's eyebrow + rows) and `grouped` (a
 * screen's inset group). Shared by the Inbox and Updates surfaces, which render the same content in
 * both densities.
 */
export const ListSection = React.memo(function ListSection(props: Readonly<{
    /** Test-id namespace of the owning surface: ids read `${namespace}.section.${id}`. */
    namespace: string;
    id: string;
    title: string;
    /** Keep the title's case (names such as hostnames are case-meaningful). */
    preserveTitleCase?: boolean;
    titleStyle?: StyleProp<TextStyle>;
    children: React.ReactNode;
    headerAction?: React.ReactNode;
    spacing?: 'following' | 'separated';
    surface?: 'flat' | 'grouped';
}>) {
    const grouped = props.surface === 'grouped';
    const header = (
        <SelectionListSectionHeader
            testID={`${props.namespace}.section.${props.id}.header`}
            title={props.title}
            preserveCase={props.preserveTitleCase}
            titleStyle={props.titleStyle}
            rightAccessory={props.headerAction}
            containerStyle={grouped
                ? styles.groupedHeader
                : props.headerAction
                    ? styles.actionHeader
                    : undefined}
        />
    );

    return (
        <View
            testID={`${props.namespace}.section.${props.id}`}
            style={[
                styles.section,
                props.spacing === 'following' ? styles.sectionFollowing : null,
                props.spacing === 'separated' ? styles.sectionSeparated : null,
            ]}
        >
            {grouped ? (
                <ItemGroup title={header} headerStyle={styles.groupedItemGroupHeader} clipContent>
                    {props.children}
                </ItemGroup>
            ) : (
                <>
                    {header}
                    {props.children}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    section: {
        width: '100%',
    },
    sectionFollowing: {
        marginTop: 6,
    },
    sectionSeparated: {
        marginTop: 14,
    },
    groupedHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 0,
        paddingBottom: 0,
    },
    actionHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
    },
    groupedItemGroupHeader: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
}));
