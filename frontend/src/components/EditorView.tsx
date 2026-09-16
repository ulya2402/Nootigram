import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NoteItem, ContentBlock, TaskItem, TableCell, TopicItem } from '../types';
import { t } from '../services/i18n';
import { exportNoteToTelegram } from '../services/api';

interface EditorViewProps {
  note: NoteItem;
  topics: TopicItem[];
  onBack: () => void;
  onSave: (updated: NoteItem) => void;
  onDelete: (id: string) => void;
}

const EditableBlock: React.FC<{
  html: string;
  placeholder: string;
  className?: string;
  onFocus?: () => void;
  onChange: (newHtml: string) => void;
}> = ({ html, placeholder, className, onFocus, onChange }) => {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (divRef.current && divRef.current.innerHTML !== html) {
      divRef.current.innerHTML = html || '';
    }
  }, [html]);

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={onFocus}
      onInput={(e) => {
        onChange(e.currentTarget.innerHTML);
      }}
      className={className}
    />
  );
};

export const EditorView: React.FC<EditorViewProps> = ({
  note,
  topics,
  onBack,
  onSave,
  onDelete,
}) => {
  const normalizeBlocks = (rawBlocks: ContentBlock[]): ContentBlock[] => {
    if (!rawBlocks || rawBlocks.length === 0) {
      return [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' }];
    }
    return rawBlocks.map((b, idx) => {
      const id = b.id || `block-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
      if (b.type === 'list') {
        const hasTaskStyle = b.style === 'task' || (!b.style && b.items?.some((i: any) => i.has_checkbox || i.is_checked !== undefined));
        const resolvedStyle = hasTaskStyle ? 'task' : (b.style || 'bullet');
        return {
          ...b,
          id,
          style: resolvedStyle,
          items: (b.items || []).map((it) => ({
            id: it.id || `task-${Date.now()}-${Math.random()}`,
            text: it.text || '',
            is_checked: Boolean(it.is_checked),
          })),
        };
      }
      return { ...b, id };
    });
  };

  const initialBlocks = normalizeBlocks(note.blocks);
  const [currentNote, setCurrentNote] = useState<NoteItem>({ ...note, blocks: initialBlocks });
  const [history, setHistory] = useState<NoteItem[]>([{ ...note, blocks: initialBlocks }]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(null);
  const [activeTableCell, setActiveTableCell] = useState<{ blockIndex: number; rowIndex: number; colIndex: number } | null>(null);
  const [activeToolbarTab, setActiveToolbarTab] = useState<'text' | 'lists' | 'quotes' | 'table' | 'objects'>('text');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [showToc, setShowToc] = useState<boolean>(false);
  const [keyboardInset, setKeyboardInset] = useState<number>(0);
  const [isEditorActive, setIsEditorActive] = useState<boolean>(false);
  const [activeFormats, setActiveFormats] = useState<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
    spoiler: boolean;
  }>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    spoiler: false,
  });
  const [botPromptModal, setBotPromptModal] = useState<{ isOpen: boolean; botUsername: string }>({
    isOpen: false,
    botUsername: '',
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const blockElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const historyTimerRef = useRef<number | null>(null);
  const flipPositionsRef = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    if (flipPositionsRef.current.size === 0) return;
    const prevPositions = flipPositionsRef.current;
    flipPositionsRef.current = new Map();

    const container = scrollContainerRef.current;
    const scrollOffset = container ? container.scrollTop : 0;

    currentNote.blocks.forEach((b) => {
      const oldTop = prevPositions.get(b.id);
      const el = blockElementRefs.current[b.id];
      if (oldTop !== undefined && el) {
        const newTop = el.getBoundingClientRect().top + scrollOffset;
        const delta = oldTop - newTop;
        if (Math.abs(delta) > 0.5) {
          el.animate(
            [
              { transform: `translate3d(0, ${delta}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)',
            }
          );
        }
      }
    });
  }, [currentNote.blocks]);

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  useLayoutEffect(() => {
    if (flipPositionsRef.current.size === 0) return;
    const prevPositions = flipPositionsRef.current;
    flipPositionsRef.current = new Map();

    currentNote.blocks.forEach((b) => {
      const oldTop = prevPositions.get(b.id);
      const el = blockElementRefs.current[b.id];
      if (oldTop !== undefined && el) {
        const newTop = el.getBoundingClientRect().top;
        const delta = oldTop - newTop;
        if (Math.abs(delta) > 0.5) {
          el.animate(
            [
              { transform: `translate3d(0, ${delta}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)',
            }
          );
        }
      }
    });
  }, [currentNote.blocks]);


  const isMovingRef = useRef<boolean>(false);

  

  const updateActiveFormats = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        code: false,
        spoiler: false,
      });
      return;
    }
    let parentNode: Node | null = sel.anchorNode;
    if (parentNode && parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const parentEl = parentNode as HTMLElement | null;
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      code: Boolean(parentEl?.closest('code')),
      spoiler: Boolean(parentEl?.closest('tg-spoiler')),
    });
  }, []);

  useEffect(() => {
    const handleViewport = () => {
      if (window.visualViewport) {
        const offset = Math.max(0, window.innerHeight - window.visualViewport.height);
        setKeyboardInset(offset);
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[contenteditable="true"]') || target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') {
        setIsEditorActive(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest('[data-format-bar="true"]')) {
        setTimeout(() => {
          const active = document.activeElement as HTMLElement | null;
          if (!active?.closest('[contenteditable="true"]') && active?.tagName !== 'TEXTAREA' && active?.tagName !== 'INPUT') {
            setIsEditorActive(false);
          }
        }, 120);
      }
    };

    window.visualViewport?.addEventListener('resize', handleViewport);
    window.visualViewport?.addEventListener('scroll', handleViewport);
    document.addEventListener('selectionchange', updateActiveFormats);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewport);
      window.visualViewport?.removeEventListener('scroll', handleViewport);
      document.removeEventListener('selectionchange', updateActiveFormats);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [updateActiveFormats]);

  const applyFormatCommand = (command: 'bold' | 'italic' | 'underline' | 'strikeThrough') => {
    triggerHaptic('light');
    document.execCommand(command, false);
    if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
      const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
      const editableDiv = currentEl?.querySelector('[contenteditable]');
      if (editableDiv) {
        updateBlock(
          focusedBlockIndex,
          { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
          true
        );
      }
    }
    updateActiveFormats();
  };

  const toggleCustomTag = (tagName: 'tg-spoiler' | 'code') => {
    triggerHaptic('light');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    let parentNode: Node | null = range.commonAncestorContainer;
    if (parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const existing = (parentNode as HTMLElement)?.closest(tagName);
    if (existing) {
      const parent = existing.parentNode;
      while (existing.firstChild) {
        parent?.insertBefore(existing.firstChild, existing);
      }
      parent?.removeChild(existing);
    } else {
      const el = document.createElement(tagName);
      try {
        range.surroundContents(el);
      } catch (err) {
        const fragment = range.extractContents();
        el.appendChild(fragment);
        range.insertNode(el);
      }
      sel.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(el);
      sel.addRange(nextRange);
    }
    if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
      const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
      const editableDiv = currentEl?.querySelector('[contenteditable]');
      if (editableDiv) {
        updateBlock(
          focusedBlockIndex,
          { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
          true
        );
      }
    }
    updateActiveFormats();
  };

  const handleClearFormatting = () => {
    triggerHaptic('medium');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    document.execCommand('removeFormat', false);
    const range = sel.getRangeAt(0);
    let container: Node | null = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentNode;
    }
    const parentEl = container as HTMLElement | null;
    const tagsToRemove = ['TG-SPOILER', 'CODE', 'B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL'];
    tagsToRemove.forEach((tag) => {
      const el = parentEl?.closest(tag);
      if (el && range.intersectsNode(el)) {
        const parent = el.parentNode;
        while (el.firstChild) {
          parent?.insertBefore(el.firstChild, el);
        }
        parent?.removeChild(el);
      }
    });
    if (parentEl) {
      const descendants = parentEl.querySelectorAll('tg-spoiler, code, b, strong, i, em, u, ins, s, strike, del');
      descendants.forEach((el) => {
        if (range.intersectsNode(el)) {
          const parent = el.parentNode;
          while (el.firstChild) {
            parent?.insertBefore(el.firstChild, el);
          }
          parent?.removeChild(el);
        }
      });
    }
    if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
      const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
      const editableDiv = currentEl?.querySelector('[contenteditable]');
      if (editableDiv) {
        updateBlock(
          focusedBlockIndex,
          { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
          true
        );
      }
    }
    updateActiveFormats();
  };

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.BackButton) {
      tg.BackButton.show();
      const handleNativeBack = () => {
        triggerHaptic();
        onBack();
      };
      tg.BackButton.onClick(handleNativeBack);
      return () => {
        tg.BackButton.offClick(handleNativeBack);
        tg.BackButton.hide();
      };
    }
  }, [onBack]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const persistChange = (updated: NoteItem, immediateHistory: boolean = false) => {
    const safeBlocks = updated.blocks.length === 0
      ? [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' } as ContentBlock]
      : updated.blocks;
    const finalized = { ...updated, blocks: safeBlocks };
    setCurrentNote(finalized);
    onSave(finalized);

    if (immediateHistory) {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        const trimmed = [...next, finalized];
        if (trimmed.length > 40) trimmed.shift();
        return trimmed;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 39));
    } else {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = window.setTimeout(() => {
        setHistory((prev) => {
          const next = prev.slice(0, historyIndex + 1);
          const trimmed = [...next, finalized];
          if (trimmed.length > 40) trimmed.shift();
          return trimmed;
        });
        setHistoryIndex((prev) => Math.min(prev + 1, 39));
      }, 700);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      triggerHaptic('light');
      const targetIndex = historyIndex - 1;
      const target = history[targetIndex];
      setHistoryIndex(targetIndex);
      setCurrentNote(target);
      onSave(target);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      triggerHaptic('light');
      const targetIndex = historyIndex + 1;
      const target = history[targetIndex];
      setHistoryIndex(targetIndex);
      setCurrentNote(target);
      onSave(target);
    }
  };

  const handleTitleChange = (title: string) => {
    persistChange({ ...currentNote, title }, false);
  };

  const updateBlock = (index: number, newBlock: ContentBlock, immediateHistory: boolean = false) => {
    const nextBlocks = [...currentNote.blocks];
    nextBlocks[index] = newBlock;
    persistChange({ ...currentNote, blocks: nextBlocks }, immediateHistory);
  };

  const removeBlock = (index: number) => {
    triggerHaptic('medium');
    const filtered = currentNote.blocks.filter((_, i) => i !== index);
    persistChange({ ...currentNote, blocks: filtered }, true);
    setFocusedBlockIndex(null);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentNote.blocks.length) return;
    triggerHaptic('light');

    const container = scrollContainerRef.current;
    const scrollOffset = container ? container.scrollTop : 0;
    const positions = new Map<string, number>();

    currentNote.blocks.forEach((b) => {
      const el = blockElementRefs.current[b.id];
      if (el) {
        positions.set(b.id, el.getBoundingClientRect().top + scrollOffset);
      }
    });
    flipPositionsRef.current = positions;

    const nextBlocks = [...currentNote.blocks];
    const temp = nextBlocks[index];
    nextBlocks[index] = nextBlocks[targetIndex];
    nextBlocks[targetIndex] = temp;

    if (activeTableCell && activeTableCell.blockIndex === index) {
      setActiveTableCell({
        ...activeTableCell,
        blockIndex: targetIndex,
      });
    }

    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetIndex);
  };

  const appendBlockWithParagraph = (
    type: ContentBlock['type'],
    opts?: { size?: 1 | 2 | 3 | 4 | 5 | 6; style?: 'task' | 'bullet' | 'ordered' }
  ) => {
    triggerHaptic('medium');
    const bId1 = `b-${Date.now()}-1`;
    const bId2 = `b-${Date.now()}-2`;
    let primaryBlock: ContentBlock;

    switch (type) {
      case 'heading':
        primaryBlock = { id: bId1, type: 'heading', size: opts?.size || 2, text: '' };
        break;
      case 'paragraph':
        primaryBlock = { id: bId1, type: 'paragraph', text: '' };
        break;
      case 'quote':
        primaryBlock = { id: bId1, type: 'quote', text: '', credit: '' };
        break;
      case 'expandable_quote':
        primaryBlock = { id: bId1, type: 'expandable_quote', text: '', credit: '' };
        break;
      case 'pullquote':
        primaryBlock = { id: bId1, type: 'pullquote', text: '', credit: '' };
        break;
      case 'list':
        primaryBlock = {
          id: bId1,
          type: 'list',
          style: opts?.style || 'task',
          items: [{ id: `task-${Date.now()}`, text: '', is_checked: false }],
        };
        break;
      case 'table':
        primaryBlock = {
          id: bId1,
          type: 'table',
          is_bordered: true,
          is_striped: false,
          cells: [
            [
              { text: 'A', is_header: true, align: 'left' },
              { text: 'B', is_header: true, align: 'left' },
            ],
            [
              { text: '', align: 'left' },
              { text: '', align: 'left' },
            ],
          ],
        };
        break;
      case 'code':
        primaryBlock = { id: bId1, type: 'code', text: '', language: 'javascript' };
        break;
      case 'math':
        primaryBlock = { id: bId1, type: 'math', expression: 'E = mc^2' };
        break;
      case 'details':
        primaryBlock = { id: bId1, type: 'details', summary: '', text: '' };
        break;
      case 'divider':
        primaryBlock = { id: bId1, type: 'divider' };
        break;
    }

    const trailingParagraph: ContentBlock = {
      id: bId2,
      type: 'paragraph',
      text: '',
    };

    const targetIndex = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
      ? focusedBlockIndex + 1
      : currentNote.blocks.length;

    const insertedBlocks = type === 'paragraph' ? [primaryBlock] : [primaryBlock, trailingParagraph];
    const nextBlocks = [
      ...currentNote.blocks.slice(0, targetIndex),
      ...insertedBlocks,
      ...currentNote.blocks.slice(targetIndex),
    ];

    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetIndex);

    setTimeout(() => {
      blockElementRefs.current[bId1]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 60);
  };

  const addTableRow = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    const columnCount = tableBlock.cells[0]?.length || 2;
    const newRow: TableCell[] = Array.from({ length: columnCount }, (_, i) => ({
      text: '',
      align: tableBlock.cells[0]?.[i]?.align || 'left',
    }));
    updateBlock(tableIndex, { ...tableBlock, cells: [...tableBlock.cells, newRow] }, true);
  };

  const removeTableRow = (tableIndex: number, targetRowIndex?: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table' || tableBlock.cells.length <= 1) return;
    const removeIdx = targetRowIndex !== undefined && targetRowIndex >= 0 && targetRowIndex < tableBlock.cells.length
      ? targetRowIndex
      : tableBlock.cells.length - 1;
    const updatedCells = tableBlock.cells.filter((_, idx) => idx !== removeIdx);
    if (removeIdx === 0 && updatedCells.length > 0) {
      updatedCells[0] = updatedCells[0].map((cell) => ({ ...cell, is_header: true }));
    }
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
    if (activeTableCell && activeTableCell.blockIndex === tableIndex) {
      setActiveTableCell({
        ...activeTableCell,
        rowIndex: Math.min(activeTableCell.rowIndex, updatedCells.length - 1),
      });
    }
  };

  const addTableColumn = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    const updatedCells = tableBlock.cells.map((row, rIdx) => [
      ...row,
      { text: '', is_header: rIdx === 0, align: 'left' as const },
    ]);
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
  };

  const removeTableColumn = (tableIndex: number, targetColIndex?: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table' || (tableBlock.cells[0]?.length || 0) <= 1) return;
    const removeIdx = targetColIndex !== undefined && targetColIndex >= 0 && targetColIndex < (tableBlock.cells[0]?.length || 0)
      ? targetColIndex
      : (tableBlock.cells[0]?.length || 0) - 1;
    const updatedCells = tableBlock.cells.map((row) => row.filter((_, idx) => idx !== removeIdx));
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
    if (activeTableCell && activeTableCell.blockIndex === tableIndex) {
      setActiveTableCell({
        ...activeTableCell,
        colIndex: Math.min(activeTableCell.colIndex, (updatedCells[0]?.length || 1) - 1),
      });
    }
  };

  const toggleTableBorder = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    updateBlock(tableIndex, { ...tableBlock, is_bordered: !tableBlock.is_bordered }, true);
  };

  const toggleTableStriped = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    updateBlock(tableIndex, { ...tableBlock, is_striped: !tableBlock.is_striped }, true);
  };

  const setCellAlignment = (blockIndex: number, rowIndex: number, colIndex: number, align: 'left' | 'center' | 'right') => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[blockIndex];
    if (tableBlock.type !== 'table') return;
    const nextCells = tableBlock.cells.map((row, rI) =>
      row.map((cell, cI) => (rI === rowIndex && cI === colIndex ? { ...cell, align } : cell))
    );
    updateBlock(blockIndex, { ...tableBlock, cells: nextCells }, true);
  };

  const setColumnAlignment = (blockIndex: number, colIndex: number, align: 'left' | 'center' | 'right') => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[blockIndex];
    if (tableBlock.type !== 'table') return;
    const nextCells = tableBlock.cells.map((row) =>
      row.map((cell, cI) => (cI === colIndex ? { ...cell, align } : cell))
    );
    updateBlock(blockIndex, { ...tableBlock, cells: nextCells }, true);
  };

  const scrollToHeading = (id: string) => {
    triggerHaptic('light');
    setShowToc(false);
    const el = blockElementRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const headingsList = currentNote.blocks.filter(
    (b): b is Extract<ContentBlock, { type: 'heading' }> => b.type === 'heading' && b.text.trim().length > 0
  );

  const executeExport = async (payload: any) => {
    const result = await exportNoteToTelegram(payload);
    if (result.success) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setExportNotice(t('exported'));
      setIsExporting(false);
      setTimeout(() => setExportNotice(null), 2500);
      return;
    }

    if (result.error === 'NEED_START_BOT') {
      setIsExporting(false);
      setBotPromptModal({ isOpen: true, botUsername: result.bot_username || '' });
      return;
    }

    if (result.error === 'NEED_WRITE_ACCESS' && window.Telegram?.WebApp?.requestWriteAccess) {
      window.Telegram.WebApp.requestWriteAccess(async (allowed: boolean) => {
        if (allowed) {
          const retryResult = await exportNoteToTelegram(payload);
          if (retryResult.success) {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
            setExportNotice(t('exported'));
          } else {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
            setExportNotice(t('export_failed'));
          }
        } else {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
          setExportNotice(t('export_failed'));
        }
        setIsExporting(false);
        setTimeout(() => setExportNotice(null), 2500);
      });
      return;
    }

    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    setExportNotice(t('export_failed'));
    setIsExporting(false);
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleExport = async () => {
    triggerHaptic('medium');
    setIsExporting(true);

    const richBlocks: any[] = [];
    if (currentNote.title.trim()) {
      richBlocks.push({ type: 'heading', size: 1, text: currentNote.title });
    }

    currentNote.blocks.forEach((b) => {
      if (b.type === 'heading') {
        richBlocks.push({ type: 'heading', size: b.size, text: b.text });
      } else if (b.type === 'paragraph') {
        if (b.text && b.text.trim()) {
          richBlocks.push({ type: 'paragraph', text: b.text });
        }
      } else if (b.type === 'quote') {
        richBlocks.push({
          type: 'blockquote',
          blocks: [{ type: 'paragraph', text: b.text }],
          credit: b.credit,
        });
      } else if (b.type === 'expandable_quote') {
        richBlocks.push({
          type: 'expandable_blockquote',
          text: b.text,
          credit: b.credit,
        });
      } else if (b.type === 'pullquote') {
        richBlocks.push({
          type: 'pullquote',
          text: b.text,
          credit: b.credit,
        });
      } else if (b.type === 'list') {
        richBlocks.push({
          type: 'list',
          items: b.items.map((i, idx) => ({
            label: b.style === 'ordered' ? `${idx + 1}.` : undefined,
            has_checkbox: b.style === 'task',
            is_checked: i.is_checked,
            blocks: [{ type: 'paragraph', text: i.text }],
          })),
        });
      } else if (b.type === 'table') {
        richBlocks.push({
          type: 'table',
          is_bordered: b.is_bordered,
          is_striped: b.is_striped,
          cells: b.cells,
        });
      } else if (b.type === 'code') {
        richBlocks.push({ type: 'pre', text: b.text, language: b.language });
      } else if (b.type === 'math') {
        richBlocks.push({ type: 'mathematical_expression', expression: b.expression });
      } else if (b.type === 'details') {
        richBlocks.push({
          type: 'details',
          summary: b.summary,
          blocks: [{ type: 'paragraph', text: b.text }],
        });
      } else if (b.type === 'divider') {
        richBlocks.push({ type: 'divider' });
      }
    });

    const exportPayload = {
      ...currentNote,
      blocks: richBlocks as any,
    };

    await executeExport(exportPayload);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden px-6 animate-page-fade relative"
      style={{ paddingBottom: 'calc(var(--keyboard-inset, 0px) + 5rem)' }}
    >
      <div className="sticky top-0 z-30 bg-[#FAF8F5]/95 safe-header-box pb-2 border-b border-cream-divider flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                triggerHaptic();
                setShowToc(!showToc);
              }}
              className={`h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1 physics-bounce ${
                showToc
                  ? 'bg-warm-accent text-white border-warm-accent'
                  : 'bg-cream-surface text-warm-text border-cream-divider'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">toc</span>
              <span>{t('toc_title')}</span>
            </button>
            <div className="flex items-center bg-cream-surface rounded-full border border-cream-divider px-0.5">
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="w-6 h-6 flex items-center justify-center text-warm-text disabled:opacity-30 physics-bounce"
              >
                <span className="material-symbols-outlined text-[15px]">undo</span>
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="w-6 h-6 flex items-center justify-center text-warm-text disabled:opacity-30 physics-bounce"
              >
                <span className="material-symbols-outlined text-[15px]">redo</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="h-7 px-3 rounded-full bg-warm-text text-[#FAF8F5] text-xs font-medium flex items-center gap-1.5 physics-bounce min-w-[70px] justify-center"
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin-fast" />
                  <span>{t('exporting')}</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[14px]">send</span>
                  <span>{exportNotice || t('export_rich')}</span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                triggerHaptic('medium');
                if (window.confirm(t('delete_confirm'))) {
                  onDelete(currentNote.id);
                }
              }}
              className="w-7 h-7 flex items-center justify-center text-warm-muted hover:text-red-600 physics-bounce"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 border-t border-cream-divider/40">
          {topics.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                triggerHaptic();
                persistChange({ ...currentNote, category: cat.id }, true);
              }}
              className={`text-[10px] px-2.5 py-0.5 rounded font-medium uppercase tracking-wider shrink-0 transition-colors ${
                currentNote.category === cat.id
                  ? 'bg-warm-accent text-white'
                  : 'bg-cream-surface text-warm-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-b border-cream-divider/40 pb-1 text-xs">
          {(['text', 'lists', 'quotes', 'table', 'objects'] as const).map((tabKey) => {
            const isActive = activeToolbarTab === tabKey;
            const labelKey = `tab_${tabKey}` as any;
            return (
              <button
                key={tabKey}
                onClick={() => {
                  triggerHaptic();
                  setActiveToolbarTab(tabKey);
                }}
                className={`pb-1 px-1 font-medium text-xs transition-colors relative ${
                  isActive ? 'text-warm-accent font-semibold' : 'text-warm-muted'
                }`}
              >
                <span>{t(labelKey)}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-warm-accent rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        <div key={activeToolbarTab} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 animate-toolbar-fade">
          {activeToolbarTab === 'text' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('paragraph')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span>{t('tool_paragraph')}</span>
              </button>
              {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => appendBlockWithParagraph('heading', { size: lvl })}
                  className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium shrink-0 physics-bounce"
                >
                  <span>H{lvl}</span>
                </button>
              ))}
            </>
          )}

          {activeToolbarTab === 'lists' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'task' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">check_box</span>
                <span>{t('tool_task')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'bullet' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">format_list_bulleted</span>
                <span>{t('tool_bullet')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'ordered' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">format_list_numbered</span>
                <span>{t('tool_numbered')}</span>
              </button>
            </>
          )}

          {activeToolbarTab === 'quotes' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('quote')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span>{t('tool_quote_block')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('expandable_quote')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span>{t('tool_quote_expand')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('pullquote')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span>{t('tool_quote_pull')}</span>
              </button>
            </>
          )}

          {activeToolbarTab === 'table' && (
            <button
              onClick={() => appendBlockWithParagraph('table')}
              className="px-3 py-1 rounded-full bg-warm-accent text-white text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
            >
              <span className="material-symbols-outlined text-[14px]">table_rows</span>
              <span>{t('tool_table')}</span>
            </button>
          )}

          {activeToolbarTab === 'objects' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('code')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">code</span>
                <span>{t('tool_code')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('math')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">functions</span>
                <span>{t('tool_math')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('details')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">unfold_more</span>
                <span>{t('tool_details')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('divider')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">horizontal_rule</span>
                <span>{t('tool_divider')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {showToc && (
        <div className="my-2 p-3 rounded-xl bg-cream-surface border border-cream-divider animate-toc-down shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-cream-divider/60">
            <span className="text-xs font-semibold text-warm-text uppercase tracking-wider">{t('toc_title')}</span>
            <button onClick={() => setShowToc(false)} className="text-warm-muted hover:text-warm-text">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          <div className="flex flex-col gap-1.5 pt-2 max-h-48 overflow-y-auto">
                {headingsList.length === 0 ? (
                  <span className="text-xs text-warm-subtle italic">{t('toc_empty')}</span>
                ) : (
                  headingsList.map((hBlock) => {
                    const indentStyles: Record<number, string> = {
                      1: 'pl-1 text-[13px] font-bold text-warm-text',
                      2: 'pl-3 text-xs font-semibold text-warm-text',
                      3: 'pl-5 text-xs font-medium text-warm-text',
                      4: 'pl-7 text-xs font-normal text-warm-muted',
                      5: 'pl-9 text-[11px] font-normal text-warm-muted',
                      6: 'pl-11 text-[11px] font-normal text-warm-subtle',
                    };
                    const styleClass = indentStyles[hBlock.size] || indentStyles[2];
                    return (
                      <button
                        key={hBlock.id}
                        onClick={() => scrollToHeading(hBlock.id)}
                        className={`text-left transition-colors truncate hover:text-warm-accent ${styleClass}`}
                      >
                        {hBlock.text}
                      </button>
                    );
                  })
                )}
              </div>
        </div>
      )}

      <div className="flex flex-col pt-3">
        <textarea
          rows={1}
          value={currentNote.title}
          placeholder={t('title_placeholder')}
          onFocus={() => setFocusedBlockIndex(null)}
          onInput={(e) => autoResize(e.currentTarget)}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="text-2xl font-bold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle w-full mb-3 resize-none overflow-hidden"
        />

        <div className="flex flex-col gap-2.5 min-h-[300px] w-full min-w-0">
          {currentNote.blocks.map((block, index) => (
            <div
              key={block.id}
              ref={(el) => {
                blockElementRefs.current[block.id] = el;
              }}
              className="relative group flex items-start gap-1 w-full min-w-0"
            >
              <div className="flex-1 min-w-0 w-full">
                {block.type === 'paragraph' && (
                  <EditableBlock
                    html={block.text}
                    placeholder={t('paragraph_placeholder')}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                    className="w-full text-[15px] leading-relaxed text-warm-text bg-transparent border-none focus:outline-none min-h-[24px]"
                  />
                )}

                {block.type === 'heading' && (
                  <input
                    type="text"
                    value={block.text}
                    placeholder={`${t('heading_placeholder')} (H${block.size})`}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                    className={`w-full font-semibold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle pt-0.5 ${
                      block.size === 1
                        ? 'text-xl font-bold'
                        : block.size === 2
                        ? 'text-lg font-bold'
                        : block.size === 3
                        ? 'text-base font-semibold'
                        : 'text-sm font-medium'
                    }`}
                  />
                )}

                {block.type === 'quote' && (
                  <div className="border-l-2 border-warm-accent pl-3 py-0.5 my-1 flex flex-col gap-1">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('quote_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full text-[15px] italic text-[#4A3828] bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-xs font-medium text-warm-accent bg-transparent border-none focus:outline-none"
                    />
                  </div>
                )}

                {block.type === 'expandable_quote' && (
                  <div className="border-l-2 border-dashed border-warm-accent pl-3 py-0.5 my-1 flex flex-col gap-1 bg-cream-surface/40 rounded-r">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('quote_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full text-[15px] italic text-warm-text bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-xs font-medium text-warm-accent bg-transparent border-none focus:outline-none"
                    />
                  </div>
                )}

                {block.type === 'pullquote' && (
                  <div className="my-2 py-2 px-3 border-y border-cream-divider text-center flex flex-col gap-1">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('quote_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full text-base font-serif italic text-warm-text text-center bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-xs font-medium text-warm-accent text-center bg-transparent border-none focus:outline-none"
                    />
                  </div>
                )}

                {block.type === 'list' && (
                  <div className="flex flex-col gap-1.5 py-1">
                    {block.items.map((item, itemIdx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        {block.style === 'task' ? (
                          <button
                            onClick={() => {
                              triggerHaptic();
                              const newItems = [...block.items];
                              newItems[itemIdx].is_checked = !newItems[itemIdx].is_checked;
                              updateBlock(index, { ...block, items: newItems }, true);
                            }}
                            className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                              item.is_checked ? 'bg-[#5F7466] text-white' : 'border border-warm-subtle bg-transparent'
                            }`}
                          >
                            {item.is_checked && (
                              <span className="material-symbols-outlined text-[13px] font-bold">check</span>
                            )}
                          </button>
                        ) : block.style === 'ordered' ? (
                          <span className="text-xs font-mono text-warm-accent font-semibold w-4 text-center">
                            {itemIdx + 1}.
                          </span>
                        ) : (
                          <span className="text-base text-warm-accent leading-none w-4 text-center">•</span>
                        )}

                        <input
                          id={item.id}
                          type="text"
                          value={item.text}
                          placeholder={t('task_placeholder')}
                          onFocus={() => setFocusedBlockIndex(index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              triggerHaptic('light');
                              const newTaskId = `task-${Date.now()}`;
                              const newItems = [...block.items];
                              newItems.splice(itemIdx + 1, 0, {
                                id: newTaskId,
                                text: '',
                                is_checked: false,
                              });
                              updateBlock(index, { ...block, items: newItems }, true);
                              setTimeout(() => {
                                document.getElementById(newTaskId)?.focus();
                              }, 50);
                            } else if (e.key === 'Backspace' && item.text === '' && block.items.length > 1) {
                              e.preventDefault();
                              triggerHaptic('light');
                              const newItems = block.items.filter((_, i) => i !== itemIdx);
                              updateBlock(index, { ...block, items: newItems }, true);
                              const prevItem = block.items[itemIdx - 1];
                              if (prevItem) {
                                setTimeout(() => {
                                  document.getElementById(prevItem.id)?.focus();
                                }, 50);
                              }
                            }
                          }}
                          onChange={(e) => {
                            const newItems = [...block.items];
                            newItems[itemIdx].text = e.target.value;
                            updateBlock(index, { ...block, items: newItems }, false);
                          }}
                          className={`text-sm bg-transparent border-none focus:outline-none flex-1 ${
                            item.is_checked ? 'line-through text-warm-muted' : 'text-warm-text'
                          }`}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        triggerHaptic();
                        const newTaskId = `task-${Date.now()}`;
                        const newItems = [
                          ...block.items,
                          { id: newTaskId, text: '', is_checked: false },
                        ];
                        updateBlock(index, { ...block, items: newItems }, true);
                        setTimeout(() => {
                          document.getElementById(newTaskId)?.focus();
                        }, 50);
                      }}
                      className="text-xs text-warm-accent font-medium self-start flex items-center gap-1 mt-0.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>{t('add_task_item')}</span>
                    </button>
                  </div>
                )}

                {block.type === 'table' && (
                  <div className="flex flex-col gap-1.5 my-3 w-full min-w-0 max-w-full">
                    <div
                      className={`relative w-full min-w-0 max-w-full rounded-xl overflow-hidden bg-[#FAF8F5] transition-all duration-150 ${
                        block.is_bordered ? 'border border-cream-divider' : 'border border-transparent'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between px-2.5 bg-cream-surface transition-all duration-150 ease-out overflow-x-auto no-scrollbar gap-2 ${
                          block.is_bordered ? 'border-b border-cream-divider' : ''
                        } ${
                          focusedBlockIndex === index
                            ? 'max-h-12 py-1.5 opacity-100'
                            : 'max-h-0 py-0 opacity-0 pointer-events-none'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          {activeTableCell && activeTableCell.blockIndex === index && (
                            <div className="flex items-center bg-[#FAF8F5] border border-cream-divider rounded-lg p-0.5">
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'left')}
                                className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                              >
                                <span className="material-symbols-outlined text-[14px]">format_align_left</span>
                              </button>
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'center')}
                                className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                              >
                                <span className="material-symbols-outlined text-[14px]">format_align_center</span>
                              </button>
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'right')}
                                className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                              >
                                <span className="material-symbols-outlined text-[14px]">format_align_right</span>
                              </button>
                            </div>
                          )}

                          <div className="flex items-center gap-0.5">
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleTableBorder(index)}
                              className={`p-1 rounded-lg transition-colors active:scale-90 ${
                                block.is_bordered ? 'text-warm-accent bg-warm-accent-light' : 'text-warm-muted hover:text-warm-text'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px]">border_all</span>
                            </button>
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleTableStriped(index)}
                              className={`p-1 rounded-lg transition-colors active:scale-90 ${
                                block.is_striped ? 'text-warm-accent bg-warm-accent-light' : 'text-warm-muted hover:text-warm-text'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px]">table_rows</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => removeTableRow(index, activeTableCell?.rowIndex)}
                            disabled={block.cells.length <= 1}
                            className="px-2 py-1 rounded-md text-[11px] font-medium text-warm-muted hover:text-red-600 disabled:opacity-30 flex items-center gap-0.5 active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                            <span>{t('del_row').replace(/^[+\-–]\s*/, '')}</span>
                          </button>
                          <span className="h-3 w-[1px] bg-cream-divider mx-0.5" />
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => removeTableColumn(index, activeTableCell?.colIndex)}
                            disabled={(block.cells[0]?.length || 0) <= 1}
                            className="px-2 py-1 rounded-md text-[11px] font-medium text-warm-muted hover:text-red-600 disabled:opacity-30 flex items-center gap-0.5 active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                            <span>{t('del_col').replace(/^[+\-–]\s*/, '')}</span>
                          </button>
                        </div>
                      </div>

                      <div className="w-full max-w-full overflow-x-auto no-scrollbar scroll-smooth overscroll-x-contain">
                        <table
                          className={`text-xs border-collapse ${
                            (block.cells[0]?.length || 0) <= 2 ? 'w-full table-fixed' : 'w-max min-w-full'
                          }`}
                        >
                          <tbody>
                            {block.cells.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={`${
                                  rIdx === 0
                                    ? `bg-cream-surface/80 font-semibold text-warm-text ${
                                        block.is_bordered ? 'border-b border-cream-divider' : ''
                                      }`
                                    : block.is_striped && rIdx % 2 === 1
                                    ? 'bg-cream-surface/35'
                                    : 'bg-transparent'
                                }`}
                              >
                                {row.map((col, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={`p-0 relative min-w-0 ${
                                      (block.cells[0]?.length || 0) > 2 ? 'min-w-[100px]' : ''
                                    } ${
                                      block.is_bordered
                                        ? `border-cream-divider ${rIdx < block.cells.length - 1 ? 'border-b' : ''} ${
                                            cIdx < row.length - 1 ? 'border-r' : ''
                                          }`
                                        : 'border-none'
                                    }`}
                                  >
                                    <input
                                      type="text"
                                      value={col.text}
                                      placeholder={rIdx === 0 ? `${t('table_col')} ${cIdx + 1}` : `${t('table_cell')} ${rIdx + 1}`}
                                      onFocus={() => {
                                        setFocusedBlockIndex(index);
                                        setActiveTableCell({ blockIndex: index, rowIndex: rIdx, colIndex: cIdx });
                                      }}
                                      onChange={(e) => {
                                        const nextCells = block.cells.map((r, ri) =>
                                          r.map((c, ci) => (ri === rIdx && ci === cIdx ? { ...c, text: e.target.value } : c))
                                        );
                                        updateBlock(index, { ...block, cells: nextCells }, false);
                                      }}
                                      className={`w-full min-w-0 bg-transparent border-none focus:outline-none text-warm-text px-2.5 py-1.5 font-medium ${
                                        col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                                      }`}
                                    />
                                  </td>
                                ))}
                                {rIdx === 0 ? (
                                  <th
                                    style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }}
                                    className={`w-8 min-w-[32px] max-w-[32px] p-0 text-center align-middle ${
                                      block.is_bordered ? 'border-b border-cream-divider bg-cream-surface/60' : 'bg-cream-surface/30'
                                    }`}
                                  >
                                    <button
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => addTableColumn(index)}
                                      className="w-full h-full min-h-[30px] flex items-center justify-center text-warm-muted hover:text-warm-accent active:scale-90 transition-transform"
                                      title={t('add_col').replace(/^[+\-–]\s*/, '')}
                                    >
                                      <span className="material-symbols-outlined text-[15px]">add</span>
                                    </button>
                                  </th>
                                ) : (
                                  <td
                                    style={{ width: '32px', minWidth: '32px', maxWidth: '32px' }}
                                    className={`w-8 min-w-[32px] max-w-[32px] p-0 ${
                                      block.is_bordered && rIdx < block.cells.length - 1 ? 'border-b border-cream-divider/30' : ''
                                    }`}
                                  />
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div
                        className={`flex items-center justify-between px-3 py-1 bg-cream-surface/30 ${
                          block.is_bordered ? 'border-t border-cream-divider' : ''
                        }`}
                      >
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addTableRow(index)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-warm-muted hover:text-warm-accent active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[14px]">add</span>
                          <span>{t('add_row').replace(/^[+\-–]\s*/, '')}</span>
                        </button>
                        <span className="text-[10px] font-mono text-warm-subtle">
                          {block.cells.length} × {block.cells[0]?.length || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {block.type === 'code' && (
                  <div className="bg-cream-surface/70 rounded p-2 my-1 font-code">
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('code_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-xs text-warm-text font-code resize-none overflow-hidden"
                    />
                  </div>
                )}

                {block.type === 'math' && (
                  <div className="flex items-center gap-1 py-1 font-code text-xs text-warm-accent">
                    <span>$$</span>
                    <input
                      type="text"
                      value={block.expression}
                      placeholder={t('math_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, expression: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-warm-text font-code"
                    />
                    <span>$$</span>
                  </div>
                )}

                {block.type === 'details' && (
                  <div className="border-l border-cream-divider pl-3 my-1 flex flex-col gap-1">
                    <input
                      type="text"
                      value={block.summary}
                      placeholder={t('details_summary_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, summary: e.target.value })}
                      className="text-xs font-semibold text-warm-accent bg-transparent border-none focus:outline-none"
                    />
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('details_content_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="text-xs text-warm-text bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                    />
                  </div>
                )}

                {block.type === 'divider' && <div className="w-full h-px bg-cream-divider my-2" />}
              </div>

              {focusedBlockIndex === index && (
                <div className="absolute right-0 -top-3 z-10 flex items-center gap-1 bg-[#FAF8F5] border border-cream-divider/80 px-1.5 py-0.5 rounded-full shadow-sm animate-page-fade">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => moveBlock(index, 'up')}
                    disabled={index === 0}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-25 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => moveBlock(index, 'down')}
                    disabled={index === currentNote.blocks.length - 1}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-25 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => removeBlock(index)}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-red-600 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">delete</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isEditorActive &&
        createPortal(
          <div
            data-format-bar="true"
            className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none max-w-[420px] mx-auto select-none"
            style={{
              bottom: keyboardInset > 0
                ? `${keyboardInset + 10}px`
                : 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 12px)',
            }}
          >
            <div className="pointer-events-auto flex items-center p-1 rounded-full bg-cream-surface border border-cream-divider shadow-xl backdrop-blur-md">
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => applyFormatCommand('bold')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors text-xs font-bold ${
                  activeFormats.bold
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                B
              </button>
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => applyFormatCommand('italic')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors text-xs italic font-serif ${
                  activeFormats.italic
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                I
              </button>
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => applyFormatCommand('underline')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors text-xs underline ${
                  activeFormats.underline
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                U
              </button>
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => applyFormatCommand('strikeThrough')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors text-xs line-through ${
                  activeFormats.strike
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                S
              </button>
              <div className="w-[1px] h-4 bg-cream-divider mx-1" />
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => toggleCustomTag('code')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors text-[11px] font-mono ${
                  activeFormats.code
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                &lt;/&gt;
              </button>
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => toggleCustomTag('tg-spoiler')}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                  activeFormats.spoiler
                    ? 'bg-warm-accent text-[#FAF8F5]'
                    : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                }`}
              >
                <span className="material-symbols-outlined text-[17px] leading-none">
                  visibility_off
                </span>
              </button>
              <div className="w-[1px] h-4 bg-cream-divider mx-1" />
              <button
                onPointerDown={(e) => e.preventDefault()}
                onClick={handleClearFormatting}
                className="flex items-center justify-center w-8 h-8 rounded-full transition-colors text-warm-muted hover:text-warm-text active:bg-cream-divider"
              >
                <span className="material-symbols-outlined text-[16px] leading-none">
                  format_clear
                </span>
              </button>
            </div>
          </div>,
          document.body
        )}
      {botPromptModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#24201D]/40 animate-page-fade">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-[#FAF8F5] border border-cream-divider shadow-sm flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-warm-accent-light text-warm-accent flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">mark_chat_unread</span>
              </div>
              <h3 className="text-sm font-semibold text-warm-text">
                {t('bot_modal_title')}
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-warm-muted">
              {t('bot_modal_desc')}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1.5">
              <button
                onClick={() => setBotPromptModal({ isOpen: false, botUsername: '' })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-warm-muted bg-cream-surface physics-bounce"
              >
                {t('bot_modal_later')}
              </button>
              <button
                onClick={() => {
                  const botLink = botPromptModal.botUsername
                    ? `https://t.me/${botPromptModal.botUsername}?start=export`
                    : 'https://t.me';
                  if (window.Telegram?.WebApp?.openTelegramLink) {
                    window.Telegram.WebApp.openTelegramLink(botLink);
                  } else {
                    window.open(botLink, '_blank');
                  }
                  setBotPromptModal({ isOpen: false, botUsername: '' });
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-warm-accent flex items-center gap-1.5 physics-bounce"
              >
                <span>{t('bot_modal_open')}</span>
                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};