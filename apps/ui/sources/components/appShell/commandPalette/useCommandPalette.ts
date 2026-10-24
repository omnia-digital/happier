import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ElementRef } from 'react';

import { Command, CommandCategory } from './types';
import { TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';
import { buildCommandPaletteSessionSearchCommands, type CommandPaletteSearchSessionItem } from './buildCommandPaletteCommands';
import type { NavigateToSessionOptions } from '@/hooks/session/useNavigateToSession';


export function useCommandPalette(
    commands: Command[],
    onClose: () => void,
    sessionItems: ReadonlyArray<CommandPaletteSearchSessionItem>,
    activeServerId: string,
    navigateToSession: (sessionId: string, options?: NavigateToSessionOptions) => void | Promise<void>,
    searchQuery: string,
    setSearchQuery: (query: string) => void,
    searchMode: 'titles' | 'content',
    contentCommands: ReadonlyArray<Command>,
) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<ElementRef<typeof TextInput> | null>(null);
    const matchingSessions = useMemo(
        () => searchMode === 'titles'
            ? buildCommandPaletteSessionSearchCommands(sessionItems, searchQuery, activeServerId, navigateToSession)
            : contentCommands,
        [sessionItems, searchQuery, activeServerId, navigateToSession, searchMode, contentCommands],
    );

    // Filter commands based on search query
    const filteredCategories = useMemo((): CommandCategory[] => {
        if (!searchQuery.trim() && searchMode === 'titles') {
            // Group commands by category
            const grouped = commands.reduce((acc, command) => {
                const category = command.category || 'General';
                if (!acc[category]) {
                    acc[category] = [];
                }
                acc[category].push(command);
                return acc;
            }, {} as Record<string, Command[]>);

            return Object.entries(grouped).map(([title, cmds]) => ({
                id: title.toLowerCase().replace(/\s+/g, '-'),
                title,
                commands: cmds
            }));
        }

        // Fuzzy search
        const query = searchQuery.trim().toLocaleLowerCase();
        const filtered = commands.filter(command => {
            // Recent suggestions are replaced by live, scoped title matches while searching.
            if (command.category === t('commandPalette.commands.recentSessionsCategory')) return false;
            const titleMatch = command.title.toLowerCase().includes(query);
            const subtitleMatch = command.subtitle?.toLowerCase().includes(query);
            return titleMatch || subtitleMatch;
        });

        const results = [...matchingSessions, ...filtered];

        if (results.length === 0) {
            return [];
        }

        // Group filtered results
        const grouped = results.reduce((acc, command) => {
            const category = command.category || 'Results';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(command);
            return acc;
        }, {} as Record<string, Command[]>);

        return Object.entries(grouped).map(([title, cmds]) => ({
            id: title.toLowerCase().replace(/\s+/g, '-'),
            title,
            commands: cmds
        }));
    }, [commands, searchQuery, matchingSessions, searchMode]);

    // Reset selection when search changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery, searchMode]);

    const handleSelectCommand = useCallback((command: Command) => {
        command.action();
        if (!command.keepOpen) onClose();
    }, [onClose]);

    // Get flattened commands for keyboard navigation
    const allCommands = useMemo(() => {
        return filteredCategories.flatMap(cat => cat.commands);
    }, [filteredCategories]);

    useEffect(() => {
        setSelectedIndex((previous) => Math.min(Math.max(previous, 0), Math.max(allCommands.length - 1, 0)));
    }, [allCommands.length]);

    const handleKeyPress = useCallback((key: string) => {
        switch(key) {
            case 'Escape':
                onClose();
                break;
            case 'ArrowDown':
                if (allCommands.length > 0) {
                    setSelectedIndex(prev => Math.min(prev + 1, allCommands.length - 1));
                }
                break;
            case 'ArrowUp':
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                if (allCommands[selectedIndex]) {
                    handleSelectCommand(allCommands[selectedIndex]);
                }
                break;
        }
    }, [onClose, allCommands, selectedIndex, handleSelectCommand]);

    const handleSearchChange = useCallback((text: string) => {
        setSearchQuery(text);
    }, [setSearchQuery]);

    return {
        searchQuery,
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
    };
}
